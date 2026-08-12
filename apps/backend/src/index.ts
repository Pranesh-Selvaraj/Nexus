import './utils/env.js';

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { applyWSSHandler } from '@trpc/server/adapters/ws';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { and, eq, ne } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { WebSocketServer } from 'ws';
import { workspaceIdSchema } from '@nexus/shared-types';

import { db, pool } from './db/index.js';
import { documents, users, workspaces } from './db/schema.js';
import {
  authEnabled,
  createExpressContext,
  createWSSContext,
  LOCAL_USER_EMAIL,
  readSessionCookie,
  resolveUser,
} from './middleware/auth.js';
import { enqueueDocumentEmbedding, redisConnection } from './queues/index.js';
import { appRouter } from './routers/_app.js';
import { UPLOAD_DIR } from './utils/paths.js';
import { sanitizeForLog, upload } from './utils/multer.config.js';
import { toDocumentDTO } from './utils/dto.js';
import { getSettingNumber } from './services/settings.service.js';
import {
  createSession,
  deleteSession,
  hashPassword,
  SESSION_COOKIE,
  sessionTtlMs,
  verifyPassword,
} from './services/auth.service.js';

const PORT = Number(process.env.PORT ?? 3000);
const WS_PATH = '/ws';
const MIGRATIONS_DIR = fileURLToPath(new URL('../drizzle', import.meta.url));

// ---------------------------------------------------------------------------
// Boot helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Health check
//
// Probes Postgres and Redis with memoized results (refreshed every 5s) so a
// container orchestrator can distinguish 'process up' from 'actually healthy'.
// ---------------------------------------------------------------------------

interface DependencyStatus {
  db: boolean;
  redis: boolean;
}

let healthCache: { at: number; status: DependencyStatus } | null = null;

async function checkDependencies(): Promise<DependencyStatus> {
  const now = Date.now();
  if (healthCache && now - healthCache.at < 5_000) {
    return healthCache.status;
  }

  let db = false;
  try {
    await pool.query('SELECT 1');
    db = true;
  } catch {
    // probe failed - reported below
  }

  let redis = false;
  try {
    const pong = await redisConnection.ping();
    redis = pong === 'PONG';
  } catch {
    // probe failed - reported below
  }

  healthCache = { at: now, status: { db, redis } };
  return healthCache.status;
}

async function main(): Promise<void> {
  await waitForDatabase();
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  console.log('[boot] database migrations applied');

  // Pre-auth era workspaces (created under other user ids) are adopted by
  // the local user so nothing is lost when dropping authentication.
  const [localUser] = await db
    .select({ id: users.id })
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

  // Optional authentication: when AUTH_PASSWORD is set, store its scrypt
  // hash on the local user so login can verify against the database.
  if (authEnabled()) {
    if (!localUser) {
      throw new Error(
        `AUTH_PASSWORD is set but the local user (${LOCAL_USER_EMAIL}) could not be resolved`,
      );
    }
    await db
      .update(users)
      .set({
        passwordHash: await hashPassword(process.env.AUTH_PASSWORD as string),
      })
      .where(eq(users.id, localUser.id));
    console.log('[boot] authentication enabled - login required');
  } else {
    console.warn(
      '[boot] WARNING: AUTH_PASSWORD not set - running in single-user no-auth mode. Set AUTH_PASSWORD when exposing publicly (see SECURITY.md).',
    );
  }

  const app = express();
  app.disable('x-powered-by');
  // Behind the nginx reverse proxy (docker-compose.prod.yml) - lets
  // express-rate-limit read X-Forwarded-For from loopback proxies only.
  app.set('trust proxy', 'loopback');

  const origins = (process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.use(cors({ origin: origins }));
  app.use(express.json({ limit: '1mb' }));

  // --- Authentication (optional, see middleware/auth.ts) -----------------
  // Cookie: httpOnly + SameSite=Lax; Secure only when explicitly enabled
  // (behind a TLS-terminating proxy).
  const secureCookie = process.env.AUTH_COOKIE_SECURE === 'true';
  const sessionCookie = (token: string, maxAgeSec: number): string =>
    `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSec}${secureCookie ? '; Secure' : ''}`;

  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many login attempts, please retry later' },
  });

  app.post('/api/auth/login', loginLimiter, async (req, res) => {
    try {
      if (!authEnabled()) {
        res.status(403).json({ error: 'Authentication is disabled' });
        return;
      }
      const { email, password } = (req.body ?? {}) as {
        email?: unknown;
        password?: unknown;
      };
      if (typeof email !== 'string' || typeof password !== 'string') {
        res.status(400).json({ error: 'Email and password are required' });
        return;
      }

      const [user] = await db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          passwordHash: users.passwordHash,
        })
        .from(users)
        .where(eq(users.email, email.trim().toLowerCase()))
        .limit(1);
      if (!user || !(await verifyPassword(password, user.passwordHash))) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }

      const { token, expiresAt } = await createSession(user.id);
      res.setHeader(
        'Set-Cookie',
        sessionCookie(token, Math.floor((await sessionTtlMs()) / 1000)),
      );
      res.json({
        user: { id: user.id, email: user.email, name: user.name },
        expiresAt: expiresAt.toISOString(),
      });
    } catch (err) {
      console.error('[auth] login failed:', sanitizeForLog(err));
      res.status(500).json({ error: 'Login failed' });
    }
  });

  app.post('/api/auth/logout', async (req, res) => {
    const token = readSessionCookie(req.headers);
    await deleteSession(token);
    res.setHeader('Set-Cookie', sessionCookie('', 0));
    res.json({ ok: true });
  });

  app.get('/api/auth/me', async (req, res) => {
    const user = await resolveUser(readSessionCookie(req.headers));
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    res.json({ user });
  });

  // --- File upload (multipart, multer) --------------------------------
  // Files arrive in memory (multer memoryStorage) and are written by the
  // handler to a path built only from validated, server-controlled parts:
  // <uploads>/<validated workspace uuid>/<server randomUUID>. Every failure
  // path removes the written file so nothing is orphaned on disk.
  const uploadLimiter = rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many uploads, please retry in a minute' },
  });
  // Size limit is read from settings per request so UI changes apply
  // without a restart; multer's hard cap follows the env value.
  const enforceUploadLimit: express.RequestHandler = async (req, res, next) => {
    try {
      const maxMb = await getSettingNumber('server.maxUploadMb');
      const maxBytes = maxMb * 1024 * 1024;
      const declared = Number(req.headers['content-length'] ?? 0);
      if (declared > maxBytes) {
        res
          .status(413)
          .json({ error: `File exceeds the ${maxMb} MB upload limit` });
        return;
      }
      next();
    } catch (err) {
      console.error('[upload] limit check failed:', sanitizeForLog(err));
      next();
    }
  };
  app.post(
    '/api/upload',
    uploadLimiter,
    enforceUploadLimit,
    upload.single('file'),
    async (req, res) => {
      let storedPath: string | null = null;
      let success = false;
      try {
        // 1. Validate workspaceId as a UUID *before* touching the filesystem.
        //    Raw input must never reach path construction (CWE-22).
        const parsed = workspaceIdSchema.safeParse({
          workspaceId: String(req.body?.workspaceId ?? ''),
        });
        if (!parsed.success) {
          res
            .status(400)
            .json({ error: 'Invalid workspaceId: expected a UUID' });
          return;
        }
        const workspaceId = parsed.data.workspaceId;

        // 2. Resolve the session user (or the local user in no-auth mode)
        //    and verify workspace ownership (matches the tRPC routers'
        //    behavior instead of trusting an unauthenticated body).
        const currentUser = await resolveUser(readSessionCookie(req.headers));
        if (!currentUser) {
          res.status(401).json({ error: 'Not authenticated' });
          return;
        }
        const [workspace] = await db
          .select({ id: workspaces.id })
          .from(workspaces)
          .where(
            and(
              eq(workspaces.id, workspaceId),
              eq(workspaces.userId, currentUser.id),
            ),
          )
          .limit(1);
        if (!workspace) {
          res.status(404).json({ error: 'Workspace not found' });
          return;
        }

        if (!req.file) {
          res.status(400).json({ error: 'No file provided' });
          return;
        }

        // 3. Write the buffer under a path built from validated inputs only.
        const workspaceDir = path.join(UPLOAD_DIR, workspace.id);
        await mkdir(workspaceDir, { recursive: true });
        const finalPath = path.join(workspaceDir, randomUUID());
        storedPath = finalPath;
        await writeFile(finalPath, req.file.buffer);

        // 4. Derive the stored file type from the original name (metadata only,
        //    never a path).
        const fileType =
          path.extname(req.file.originalname).slice(1).toLowerCase() || 'txt';
        const relativePath = path
          .relative(UPLOAD_DIR, finalPath)
          .split(path.sep)
          .join('/');

        const [created] = await db
          .insert(documents)
          .values({
            workspaceId: workspace.id,
            title: req.file.originalname,
            filePath: relativePath,
            fileType,
            status: 'processing',
          })
          .returning();
        if (!created) {
          throw new Error('Failed to create document record');
        }

        try {
          await enqueueDocumentEmbedding(created.id);
        } catch (enqueueError) {
          // No queue -> no processing -> roll back the DB row too.
          await db
            .delete(documents)
            .where(eq(documents.id, created.id))
            .catch(() => undefined);
          throw enqueueError;
        }

        success = true;
        res.status(201).json({ document: toDocumentDTO(created) });
      } catch (err) {
        console.error('[upload] failed:', sanitizeForLog(err));
        if (!res.headersSent) {
          res.status(500).json({ error: 'Upload failed' });
        }
      } finally {
        if (!success && storedPath) {
          await rm(storedPath, { force: true }).catch(() => undefined);
        }
      }
    },
  );

  // multer errors -> JSON 400 instead of HTML stack (size limit, filter, ...)
  app.use(
    '/api/upload',
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(400).json({ error: err.message });
    },
  );

  // --- tRPC ------------------------------------------------------------
  app.use(
    '/trpc',
    createExpressMiddleware({
      router: appRouter,
      createContext: createExpressContext,
    }),
  );

  app.get('/healthz', async (_req, res) => {
    const deps = await checkDependencies();
    const healthy = deps.db && deps.redis;
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      db: deps.db ? 'up' : 'down',
      redis: deps.redis ? 'up' : 'down',
    });
  });

  // --- WebSocket transport for tRPC subscriptions (chat streaming) -----
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: WS_PATH });
  applyWSSHandler({
    wss,
    router: appRouter,
    createContext: createWSSContext,
  });

  httpServer.listen(PORT, () => {
    console.log(`[api] listening on http://localhost:${PORT}`);
    console.log(`[api] ws subscriptions on ws://localhost:${PORT}${WS_PATH}`);
    console.log(`[api] uploads stored in ${UPLOAD_DIR}`);
    if (!process.env.OPENAI_API_KEY) {
      console.warn(
        '[api] WARNING: OPENAI_API_KEY not set - chat and embeddings will fail',
      );
    }
  });

  // --- Graceful shutdown ----------------------------------------------
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

void main().catch((err) => {
  console.error('[boot] fatal error:', err);
  process.exit(1);
});

// Re-exports so the frontend can `import type { AppRouter } from '@nexus/backend'`
export { appRouter } from './routers/_app.js';
export type { AppRouter } from './routers/_app.js';
