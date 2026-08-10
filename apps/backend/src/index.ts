import './utils/env';

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { applyWSSHandler } from '@trpc/server/adapters/ws';
import cors from 'cors';
import express from 'express';
import { eq, ne } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { WebSocketServer } from 'ws';

import { db, pool } from './db';
import { documents, users, workspaces } from './db/schema';
import { createExpressContext, createWSSContext, LOCAL_USER_EMAIL } from './middleware/auth';
import { enqueueDocumentEmbedding } from './queues';
import { appRouter } from './routers/_app';
import { UPLOAD_DIR, upload } from './utils/multer.config';
import type { DocumentDTO } from '@nexus/shared-types';

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

function toDocumentDTO(doc: typeof documents.$inferSelect): DocumentDTO {
  return {
    id: doc.id,
    workspaceId: doc.workspaceId,
    title: doc.title,
    fileType: doc.fileType,
    status: doc.status,
    chunkCount: doc.chunkCount,
    createdAt: new Date(doc.createdAt).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

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

  const app = express();
  app.disable('x-powered-by');

  const origins = (process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.use(cors({ origin: origins }));
  app.use(express.json({ limit: '1mb' }));

  // --- File upload (multipart, multer) --------------------------------
  app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
      const workspaceId = String(req.body?.workspaceId ?? '');
      const [workspace] = await db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1);
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }
        if (!req.file) {
          res.status(400).json({ error: 'No file provided' });
          return;
        }

        const fileType =
          path.extname(req.file.originalname).slice(1).toLowerCase() || 'txt';
        const relativePath = path
          .relative(UPLOAD_DIR, req.file.path)
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
          res.status(500).json({ error: 'Failed to create document record' });
          return;
        }

        await enqueueDocumentEmbedding(created.id);
        res.status(201).json({ document: toDocumentDTO(created) });
      } catch (err) {
        console.error('[upload] failed:', err);
        res.status(500).json({ error: 'Upload failed' });
      }
    },
  );

  // multer errors -> JSON 400 instead of HTML stack
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

  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
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
      console.warn('[api] WARNING: OPENAI_API_KEY not set - chat and embeddings will fail');
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
export { appRouter } from './routers/_app';
export type { AppRouter } from './routers/_app';