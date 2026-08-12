import { initTRPC, TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import type { UserDTO } from '@nexus/shared-types';

import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import {
  getUserBySessionToken,
  SESSION_COOKIE,
} from '../services/auth.service.js';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface Context {
  user: UserDTO | null;
  sessionToken: string | undefined;
}

export const t = initTRPC.context<Context>().create();

// ---------------------------------------------------------------------------
// Identity - single-user app with optional password authentication.
//
// * When AUTH_PASSWORD is set, every request must carry a valid session
//   cookie obtained from POST /api/auth/login (email + password).
// * When it is unset (local development), the app keeps the legacy
//   behavior: every request is served as the local user, with a boot
//   warning. See SECURITY.md before exposing the app publicly.
// ---------------------------------------------------------------------------

export const LOCAL_USER_EMAIL =
  process.env.LOCAL_USER_EMAIL ?? 'local@nexus.dev';

export function authEnabled(): boolean {
  return Boolean(process.env.AUTH_PASSWORD);
}

/** Returns the local user row, creating it on first boot. */
async function getOrCreateLocalUser(): Promise<UserDTO> {
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.email, LOCAL_USER_EMAIL))
    .limit(1);
  if (row) return { id: row.id, email: row.email, name: row.name };

  const [created] = await db
    .insert(users)
    .values({
      email: LOCAL_USER_EMAIL,
      passwordHash: 'unused-no-auth',
      name: 'Local User',
    })
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id, email: users.email, name: users.name });
  if (!created) {
    return getOrCreateLocalUser();
  }
  return { id: created.id, email: created.email, name: created.name };
}

async function resolveUser(
  sessionToken: string | undefined,
): Promise<UserDTO | null> {
  if (authEnabled()) {
    return getUserBySessionToken(sessionToken);
  }
  return getOrCreateLocalUser();
}

export { resolveUser };

function readSessionCookie(
  headers: Record<string, string | string[] | undefined>,
): string | undefined {
  const cookieHeader = headers.cookie ?? headers.Cookie;
  if (!cookieHeader) return undefined;
  const cookies = Array.isArray(cookieHeader)
    ? cookieHeader.join('; ')
    : cookieHeader;
  for (const part of cookies.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return rest.join('=');
  }
  return undefined;
}

export { readSessionCookie };

// ---------------------------------------------------------------------------
// Context factories (HTTP + WebSocket)
// ---------------------------------------------------------------------------

export async function createExpressContext(opts: {
  req: { headers: Record<string, string | string[] | undefined> };
}): Promise<Context> {
  const sessionToken = readSessionCookie(opts.req.headers);
  return { user: await resolveUser(sessionToken), sessionToken };
}

export async function createWSSContext(opts: {
  req: { headers: Record<string, string | string[] | undefined> };
}): Promise<Context> {
  const sessionToken = readSessionCookie(opts.req.headers);
  return { user: await resolveUser(sessionToken), sessionToken };
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Not authenticated',
    });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});
