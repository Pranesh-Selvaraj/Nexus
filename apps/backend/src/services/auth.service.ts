import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

import { eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import { sessions, users } from '../db/schema.js';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

export const SESSION_COOKIE = 'nexus_session';
export const SESSION_TTL_MS =
  Number(process.env.SESSION_TTL_DAYS ?? 30) * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Password hashing (node:crypto scrypt - no native dependencies)
// ---------------------------------------------------------------------------

const SCRYPT_KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, SCRYPT_KEYLEN);
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, salt, hash] = stored.split(':');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const derived = await scryptAsync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, 'hex');
  return (
    derived.length === expected.length && timingSafeEqual(derived, expected)
  );
}

// ---------------------------------------------------------------------------
// Sessions (token in an httpOnly cookie, sha256 hash at rest)
// ---------------------------------------------------------------------------

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

export async function createSession(userId: string): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const token =
    randomUUID().replace(/-/g, '') + randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
  });
  return { token, expiresAt };
}

/** Resolves a session token to its user, pruning expired rows lazily. */
export async function getUserBySessionToken(
  token: string | undefined,
): Promise<SessionUser | null> {
  if (!token) return null;

  const [session] = await db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      expiresAt: sessions.expiresAt,
      email: users.email,
      name: users.name,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, hashToken(token)))
    .limit(1);
  if (!session) return null;

  if (session.expiresAt.getTime() < Date.now()) {
    await db
      .delete(sessions)
      .where(eq(sessions.id, session.id))
      .catch(() => undefined);
    return null;
  }

  return { id: session.userId, email: session.email, name: session.name };
}

export async function deleteSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}
