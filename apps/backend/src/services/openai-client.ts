import OpenAI from 'openai';

import { getSetting } from './settings.service.js';

export type OpenAIClientKind = 'chat' | 'embedding';

const CHAT_TIMEOUT_MS = 120_000;
const EMBEDDING_TIMEOUT_MS = 60_000;

/** Connection config for one request kind. */
export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
}

/**
 * Embedding requests prefer dedicated embedding-provider settings and fall
 * back to the main (chat) provider when they are unset. Chat always uses the
 * main provider. Pure so the fallback can be unit-tested without a database.
 */
export function resolveProviderConfig(
  kind: OpenAIClientKind,
  main: ProviderConfig,
  embedding: ProviderConfig,
): ProviderConfig {
  if (kind === 'embedding') {
    return {
      apiKey: embedding.apiKey || main.apiKey,
      baseUrl: embedding.baseUrl || main.baseUrl,
    };
  }
  return main;
}

/** Effective provider config for a request kind (UI > env > default). */
export async function getProviderConfig(
  kind: OpenAIClientKind,
): Promise<ProviderConfig> {
  const [mainApiKey, mainBaseUrl, embeddingApiKey, embeddingBaseUrl] =
    await Promise.all([
      getSetting('openai.apiKey'),
      getSetting('openai.baseUrl'),
      getSetting('openai.embeddingApiKey'),
      getSetting('openai.embeddingBaseUrl'),
    ]);
  return resolveProviderConfig(
    kind,
    { apiKey: mainApiKey, baseUrl: mainBaseUrl },
    { apiKey: embeddingApiKey, baseUrl: embeddingBaseUrl },
  );
}

/**
 * Cached OpenAI clients, keyed by (kind, apiKey, baseUrl, timeout).
 *
 * Settings are re-read per call (cheap - the settings service caches them),
 * but the client instance - and with it the connection pool / auth state -
 * is reused across requests instead of being rebuilt for every chat message
 * and embedding batch. The cache is bounded: on config churn (e.g. switching
 * providers in the UI) old entries are dropped once the map grows.
 */
const clients = new Map<string, OpenAI>();
const MAX_CACHED_CLIENTS = 10;

function clientKey(
  kind: OpenAIClientKind,
  apiKey: string,
  baseUrl: string,
  timeoutMs: number,
): string {
  return `${kind}|${apiKey}|${baseUrl ?? ''}|${timeoutMs}`;
}

/** Resolve (or create) the OpenAI client for a request kind. */
export async function getOpenAIClient(kind: OpenAIClientKind): Promise<OpenAI> {
  const { apiKey, baseUrl } = await getProviderConfig(kind);
  // Local providers accept any key; the OpenAI SDK requires a non-empty string.
  const effectiveKey = apiKey || 'local';
  const timeoutMs = kind === 'chat' ? CHAT_TIMEOUT_MS : EMBEDDING_TIMEOUT_MS;

  const key = clientKey(kind, effectiveKey, baseUrl, timeoutMs);
  const existing = clients.get(key);
  if (existing) return existing;

  if (clients.size >= MAX_CACHED_CLIENTS) clients.clear();
  const client = new OpenAI({
    apiKey: effectiveKey,
    baseURL: baseUrl || undefined,
    timeout: timeoutMs,
    maxRetries: 2,
  });
  clients.set(key, client);
  return client;
}

/** Drop all cached clients (used by tests). */
export function clearOpenAIClientCache(): void {
  clients.clear();
}
