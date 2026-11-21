import { z } from 'zod';
import { sourceSchema } from './chat.js';
import { usageSchema } from './retrieval.js';

/**
 * What a key is allowed to do. Scopes are additive and checked per route, so
 * a read-only integration can never upload or answer on the owner's behalf.
 */
export const apiScopeSchema = z.enum([
  'search',
  'ask',
  'documents:read',
  'documents:write',
  'reviews:read',
  'reviews:write',
  'notes:write',
]);
export type ApiScope = z.infer<typeof apiScopeSchema>;

/** Every scope is enforced by at least one REST route. */
export const API_SCOPES: ApiScope[] = [
  'search',
  'ask',
  'documents:read',
  'documents:write',
  'reviews:read',
  'reviews:write',
  'notes:write',
];

export const API_SCOPE_LABELS: Record<ApiScope, string> = {
  search: 'Search the library',
  ask: 'Ask grounded questions',
  'documents:read': 'List documents and workspaces',
  'documents:write': 'Upload documents and import URLs',
  'reviews:read': 'Read due cards',
  'reviews:write': 'Submit reviews',
  'notes:write': 'Create notes',
};

export const apiKeyDTOSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  /** First characters only; the secret itself is never stored or returned again. */
  prefix: z.string(),
  scopes: z.array(apiScopeSchema),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
export type ApiKeyDTO = z.infer<typeof apiKeyDTOSchema>;

export const createApiKeyInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(apiScopeSchema).min(1),
});
export type CreateApiKeyInput = z.infer<typeof createApiKeyInputSchema>;

export const createdApiKeySchema = apiKeyDTOSchema.extend({
  /** The full key. Returned exactly once, at creation time. */
  key: z.string(),
});
export type CreatedApiKey = z.infer<typeof createdApiKeySchema>;

export const revokeApiKeyInputSchema = z.object({
  id: z.string().uuid(),
});

/** POST /api/v1/ask body. Non-streaming by design: integrations get one payload. */
export const askInputSchema = z.object({
  workspaceId: z.string().uuid(),
  question: z.string().trim().min(1).max(8000),
  /** Optional persona id (default, socratic, art-critic, ...). */
  persona: z.string().max(64).optional(),
});
export type AskInput = z.infer<typeof askInputSchema>;

export const askResultSchema = z.object({
  answer: z.string(),
  sources: z.array(sourceSchema),
  /** The query actually searched (after optional rewrite). */
  query: z.string(),
  usage: usageSchema.nullable(),
  /** Wall-clock split for the request, in milliseconds. */
  timings: z.object({
    retrievalMs: z.number(),
    answerMs: z.number(),
    totalMs: z.number(),
    /** Time to the first streamed token; null when the provider sent none. */
    firstTokenMs: z.number().nullable(),
  }),
});
export type AskResult = z.infer<typeof askResultSchema>;

export const searchResultSchema = z.object({
  query: z.string(),
  sources: z.array(sourceSchema),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

/** GET /api/v1/search query string (limit is coerced from the URL). */
export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(2000),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;
