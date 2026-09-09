import { createHash } from 'node:crypto';

import { Redis } from 'ioredis';

import {
  getOpenAIClient,
  getProviderConfig,
  sessionHeaders,
} from './openai-client.js';
import type { ProviderConfig } from './openai-client.js';

import { getSetting } from './settings.service.js';

const BATCH_SIZE = 100;

const EMBEDDING_MODEL_FALLBACK = 'text-embedding-3-small';

// ---------------------------------------------------------------------------
// Query embedding cache
//
// Chat re-embeds the user's question on every message. Query embeddings are
// cheap to cache: the key includes the embedding model so switching models
// (or dimensions) never serves stale vectors. Best-effort: any Redis failure
// falls back to embedding directly - the cache is an optimization, never a
// dependency of retrieval.
// ---------------------------------------------------------------------------

const QUERY_CACHE_TTL_S = 60 * 60 * 24; // 24h

const queryCacheRedis = new Redis(
  process.env.REDIS_URL ?? 'redis://localhost:6379',
  {
    // Fail fast instead of queueing commands while disconnected.
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  },
);
// Cache errors are handled per-operation; silence the default log spam.
queryCacheRedis.on('error', () => undefined);

/**
 * Embed a single query string with a Redis-backed cache, keyed by
 * embedding model + sha256 of the text (24h TTL).
 */
export async function embedTextCached(text: string): Promise<number[]> {
  const [model, dims] = await Promise.all([
    getSetting('openai.embeddingModel'),
    getSetting('embedding.dimensions'),
  ]);
  const effectiveModel = model || EMBEDDING_MODEL_FALLBACK;
  // Key includes the dimensions: changing the setting must never serve
  // vectors of the wrong length (pgvector rejects mismatched dimensions).
  const key = `qemb:${effectiveModel}:${dims}:${createHash('sha256').update(text).digest('hex')}`;

  try {
    const hit = await queryCacheRedis.get(key);
    if (hit) {
      const parsed: unknown = JSON.parse(hit);
      if (
        Array.isArray(parsed) &&
        parsed.length > 0 &&
        parsed.every((n) => typeof n === 'number')
      ) {
        return parsed;
      }
    }
  } catch {
    // Cache read failed - embed anyway (best-effort cache)
  }

  const vector = await embedText(text);

  try {
    await queryCacheRedis.set(
      key,
      JSON.stringify(vector),
      'EX',
      QUERY_CACHE_TTL_S,
    );
  } catch {
    // Cache write failed - the embedding itself is still valid
  }
  return vector;
}

/**
 * Resolve the effective embedding model (settings > env > default).
 */
async function embeddingModel(): Promise<string> {
  const model = await getSetting('openai.embeddingModel');
  return model || EMBEDDING_MODEL_FALLBACK;
}

/**
 * Local providers (Ollama, LM Studio, ...) don't need an API key - it is
 * only required when talking to OpenAI's cloud (no base URL). The
 * .env.example placeholder never counts as a configured key.
 */
const PLACEHOLDER_KEY = 'sk-your-key-here';

function isRealKey(apiKey: string): boolean {
  return Boolean(apiKey) && apiKey !== PLACEHOLDER_KEY;
}

/** Fail fast when neither a base URL nor a real key is configured. */
function assertConfigured(
  kind: 'chat' | 'embedding',
  config: ProviderConfig,
): void {
  if (config.baseUrl || isRealKey(config.apiKey)) return;
  if (kind === 'chat') {
    throw new Error(
      'No API key configured. Set OPENAI_API_KEY, or set an API base URL for a local provider, in .env or the settings panel.',
    );
  }
  throw new Error(
    'No embedding provider configured. Set OPENAI_EMBEDDING_BASE_URL / OPENAI_EMBEDDING_API_KEY for a separate embedding provider, or the main OPENAI_API_KEY / OPENAI_BASE_URL, in .env or the settings panel.',
  );
}

/** Chat is served by the main provider settings. */
export async function assertChatConfigured(): Promise<void> {
  assertConfigured('chat', await getProviderConfig('chat'));
}

/**
 * Embeddings use the dedicated embedding-provider settings and fall back
 * to the main provider when unset. Chat-only providers (OpenCode Zen, ...)
 * have no embeddings endpoint and need the dedicated settings.
 */
export async function assertEmbeddingsConfigured(): Promise<void> {
  assertConfigured('embedding', await getProviderConfig('embedding'));
}

/**
 * Vector dimensions expected for stored embeddings (settings-driven).
 */
export async function getEmbeddingDimensions(): Promise<number> {
  return Number(await getSetting('embedding.dimensions')) || 1536;
}

/**
 * Embed a list of texts, chunking into groups of 100 per OpenAI request.
 * Returns vectors in the same order as the input texts. Clients are cached
 * and keyed by config, so settings changes apply without a restart.
 */
export async function embedTexts(
  texts: string[],
  sessionId?: string,
): Promise<number[][]> {
  await assertEmbeddingsConfigured();
  const model = await embeddingModel();
  const client = await getOpenAIClient('embedding');

  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await client.embeddings.create(
      {
        model,
        input: batch,
        // The SDK defaults to base64-encoded embeddings (OpenAI-only). Local
        // providers return plain floats, so request float explicitly.
        encoding_format: 'float',
      },
      sessionId ? sessionHeaders(sessionId) : undefined,
    );
    if (response.data.length !== batch.length) {
      throw new Error(
        `Embedding count mismatch: expected ${batch.length}, got ${response.data.length}`,
      );
    }
    for (const item of response.data) {
      vectors.push(item.embedding);
    }
  }
  return vectors;
}

export async function embedText(text: string): Promise<number[]> {
  const [vector] = await embedTexts([text]);
  if (!vector) throw new Error('Embedding request returned no vectors');
  return vector;
}
