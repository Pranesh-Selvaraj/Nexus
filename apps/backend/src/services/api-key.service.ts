import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import type {
  ApiKeyDTO,
  ApiScope,
  CreateApiKeyInput,
  CreatedApiKey,
} from '@nexus/shared-types';
import { API_SCOPES } from '@nexus/shared-types';

import { db } from '../db/index.js';
import { apiKeys } from '../db/schema.js';

/** Prefix of every Nexus API key, so leaked secrets are recognisable. */
export const API_KEY_NAMESPACE = 'ndx_';

const PREFIX_BYTES = 6;
const SECRET_BYTES = 32;
/** Keys are re-hashed for comparison on every request: keep this cheap. */
const KEY_PATTERN = /^ndx_([a-f0-9]{12})_[A-Za-z0-9_-]{20,}$/;

/** Updated at most once a minute so authentication stays a single query. */
const LAST_USED_REFRESH_MS = 60_000;

export interface ApiKeyIdentity {
  apiKeyId: string;
  userId: string;
  scopes: ApiScope[];
}

export interface ApiKeyRow {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  keyHash: string;
  scopes: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Cheap shape check before touching the database. */
export function isApiKeyFormat(raw: string): boolean {
  return KEY_PATTERN.test(raw);
}

/** Drop scopes this build does not know (old rows, hand-edited data). */
export function knownScopes(scopes: readonly string[]): ApiScope[] {
  return scopes.filter((scope): scope is ApiScope =>
    (API_SCOPES as string[]).includes(scope),
  );
}

function toDTO(row: ApiKeyRow): ApiKeyDTO {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    // Rows created before a scope was added would otherwise show an unknown
    // scope; only known scopes are surfaced.
    scopes: knownScopes(row.scopes),
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

/**
 * Create a key and return its plaintext exactly once. Only the sha256 of the
 * full key is stored, along with a short prefix for display and lookup, so
 * neither a database dump nor a log line can be replayed against the API.
 */
export async function createApiKey(
  userId: string,
  input: CreateApiKeyInput,
): Promise<CreatedApiKey> {
  const scopes = [...new Set(input.scopes)];
  if (scopes.length === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Pick at least one permission for this key',
    });
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    // Hex keeps the prefix separator-safe: base64url can itself contain '_'.
    const prefix = randomBytes(PREFIX_BYTES).toString('hex');
    const secret = randomBytes(SECRET_BYTES).toString('base64url');
    const key = `${API_KEY_NAMESPACE}${prefix}_${secret}`;
    const [row] = await db
      .insert(apiKeys)
      .values({
        userId,
        name: input.name,
        prefix,
        keyHash: hashApiKey(key),
        scopes,
      })
      .onConflictDoNothing({ target: apiKeys.prefix })
      .returning();
    if (row) {
      return { ...toDTO(row as unknown as ApiKeyRow), key };
    }
  }
  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Could not allocate a key prefix, please retry',
  });
}

export async function listApiKeys(userId: string): Promise<ApiKeyDTO[]> {
  const rows = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(desc(apiKeys.createdAt));
  return rows.map((row) => toDTO(row as unknown as ApiKeyRow));
}

/** Soft-revoke one of the caller's keys. Returns false when it does not exist. */
export async function revokeApiKey(
  userId: string,
  id: string,
): Promise<boolean> {
  const updated = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiKeys.id, id),
        eq(apiKeys.userId, userId),
        isNull(apiKeys.revokedAt),
      ),
    )
    .returning({ id: apiKeys.id });
  return updated.length > 0;
}

/**
 * Resolve a bearer key to its identity. Returns null for malformed, unknown
 * or revoked keys - callers must not distinguish those cases in responses.
 */
export async function verifyApiKey(
  raw: string,
  now: Date = new Date(),
): Promise<ApiKeyIdentity | null> {
  if (!isApiKeyFormat(raw)) return null;
  const prefix = KEY_PATTERN.exec(raw)?.[1] ?? '';
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.prefix, prefix), isNull(apiKeys.revokedAt)))
    .limit(1);
  if (!row) return null;

  const expected = Buffer.from(row.keyHash, 'utf8');
  const actual = Buffer.from(hashApiKey(raw), 'utf8');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  if (
    !row.lastUsedAt ||
    now.getTime() - row.lastUsedAt.getTime() > LAST_USED_REFRESH_MS
  ) {
    // Best-effort bookkeeping: a failed touch must never reject a valid key.
    void db
      .update(apiKeys)
      .set({ lastUsedAt: now })
      .where(eq(apiKeys.id, row.id))
      .catch(() => undefined);
  }

  return {
    apiKeyId: row.id,
    userId: row.userId,
    scopes: knownScopes(row.scopes),
  };
}

export function hasScope(
  identity: Pick<ApiKeyIdentity, 'scopes'>,
  scope: ApiScope,
): boolean {
  return identity.scopes.includes(scope);
}

/** Count of active keys, used by the settings UI header. */
export async function countActiveApiKeys(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)));
  return Number(row?.count ?? 0);
}
