import type OpenAI from 'openai';
import { sql } from 'drizzle-orm';

import { db } from '../db/index.js';
import { assertChatConfigured, embedTextCached } from './embedding.service.js';
import { getOpenAIClient, sessionHeaders } from './openai-client.js';
import { getSetting, getSettingNumber } from './settings.service.js';

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

const FTS_LANGUAGES = new Set([
  'simple',
  'english',
  'danish',
  'dutch',
  'finnish',
  'french',
  'german',
  'hungarian',
  'italian',
  'norwegian',
  'portuguese',
  'romanian',
  'russian',
  'spanish',
  'swedish',
  'turkish',
  'arabic',
  'greek',
  'hindi',
  'indonesian',
  'irish',
  'japanese',
  'korean',
  'nepali',
  'tamil',
  'thai',
  'catalan',
  'lithuanian',
  'serbian',
]);

/** Whitelisted FTS config; env overrides bypass settings validation. */
async function safeFtsLanguage(): Promise<string> {
  const language = await getSetting('retrieval.language');
  return FTS_LANGUAGES.has(language) ? language : 'english';
}

interface RetrievalRow {
  id: string;
  content: string;
  document_id: string;
  title: string;
  metadata: { page: number | null };
  similarity: string;
}

export interface SourceHit {
  id: string;
  documentId: string;
  title: string;
  content: string;
  page: number | null;
  similarity: number;
}

function mapRowToSource(row: RetrievalRow): SourceHit {
  return {
    id: row.id,
    documentId: row.document_id,
    title: row.title,
    content: row.content,
    page: row.metadata?.page ?? null,
    similarity: Math.min(1, Math.max(0, Number.parseFloat(row.similarity))),
  };
}

/**
 * Hybrid retrieval: semantic (pgvector cosine) + keyword (Postgres FTS),
 * fused by weighted sum. Falls back to pure vector search when the FTS
 * expression matches nothing (e.g. query is all stop words).
 */
export async function hybridRetrieveChunks(
  workspaceId: string,
  query: string,
): Promise<SourceHit[]> {
  const embedding = await embedTextCached(query);
  const language = await safeFtsLanguage();
  const [similarityWeight, keywordWeight, topK] = await Promise.all([
    getSettingNumber('rag.similarityWeight'),
    getSettingNumber('rag.keywordWeight'),
    getSettingNumber('rag.topK'),
  ]);
  // pgvector accepts array literals as quoted strings: '[0.1,0.2,...]'
  // (an unquoted literal is a SQL syntax error)
  const vectorLiteral = sql.raw(
    `'[${embedding.map((n) => n.toFixed(6)).join(',')}]'`,
  );
  // Language comes from the whitelisted settings options (see
  // safeFtsLanguage), so interpolating it as a regconfig literal is safe.
  // The query text itself stays parameterized.
  const ftsQuery = sql`plainto_tsquery(${sql.raw(`'${language}'`)}, ${query})`;
  const tsVector = sql`to_tsvector(${sql.raw(`'${language}'`)}, c.content)`;

  const similarityExpr = sql`(1 - (c.embedding <=> ${vectorLiteral}::vector))`;
  const keywordExpr = sql`ts_rank(${tsVector}, ${ftsQuery})`;

  const result = await db.execute(
    sql`
      SELECT c.id, c.content, c.document_id, d.title,
             c.metadata, ${similarityExpr} AS similarity
      FROM chunks c
      JOIN documents d ON d.id = c.document_id
      WHERE d.workspace_id = ${workspaceId}
        AND ${tsVector} @@ ${ftsQuery}
      ORDER BY (${similarityExpr} * ${sql.raw(String(similarityWeight))}
             + ${keywordExpr} * ${sql.raw(String(keywordWeight))}) DESC
      LIMIT ${topK}
    `,
  );

  const rows = (result as unknown as { rows: RetrievalRow[] }).rows;

  if (rows.length === 0) {
    // FTS matched nothing -> fall back to pure semantic search
    const vectorOnly = await db.execute(
      sql`
        SELECT c.id, c.content, c.document_id, d.title,
               c.metadata, ${similarityExpr} AS similarity
        FROM chunks c
        JOIN documents d ON d.id = c.document_id
        WHERE d.workspace_id = ${workspaceId}
        ORDER BY ${similarityExpr} DESC
        LIMIT ${topK}
      `,
    );
    return (vectorOnly as unknown as { rows: RetrievalRow[] }).rows.map(
      mapRowToSource,
    );
  }

  return rows.map(mapRowToSource);
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export interface ChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export interface AnswerRequest {
  query: string;
  history: ChatHistoryItem[];
  sources: SourceHit[];
}

export const DEFAULT_SYSTEM_PROMPT = [
  'You are Nexus, a precise retrieval-augmented assistant.',
  "Answer the user's question using ONLY the provided sources.",
  'Cite sources inline with [1], [2], etc., where the numbers correspond to the source list.',
  'If the sources do not contain the answer, say so plainly instead of guessing.',
  'Format answers with Markdown: short paragraphs, bullet lists, fenced code blocks.',
].join(' ');

export function buildMessages(
  req: AnswerRequest,
  systemPrompt: string = DEFAULT_SYSTEM_PROMPT,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const context = req.sources
    .map(
      (source, i) =>
        `[${i + 1}] ("${source.title}"${source.page ? `, page ${source.page}` : ''})\n${source.content}`,
    )
    .join('\n\n');

  const systemContent = systemPrompt || DEFAULT_SYSTEM_PROMPT;

  return [
    { role: 'system', content: systemContent },
    ...req.history.slice(-10),
    {
      role: 'user',
      content: `The following excerpts were retrieved from the user's documents:\n\n${context}\n\nQuestion: ${req.query}`,
    },
  ];
}

export async function streamAnswer(
  req: AnswerRequest,
  sessionId?: string,
): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
  // Fail fast with an actionable message instead of a confusing OpenAI
  // client error deep inside the stream.
  await assertChatConfigured();

  const [model, temperature, systemPrompt] = await Promise.all([
    getSetting('openai.model'),
    getSettingNumber('openai.temperature'),
    getSetting('prompt.system'),
  ]);
  const client = await getOpenAIClient('chat');

  const stream = await client.chat.completions.create(
    {
      model,
      messages: buildMessages(req, systemPrompt),
      temperature,
      stream: true,
      stream_options: { include_usage: true },
    },
    sessionId ? sessionHeaders(sessionId) : undefined,
  );
  return stream;
}

// ---------------------------------------------------------------------------
// Conversation titles
// ---------------------------------------------------------------------------

/**
 * Generate a short conversation title from the first user message. Kept
 * deliberately tolerant: callers treat a failure as non-fatal and fall back
 * to the message-prefix title. No max_tokens is sent - some OpenAI-compatible
 * providers reject it - so the result is capped on the server instead.
 */
export async function generateConversationTitle(
  firstMessage: string,
  sessionId?: string,
): Promise<string> {
  await assertChatConfigured();
  const client = await getOpenAIClient('chat');
  const model = await getSetting('openai.model');

  const prompt = [
    'You name chat conversations.',
    `Generate a short title (at most 6 words, no quotes, no trailing punctuation) for a conversation that starts with this user message:`,
    firstMessage.slice(0, 500),
    'Reply with ONLY the title.',
  ].join('\n');

  const completion = await client.chat.completions.create(
    {
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    },
    sessionId ? sessionHeaders(sessionId) : undefined,
  );

  const raw = completion.choices[0]?.message?.content?.trim() ?? '';
  const title = raw.replace(/^["']+|["']+$/g, '').trim();
  if (!title) {
    throw new Error('LLM returned an empty conversation title');
  }
  return title.slice(0, 80);
}
