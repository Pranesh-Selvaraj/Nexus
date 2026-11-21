import './utils/env.js';

import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

import { applyWSSHandler } from '@trpc/server/adapters/ws';
import { eq, ne } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { WebSocketServer } from 'ws';

import { db, pool } from './db/index.js';
import { sessions, users, workspaces } from './db/schema.js';
import { createApp } from './http/app.js';
import { createWSSContext, LOCAL_USER_EMAIL } from './middleware/auth.js';
import { config } from './platform/config.js';
import { appRouter } from './routers/_app.js';
import { hashPassword, verifyPassword } from './services/auth.service.js';
import { storage } from './services/storage/index.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../drizzle', import.meta.url));
const WS_PATH = '/ws';

async function waitForDatabase(): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (Date.now() > deadline) {
        console.error('[boot] database unreachable:', err);
        process.exit(1);
      }
      console.log('[boot] waiting for database...');
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}

/**
 * First-boot data preparation: adopt pre-auth workspaces, then (when auth is
 * on) hash `AUTH_PASSWORD` onto the local account and invalidate sessions if
 * the credential changed.
 */
async function prepareLocalUser(): Promise<void> {
  const [localUser] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, LOCAL_USER_EMAIL))
    .limit(1);

  if (localUser) {
    await db
      .update(workspaces)
      .set({ userId: localUser.id })
      .where(ne(workspaces.userId, localUser.id));
    console.log('[boot] workspaces adopted by local user');
  }

  const password = config.auth.password;
  if (!password) {
    console.warn(
      '[boot] WARNING: AUTH_PASSWORD not set - running in single-user no-auth mode. Set AUTH_PASSWORD when exposing publicly (see SECURITY.md).',
    );
    return;
  }

  if (!localUser) {
    throw new Error(
      `AUTH_PASSWORD is set but the local user (${LOCAL_USER_EMAIL}) could not be resolved`,
    );
  }

  const unchanged = await verifyPassword(password, localUser.passwordHash);
  if (unchanged) {
    console.log('[boot] authentication enabled - login required');
    return;
  }

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(users.id, localUser.id));
  await db.delete(sessions).where(eq(sessions.userId, localUser.id));
  console.log(
    '[boot] authentication enabled - login required (existing sessions invalidated)',
  );
}

/** Boot the API: migrations, local account, HTTP app, WebSocket transport. */
export async function main(): Promise<void> {
  await waitForDatabase();
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  console.log('[boot] database migrations applied');

  await prepareLocalUser();

  const app = createApp();
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: WS_PATH });
  applyWSSHandler({
    wss,
    router: appRouter,
    createContext: createWSSContext,
  });

  httpServer.listen(config.port, () => {
    console.log(`[api] listening on http://localhost:${config.port}`);
    console.log(
      `[api] ws subscriptions on ws://localhost:${config.port}${WS_PATH}`,
    );
    console.log(`[api] document storage: ${storage.description}`);
    if (!config.providers.openaiKey) {
      console.warn(
        '[api] WARNING: OPENAI_API_KEY not set - chat and embeddings will fail',
      );
    }
  });

  const shutdown = (signal: string): void => {
    console.log(`[api] ${signal} received, shutting down...`);
    wss.close();
    httpServer.close(() => {
      void pool.end().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
