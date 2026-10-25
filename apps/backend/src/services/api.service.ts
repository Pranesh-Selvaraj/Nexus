import { performance } from 'node:perf_hooks';

import { and, eq } from 'drizzle-orm';

import type { AskResult, SearchResult, Source } from '@nexus/shared-types';

import { db } from '../db/index.js';
import { workspaces } from '../db/schema.js';
import { streamAnswer } from './llm.service.js';
import {
  chatTokens,
  chatTtft,
  retrievalDuration,
} from './observability/metrics.js';
import { retrieveForChat, validateCitations } from './retrieval.service.js';

/** Thrown by the API-v1 service; the route maps `status` onto the response. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 404 rather than 403 so a key cannot probe other users' workspace ids. */
export async function assertWorkspaceOwner(
  workspaceId: string,
  userId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.userId, userId)))
    .limit(1);
  if (!row) throw new ApiError('Workspace not found', 404);
}

/**
 * One retrieval pass for the public search endpoint. Uses exactly the chat
 * retrieval configuration (rewrite is skipped because there is no history),
 * so an integration sees the same ranking a chat answer would.
 */
export async function searchWorkspace(params: {
  workspaceId: string;
  userId: string;
  query: string;
  limit?: number;
}): Promise<SearchResult> {
  await assertWorkspaceOwner(params.workspaceId, params.userId);
  const startedAt = performance.now();
  const retrieval = await retrieveForChat({
    workspaceId: params.workspaceId,
    query: params.query,
    history: [],
  });
  retrievalDuration.observe(
    { stage: 'api-search' },
    (performance.now() - startedAt) / 1000,
  );
  const sources = params.limit
    ? retrieval.sources.slice(0, params.limit)
    : retrieval.sources;
  return { query: retrieval.searchQuery, sources };
}

/**
 * Non-streaming answer for the public API: retrieve, stream the provider
 * response into one string, record TTFT/token metrics and mark which sources
 * the answer actually cited. The chat UI keeps its streaming path; this is the
 * same prompt and retrieval, collapsed for integrations.
 */
export async function answerQuestion(params: {
  workspaceId: string;
  userId: string;
  question: string;
  persona?: string;
  sessionId?: string;
}): Promise<AskResult> {
  await assertWorkspaceOwner(params.workspaceId, params.userId);

  const requestStartedAt = performance.now();
  const retrieval = await retrieveForChat({
    workspaceId: params.workspaceId,
    query: params.question,
    history: [],
  });
  const retrievalMs = performance.now() - requestStartedAt;
  retrievalDuration.observe({ stage: 'api-ask' }, retrievalMs / 1000);

  const answerStartedAt = performance.now();
  const stream = await streamAnswer(
    {
      query: params.question,
      history: [],
      sources: retrieval.sources,
      persona: params.persona,
    },
    params.sessionId,
  );

  let answer = '';
  let firstTokenMs: number | null = null;
  let usage: AskResult['usage'] = null;
  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content;
    if (token) {
      if (firstTokenMs === null) {
        firstTokenMs = performance.now() - requestStartedAt;
        chatTtft.observe(firstTokenMs / 1000);
      }
      answer += token;
    }
    if (chunk.usage) {
      usage = {
        promptTokens: chunk.usage.prompt_tokens,
        completionTokens: chunk.usage.completion_tokens,
        totalTokens: chunk.usage.total_tokens,
      };
      chatTokens.inc({ kind: 'prompt' }, chunk.usage.prompt_tokens);
      chatTokens.inc({ kind: 'completion' }, chunk.usage.completion_tokens);
    }
  }

  const answerMs = performance.now() - answerStartedAt;
  const cited = new Set(validateCitations(answer, retrieval.sources.length));
  const sources: Source[] = retrieval.sources.map((source, index) => ({
    ...source,
    cited: cited.has(index + 1),
  }));

  return {
    answer,
    sources,
    query: retrieval.searchQuery,
    usage,
    timings: {
      retrievalMs: Math.round(retrievalMs),
      answerMs: Math.round(answerMs),
      totalMs: Math.round(performance.now() - requestStartedAt),
      firstTokenMs: firstTokenMs === null ? null : Math.round(firstTokenMs),
    },
  };
}
