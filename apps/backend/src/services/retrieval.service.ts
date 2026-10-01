import { createHash } from 'node:crypto';

import { sql } from 'drizzle-orm';

import type {
  RetrievalCandidate,
  RetrievalDebug,
  RetrievalProfile,
} from '@nexus/shared-types';

import { db } from '../db/index.js';
import {
  assertChatConfigured,
  embedTextCached,
  getEffectiveEmbeddingModel,
  getEmbeddingDimensions,
} from './embedding.service.js';
import { getOpenAIClient, sessionHeaders } from './openai-client.js';
import { safeFtsLanguage } from './retrieval-language.js';
import {
  getSetting,
  getSettingBoolean,
  getSettingNumber,
} from './settings.service.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

/** A retrieved chunk plus the scores behind its position. */
export interface SourceHit {
  id: string;
  documentId: string;
  title: string;
  content: string;
  page: number | null;
  pageEnd: number | null;
  headingPath: string[];
  /** Vector cosine similarity (0..1) - what the UI shows as relevance. */
  similarity: number;
  vectorScore: number;
  keywordScore: number;
  fusedScore: number;
  tokenCount: number;
  cited?: boolean;
}

export interface RetrievalProfileConfig {
  profile: RetrievalProfile;
  queryRewrite: boolean;
  rerank: boolean;
  minScore: number;
  tokenBudget: number;
  topK: number;
  vectorWeight: number;
  keywordWeight: number;
}

export interface RetrievalResult {
  sources: SourceHit[];
  searchQuery: string;
  debug: RetrievalDebug;
}

export interface RawCandidate {
  id: string;
  documentId: string;
  title: string;
  content: string;
  contentHash: string;
  page: number | null;
  pageEnd: number | null;
  headingPath: string[];
  tokenCount: number;
  vectorScore: number;
  keywordScore: number;
  fusedScore: number;
}

interface CandidateRow {
  id: string;
  document_id: string;
  title: string;
  content: string;
  content_hash: string | null;
  token_count: number | null;
  metadata: {
    page?: number | null;
    pageEnd?: number | null;
    headingPath?: string[];
  } | null;
  similarity?: string | number | null;
  keyword_rank?: string | number | null;
}

/** Candidates fetched per arm before fusion. */
const CANDIDATE_LIMIT = 50;
/** Passages sent to the reranker. */
const RERANK_LIMIT = 20;
/** RRF constant from the original paper; dampens the influence of rank. */
const RRF_K = 60;

// ---------------------------------------------------------------------------
// Pure helpers (unit tested)
// ---------------------------------------------------------------------------

/**
 * Resolve the effective retrieval behavior for a profile. The profile is the
 * user-facing switch: Fast disables rewriting, Thorough always reranks, and
 * Balanced honors the individual toggles.
 */
export function resolveProfileConfig(input: {
  profile: string;
  queryRewrite: boolean;
  rerank: boolean;
  minScore: number;
  tokenBudget: number;
  topK: number;
  vectorWeight: number;
  keywordWeight: number;
}): RetrievalProfileConfig {
  const profile: RetrievalProfile = (
    ['fast', 'balanced', 'thorough'] as const
  ).includes(input.profile as RetrievalProfile)
    ? (input.profile as RetrievalProfile)
    : 'balanced';

  return {
    profile,
    queryRewrite: profile === 'fast' ? false : input.queryRewrite,
    rerank: profile === 'thorough' ? true : input.rerank,
    minScore: input.minScore,
    tokenBudget: input.tokenBudget,
    topK: input.topK,
    vectorWeight: input.vectorWeight,
    keywordWeight: input.keywordWeight,
  };
}

/**
 * Fuse the vector and keyword arms with Reciprocal Rank Fusion. Both arms
 * contribute independently, so a chunk that matches only semantically (no
 * keyword overlap) is still retrieved - the Phase 0 keyword filter that
 * silently dropped those candidates is gone.
 */
export function fuseRrf(
  vectorHits: RawCandidate[],
  keywordHits: RawCandidate[],
  vectorWeight: number,
  keywordWeight: number,
  k: number = RRF_K,
): RawCandidate[] {
  const byId = new Map<string, RawCandidate>();

  vectorHits.forEach((hit, index) => {
    byId.set(hit.id, {
      ...hit,
      fusedScore: vectorWeight / (k + index + 1),
      keywordScore: 0,
    });
  });

  keywordHits.forEach((hit, index) => {
    const contribution = keywordWeight / (k + index + 1);
    const existing = byId.get(hit.id);
    if (existing) {
      existing.fusedScore += contribution;
      existing.keywordScore = Math.max(existing.keywordScore, hit.keywordScore);
    } else {
      byId.set(hit.id, {
        ...hit,
        vectorScore: 0,
        fusedScore: contribution,
      });
    }
  });

  const theoreticalMax = (vectorWeight + keywordWeight) / (k + 1);
  return [...byId.values()]
    .map((hit) => ({
      ...hit,
      fusedScore:
        theoreticalMax > 0 ? Math.min(1, hit.fusedScore / theoreticalMax) : 0,
    }))
    .sort((a, b) => b.fusedScore - a.fusedScore);
}

/** Drop weak vector matches; keyword matches always survive. */
export function applyMinScore(
  hits: RawCandidate[],
  minScore: number,
): RawCandidate[] {
  if (minScore <= 0) return hits;
  return hits.filter(
    (hit) => hit.vectorScore >= minScore || hit.keywordScore > 0,
  );
}

/**
 * Select up to `topK` hits with at most `maxPerDocument` from one document
 * and no near-duplicate content. If the cap prevents filling topK, a second
 * pass ignores it.
 */
export function applyDiversity(
  hits: RawCandidate[],
  topK: number,
  maxPerDocument = 3,
): RawCandidate[] {
  const selected: RawCandidate[] = [];
  const perDocument = new Map<string, number>();
  const seen = new Set<string>();

  const pass = (cap: number): void => {
    for (const hit of hits) {
      if (selected.length >= topK) return;
      if (seen.has(hit.contentHash)) continue;
      const count = perDocument.get(hit.documentId) ?? 0;
      if (count >= cap) continue;
      selected.push(hit);
      perDocument.set(hit.documentId, count + 1);
      seen.add(hit.contentHash);
    }
  };

  pass(maxPerDocument);
  if (selected.length < topK) pass(Number.POSITIVE_INFINITY);
  return selected;
}

/**
 * Keep sources until the token budget is spent. The best hit is always kept
 * so a tiny budget cannot produce an answer with no sources at all.
 */
export function trimToBudget(
  hits: RawCandidate[],
  tokenBudget: number,
): { hits: RawCandidate[]; usedTokens: number } {
  const kept: RawCandidate[] = [];
  let used = 0;
  for (const hit of hits) {
    const tokens = hit.tokenCount > 0 ? hit.tokenCount : 1;
    if (kept.length > 0 && used + tokens > tokenBudget) break;
    kept.push(hit);
    used += tokens;
  }
  return { hits: kept, usedTokens: used };
}

/** 1-based citation numbers present in an answer that point at real sources. */
export function validateCitations(
  answer: string,
  sourceCount: number,
): number[] {
  const found = new Set<number>();
  for (const match of answer.matchAll(/\[(\d+)\]/g)) {
    const number = Number(match[1]);
    if (number >= 1 && number <= sourceCount) found.add(number);
  }
  return [...found].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Query rewriting
// ---------------------------------------------------------------------------

const rewriteCache = new Map<string, { value: string; at: number }>();
const REWRITE_TTL_MS = 10 * 60 * 1000;
const REWRITE_CACHE_MAX = 500;

/**
 * Rewrite a follow-up message into a standalone search query using recent
 * conversation turns. Falls back to the raw message on any failure; cached
 * by (model, history, message) so retries and edits are cheap.
 */
export async function rewriteQuery(
  history: ChatHistoryItem[],
  message: string,
  sessionId?: string,
): Promise<string> {
  if (history.length === 0) return message;

  const model =
    (await getSetting('job.queryRewrite.model')) ||
    (await getSetting('openai.model'));
  const key = createHash('sha256')
    .update(model)
    .update('\u0000')
    .update(history.map((h) => `${h.role}:${h.content}`).join('\u0000'))
    .update('\u0000')
    .update(message)
    .digest('hex');

  const cached = rewriteCache.get(key);
  if (cached && Date.now() - cached.at < REWRITE_TTL_MS) return cached.value;

  try {
    await assertChatConfigured();
    const client = await getOpenAIClient('chat');
    const transcript = history
      .slice(-4)
      .map(
        (item) =>
          `${item.role === 'user' ? 'User' : 'Assistant'}: ${item.content.slice(0, 500)}`,
      )
      .join('\n');

    const completion = await client.chat.completions.create(
      {
        model,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              "Rewrite the user's latest message as a standalone search query using the conversation context. Preserve names, dates, numbers and technical terms. Reply with ONLY the rewritten query, no quotes or explanation.",
          },
          {
            role: 'user',
            content: `Conversation:\n${transcript}\n\nLatest message: ${message}`,
          },
        ],
      },
      sessionId ? sessionHeaders(sessionId) : undefined,
    );

    const rewritten = (completion.choices[0]?.message?.content ?? '')
      .trim()
      .replace(/^["']+|["']+$/g, '')
      .slice(0, 400);
    const value = rewritten.length > 0 ? rewritten : message;

    if (rewriteCache.size >= REWRITE_CACHE_MAX) {
      const oldest = rewriteCache.keys().next().value;
      if (oldest !== undefined) rewriteCache.delete(oldest);
    }
    rewriteCache.set(key, { value, at: Date.now() });
    return value;
  } catch {
    return message;
  }
}

// ---------------------------------------------------------------------------
// Reranking
// ---------------------------------------------------------------------------

/**
 * Reorder the top candidates with a listwise LLM call. Tolerant by design:
 * any parse/provider failure keeps the fused ordering.
 */
export async function rerankHits(
  query: string,
  hits: RawCandidate[],
  limit: number,
  sessionId?: string,
): Promise<RawCandidate[]> {
  const candidates = hits.slice(0, RERANK_LIMIT);
  if (candidates.length <= 1) return hits;

  try {
    await assertChatConfigured();
    const client = await getOpenAIClient('chat');
    const model =
      (await getSetting('job.rerank.model')) ||
      (await getSetting('openai.model'));
    const listing = candidates
      .map(
        (hit, index) =>
          `[${index + 1}] ${hit.title}${hit.page ? ` (p.${hit.page})` : ''}: ${hit.content
            .replace(/\s+/g, ' ')
            .slice(0, 400)}`,
      )
      .join('\n');

    const completion = await client.chat.completions.create(
      {
        model,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              'You rank retrieval passages by how well they answer a question. Reply with ONLY a JSON array of passage numbers, most relevant first.',
          },
          {
            role: 'user',
            content: `Question: ${query}\n\nPassages:\n${listing}\n\nReturn a JSON array with the ${Math.min(limit, candidates.length)} most relevant passage numbers.`,
          },
        ],
      },
      sessionId ? sessionHeaders(sessionId) : undefined,
    );

    const raw = completion.choices[0]?.message?.content ?? '';
    const order = [...raw.matchAll(/\d+/g)]
      .map((match) => Number(match[0]))
      .filter((number) => number >= 1 && number <= candidates.length);
    const unique = [...new Set(order)];
    if (unique.length === 0) return hits;

    const reranked = unique.map(
      (number) => candidates[number - 1] as RawCandidate,
    );
    const chosen = new Set(unique);
    candidates.forEach((candidate, index) => {
      if (!chosen.has(index + 1)) reranked.push(candidate);
    });
    return [...reranked, ...hits.slice(RERANK_LIMIT)];
  } catch {
    return hits;
  }
}

// ---------------------------------------------------------------------------
// Candidate retrieval
// ---------------------------------------------------------------------------

async function fetchVectorCandidates(
  workspaceId: string,
  embedding: number[],
  model: string,
  dims: number,
): Promise<RawCandidate[]> {
  const vectorLiteral = sql.raw(
    `'[${embedding.map((n) => n.toFixed(6)).join(',')}]'`,
  );

  // Provenance filter: only vectors from the active model, or legacy rows
  // (pre-Phase-1) whose dimension matches the query vector. This keeps
  // existing corpora searchable without ever comparing different vector
  // spaces, which used to crash pgvector with a dimension error.
  const result = await db.execute(
    sql`
      SELECT c.id, c.content, c.document_id, d.title, c.metadata,
             c.content_hash, c.token_count,
             (1 - (c.embedding <=> ${vectorLiteral}::vector)) AS similarity
      FROM chunks c
      JOIN documents d ON d.id = c.document_id
      WHERE d.workspace_id = ${workspaceId}
        AND (
          c.embedding_model = ${model}
          OR (c.embedding_model IS NULL AND vector_dims(c.embedding) = ${dims})
        )
      ORDER BY c.embedding <=> ${vectorLiteral}::vector
      LIMIT ${CANDIDATE_LIMIT}
    `,
  );

  const rows = (result as unknown as { rows: CandidateRow[] }).rows;
  return rows.map((row) => ({
    id: row.id,
    documentId: row.document_id,
    title: row.title,
    content: row.content,
    contentHash: row.content_hash ?? hashContent(row.content),
    page: row.metadata?.page ?? null,
    pageEnd: row.metadata?.pageEnd ?? null,
    headingPath: row.metadata?.headingPath ?? [],
    tokenCount:
      row.token_count ?? Math.max(1, Math.ceil(row.content.length / 4)),
    vectorScore: clamp01(Number.parseFloat(String(row.similarity ?? 0))),
    keywordScore: 0,
    fusedScore: 0,
  }));
}

async function fetchKeywordCandidates(
  workspaceId: string,
  query: string,
  language: string,
): Promise<RawCandidate[]> {
  const result = await db.execute(
    sql`
      SELECT c.id, c.content, c.document_id, d.title, c.metadata,
             c.content_hash, c.token_count,
             ts_rank(c.content_fts, websearch_to_tsquery(${language}::regconfig, ${query})) AS keyword_rank
      FROM chunks c
      JOIN documents d ON d.id = c.document_id
      WHERE d.workspace_id = ${workspaceId}
        AND c.content_fts IS NOT NULL
        AND c.content_fts @@ websearch_to_tsquery(${language}::regconfig, ${query})
      ORDER BY keyword_rank DESC
      LIMIT ${CANDIDATE_LIMIT}
    `,
  );

  const rows = (result as unknown as { rows: CandidateRow[] }).rows;
  const maxRank = rows.reduce(
    (max, row) =>
      Math.max(max, Number.parseFloat(String(row.keyword_rank ?? 0))),
    0,
  );

  return rows.map((row) => ({
    id: row.id,
    documentId: row.document_id,
    title: row.title,
    content: row.content,
    contentHash: row.content_hash ?? hashContent(row.content),
    page: row.metadata?.page ?? null,
    pageEnd: row.metadata?.pageEnd ?? null,
    headingPath: row.metadata?.headingPath ?? [],
    tokenCount:
      row.token_count ?? Math.max(1, Math.ceil(row.content.length / 4)),
    vectorScore: 0,
    keywordScore:
      maxRank > 0
        ? clamp01(Number.parseFloat(String(row.keyword_rank ?? 0)) / maxRank)
        : 0,
    fusedScore: 0,
  }));
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Retrieve the sources for one chat turn: rewrite (optional), fetch the
 * vector and keyword arms, fuse, threshold, rerank (optional), diversify and
 * budget. Returns the sources plus the inspector payload.
 */
export async function retrieveForChat(params: {
  workspaceId: string;
  query: string;
  history: ChatHistoryItem[];
  sessionId?: string;
}): Promise<RetrievalResult> {
  const [
    profileSetting,
    queryRewrite,
    rerank,
    minScore,
    tokenBudget,
    topK,
    vectorWeight,
    keywordWeight,
    model,
    dims,
    language,
  ] = await Promise.all([
    getSetting('rag.profile'),
    getSettingBoolean('rag.queryRewrite'),
    getSettingBoolean('rag.rerank'),
    getSettingNumber('rag.minScore'),
    getSettingNumber('rag.maxContextTokens'),
    getSettingNumber('rag.topK'),
    getSettingNumber('rag.similarityWeight'),
    getSettingNumber('rag.keywordWeight'),
    getEffectiveEmbeddingModel(),
    getEmbeddingDimensions(),
    safeFtsLanguage(),
  ]);

  const config = resolveProfileConfig({
    profile: profileSetting,
    queryRewrite,
    rerank,
    minScore,
    tokenBudget,
    topK,
    vectorWeight,
    keywordWeight,
  });

  const searchQuery = config.queryRewrite
    ? await rewriteQuery(params.history, params.query, params.sessionId)
    : params.query;

  const embedding = await embedTextCached(searchQuery);
  const [vectorHits, keywordHits] = await Promise.all([
    fetchVectorCandidates(params.workspaceId, embedding, model, dims),
    fetchKeywordCandidates(params.workspaceId, searchQuery, language),
  ]);

  const fused = applyMinScore(
    fuseRrf(vectorHits, keywordHits, config.vectorWeight, config.keywordWeight),
    config.minScore,
  );

  const ordered = config.rerank
    ? await rerankHits(searchQuery, fused, config.topK, params.sessionId)
    : fused;

  const selected = applyDiversity(ordered, config.topK);
  const { hits: budgeted, usedTokens } = trimToBudget(
    selected,
    config.tokenBudget,
  );

  const fusedRank = new Map(fused.map((hit, index) => [hit.id, index + 1]));
  const selectedIds = new Set(budgeted.map((hit) => hit.id));
  const candidates: RetrievalCandidate[] = ordered
    .slice(0, RERANK_LIMIT)
    .map((hit, index) => ({
      id: hit.id,
      documentId: hit.documentId,
      title: hit.title,
      page: hit.page,
      headingPath: hit.headingPath,
      vectorScore: round4(hit.vectorScore),
      keywordScore: round4(hit.keywordScore),
      fusedScore: round4(hit.fusedScore),
      rank: fusedRank.get(hit.id) ?? index + 1,
      rerankedRank: config.rerank ? index + 1 : null,
      selected: selectedIds.has(hit.id),
      contentPreview: hit.content.replace(/\s+/g, ' ').slice(0, 200),
    }));

  return {
    sources: budgeted.map(toSourceHit),
    searchQuery,
    debug: {
      profile: config.profile,
      originalQuery: params.query,
      searchQuery,
      rewritten: searchQuery !== params.query,
      reranked: config.rerank,
      vectorCandidates: vectorHits.length,
      keywordCandidates: keywordHits.length,
      minScore: config.minScore,
      tokenBudget: config.tokenBudget,
      usedTokens,
      candidates,
    },
  };
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function toSourceHit(hit: RawCandidate): SourceHit {
  return {
    id: hit.id,
    documentId: hit.documentId,
    title: hit.title,
    content: hit.content,
    page: hit.page,
    pageEnd: hit.pageEnd,
    headingPath: hit.headingPath,
    similarity: hit.vectorScore,
    vectorScore: hit.vectorScore,
    keywordScore: hit.keywordScore,
    fusedScore: hit.fusedScore,
    tokenCount: hit.tokenCount,
  };
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
