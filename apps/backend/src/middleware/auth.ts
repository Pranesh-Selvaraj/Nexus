import { initTRPC, TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import type { UserDTO } from '@nexus/shared-types';

import { db } from '../db';
import { users } from '../db/schema';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface Context {
  user: UserDTO | null;
}

export const t = initTRPC.context<Context>().create();

// ---------------------------------------------------------------------------
// Identity - this is a single-user, personal tool. There is no
// authentication: every request is served as the local user.
// ---------------------------------------------------------------------------

export const LOCAL_USER_EMAIL = process.env.LOCAL_USER_EMAIL ?? 'local@nexus.dev';

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

// ---------------------------------------------------------------------------
// Context factories (HTTP + WebSocket)
// ---------------------------------------------------------------------------

export async function createExpressContext(): Promise<Context> {
  return { user: await getOrCreateLocalUser() };
}

export async function createWSSContext(): Promise<Context> {
  return { user: await getOrCreateLocalUser() };
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Local user could not be resolved',
    });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});