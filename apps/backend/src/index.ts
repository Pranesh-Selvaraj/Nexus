import './utils/env.js';

import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
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
import { z } from 'zod';
import {
  ingestUrlInputSchema,
  ttsRequestSchema,
  workspaceArchiveSchema,
  workspaceIdSchema,
} from '@nexus/shared-types';

import { db, pool } from './db/index.js';
import { documents, sessions, users, workspaces } from './db/schema.js';
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
import {
  archiveUpload,
  audioUpload,
  sanitizeForLog,
  upload,
} from './utils/multer.config.js';
import { toDocumentDTO } from './utils/dto.js';
import { getSettingNumber } from './services/settings.service.js';
import { isImageFormat, mimeForFormat } from './services/ingestion/magic.js';
import { ingestUrlContent } from './services/ingestion/url-ingest.js';
import { UnsafeUrlError } from './services/ingestion/url-fetch.js';
import {
  UploadRejectedError,
  validateUpload,
} from './services/ingestion/validate.js';
import {
  audioFilePath,
  getOwnedAudio,
  parseRange,
  safeAudioMimeType,
} from './services/audio.service.js';
import { transcribeAudio } from './services/stt.service.js';
import { synthesizeSpeech } from './services/tts.service.js';
import { friendlyErrorMessage } from './utils/errors.js';
import { importWorkspaceArchive } from './services/workspace-archive.service.js';
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

  // Optional authentication: when AUTH_PASSWORD is set, store its scrypt
  // hash on the local user so login can verify against the database. If the
  // password actually changed (or this is the first authenticated boot),
  // every existing session is deleted so a leaked cookie cannot outlive the
  // credential change.
  if (authEnabled()) {
    if (!localUser) {
      throw new Error(
        `AUTH_PASSWORD is set but the local user (${LOCAL_USER_EMAIL}) could not be resolved`,
      );
    }
    const password = process.env.AUTH_PASSWORD as string;
    const unchanged = await verifyPassword(password, localUser.passwordHash);
    if (!unchanged) {
      await db
        .update(users)
        .set({ passwordHash: await hashPassword(password) })
        .where(eq(users.id, localUser.id));
      await db.delete(sessions).where(eq(sessions.userId, localUser.id));
      console.log(
        '[boot] authentication enabled - login required (existing sessions invalidated)',
      );
    } else {
      console.log('[boot] authentication enabled - login required');
    }
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

        // 3. Admission: magic bytes decide the format and the parser; zip
        //    containers are checked against the decompression limits and
        //    images against the vision size cap before anything is written.
        const maxImageMb = await getSettingNumber('vision.maxImageMb');
        let validated;
        try {
          validated = await validateUpload(
            req.file.buffer,
            req.file.originalname,
            { maxImageMb },
          );
        } catch (err) {
          if (err instanceof UploadRejectedError) {
            res.status(400).json({ error: err.message });
            return;
          }
          throw err;
        }
        const fileType = validated.detected.format;

        // 4. Duplicate detection by content hash (same bytes, same workspace):
        //    return the existing document instead of indexing it twice. A
        //    previously failed document does not block a fresh attempt.
        const [existing] = await db
          .select()
          .from(documents)
          .where(
            and(
              eq(documents.workspaceId, workspace.id),
              eq(documents.contentHash, validated.contentHash),
              ne(documents.status, 'failed'),
            ),
          )
          .limit(1);
        if (existing) {
          res.status(200).json({
            document: toDocumentDTO(existing),
            duplicate: true,
          });
          return;
        }

        // 5. Write the buffer under a path built from validated inputs only.
        const workspaceDir = path.join(UPLOAD_DIR, workspace.id);
        await mkdir(workspaceDir, { recursive: true });
        const finalPath = path.join(workspaceDir, randomUUID());
        storedPath = finalPath;
        await writeFile(finalPath, req.file.buffer);

        const relativePath = path
          .relative(UPLOAD_DIR, finalPath)
          .split(path.sep)
          .join('/');

        const [created] = await db
          .insert(documents)
          .values({
            workspaceId: workspace.id,
            // Metadata only - never used to build a path.
            title: path.basename(req.file.originalname).slice(0, 200),
            filePath: relativePath,
            fileType,
            contentHash: validated.contentHash,
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

  // --- URL ingestion (web articles, YouTube transcripts) ---------------
  // The fetch happens here (SSRF-guarded, size-capped) and the extracted text
  // is stored as a normal Markdown upload, so indexing stays offline and the
  // parsed content is stable across retries.
  const ingestLimiter = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many URL imports, please retry in a minute' },
  });
  app.post('/api/ingest/url', ingestLimiter, async (req, res) => {
    let storedPath: string | null = null;
    let success = false;
    try {
      const currentUser = await resolveUser(readSessionCookie(req.headers));
      if (!currentUser) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }
      const parsed = ingestUrlInputSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Provide a workspaceId and an http(s) URL to import',
        });
        return;
      }
      const [workspace] = await db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(
          and(
            eq(workspaces.id, parsed.data.workspaceId),
            eq(workspaces.userId, currentUser.id),
          ),
        )
        .limit(1);
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      let content;
      try {
        content = await ingestUrlContent(parsed.data.url);
      } catch (err) {
        if (err instanceof UnsafeUrlError) {
          res.status(400).json({ error: err.message });
          return;
        }
        throw err;
      }

      const contentHash = createHash('sha256')
        .update(content.markdown)
        .digest('hex');
      const [existing] = await db
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.workspaceId, workspace.id),
            eq(documents.contentHash, contentHash),
            ne(documents.status, 'failed'),
          ),
        )
        .limit(1);
      if (existing) {
        res.status(200).json({
          document: toDocumentDTO(existing),
          kind: content.kind,
          sourceUrl: content.sourceUrl,
          title: existing.title,
          wordCount: content.wordCount,
          duplicate: true,
        });
        return;
      }

      const workspaceDir = path.join(UPLOAD_DIR, workspace.id);
      await mkdir(workspaceDir, { recursive: true });
      const finalPath = path.join(workspaceDir, randomUUID());
      storedPath = finalPath;
      await writeFile(finalPath, content.markdown, 'utf8');
      const relativePath = path
        .relative(UPLOAD_DIR, finalPath)
        .split(path.sep)
        .join('/');

      const [created] = await db
        .insert(documents)
        .values({
          workspaceId: workspace.id,
          title: content.title.slice(0, 300),
          filePath: relativePath,
          // The extracted body is Markdown; provenance lives in metadata.
          fileType: 'md',
          contentHash,
          sourceUrl: content.sourceUrl,
          metadata: content.metadata,
          status: 'processing',
        })
        .returning();
      if (!created) throw new Error('Failed to create document record');

      try {
        await enqueueDocumentEmbedding(created.id);
      } catch (enqueueError) {
        await db
          .delete(documents)
          .where(eq(documents.id, created.id))
          .catch(() => undefined);
        throw enqueueError;
      }

      success = true;
      res.status(201).json({
        document: toDocumentDTO(created),
        kind: content.kind,
        sourceUrl: content.sourceUrl,
        title: content.title,
        wordCount: content.wordCount,
      });
    } catch (err) {
      console.error('[ingest] url failed:', sanitizeForLog(err));
      if (!res.headersSent) {
        res.status(502).json({
          error: friendlyErrorMessage(err) || 'Could not import that URL',
        });
      }
    } finally {
      if (!success && storedPath) {
        await rm(storedPath, { force: true }).catch(() => undefined);
      }
    }
  });

  // --- Speech: transcription and synthesis -----------------------------
  // Dictation and pronunciation send recorded audio as multipart (never JSON:
  // the 1 MB JSON body limit would reject any real recording). Audio bytes for
  // playback are served by GET /api/audio/:id with HTTP Range support so
  // <audio> can seek and start fast from the cache.
  const transcribeLimiter = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many transcriptions, please retry in a minute' },
  });
  const ttsLimiter = rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many speech requests, please retry in a minute' },
  });
  const audioIdSchema = z.string().uuid();

  app.post(
    '/api/transcribe',
    transcribeLimiter,
    audioUpload.single('audio'),
    async (req, res) => {
      try {
        const currentUser = await resolveUser(readSessionCookie(req.headers));
        if (!currentUser) {
          res.status(401).json({ error: 'Not authenticated' });
          return;
        }
        if (!req.file) {
          res.status(400).json({ error: 'No audio provided' });
          return;
        }

        // Optional workspace: validated as a UUID and confirmed to belong to
        // the caller before it is stored on the audio asset.
        const rawWorkspace = String(req.body?.workspaceId ?? '').trim();
        let workspaceId: string | null = null;
        if (rawWorkspace) {
          const parsed = workspaceIdSchema.safeParse({
            workspaceId: rawWorkspace,
          });
          if (!parsed.success) {
            res.status(400).json({ error: 'Invalid workspaceId' });
            return;
          }
          const [workspace] = await db
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(
              and(
                eq(workspaces.id, parsed.data.workspaceId),
                eq(workspaces.userId, currentUser.id),
              ),
            )
            .limit(1);
          if (!workspace) {
            res.status(404).json({ error: 'Workspace not found' });
            return;
          }
          workspaceId = workspace.id;
        }

        const store = String(req.body?.store ?? '') === 'true';
        const language =
          typeof req.body?.language === 'string' && req.body.language
            ? req.body.language
            : undefined;
        const result = await transcribeAudio({
          buffer: req.file.buffer,
          filename: req.file.originalname || 'recording.webm',
          // Derived from the allowlisted extension, never the client MIME.
          mimeType: safeAudioMimeType(
            req.file.originalname || 'recording.webm',
          ),
          userId: currentUser.id,
          workspaceId,
          language,
          store,
        });
        res.json(result);
      } catch (err) {
        console.error('[transcribe] failed:', sanitizeForLog(err));
        if (!res.headersSent) {
          res.status(502).json({
            error: friendlyErrorMessage(err) || 'Transcription failed',
          });
        }
      }
    },
  );

  app.post('/api/tts', ttsLimiter, async (req, res) => {
    try {
      const currentUser = await resolveUser(readSessionCookie(req.headers));
      if (!currentUser) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }
      const parsed = ttsRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid speech request' });
        return;
      }
      if (parsed.data.workspaceId) {
        const [workspace] = await db
          .select({ id: workspaces.id })
          .from(workspaces)
          .where(
            and(
              eq(workspaces.id, parsed.data.workspaceId),
              eq(workspaces.userId, currentUser.id),
            ),
          )
          .limit(1);
        if (!workspace) {
          res.status(404).json({ error: 'Workspace not found' });
          return;
        }
      }
      const result = await synthesizeSpeech({
        text: parsed.data.text,
        voice: parsed.data.voice,
        speed: parsed.data.speed,
        format: parsed.data.format,
        userId: currentUser.id,
        workspaceId: parsed.data.workspaceId ?? null,
      });
      res.json(result);
    } catch (err) {
      console.error('[tts] failed:', sanitizeForLog(err));
      if (!res.headersSent) {
        res.status(502).json({
          error: friendlyErrorMessage(err) || 'Speech synthesis failed',
        });
      }
    }
  });

  // --- Image bytes (vision previews, attachments, source thumbnails) ---
  // Ownership is derived from the workspace; the stored path is server-built
  // and never includes client input. Only image formats are served, with a
  // restrictive CSP/sandbox so a crafted payload cannot execute as a document.
  const imageIdSchema = z.string().uuid();
  app.get('/api/images/:documentId', async (req, res) => {
    try {
      const currentUser = await resolveUser(readSessionCookie(req.headers));
      if (!currentUser) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }
      const parsedId = imageIdSchema.safeParse(req.params.documentId);
      if (!parsedId.success) {
        res.status(400).json({ error: 'Invalid image id' });
        return;
      }
      const [doc] = await db
        .select({
          id: documents.id,
          filePath: documents.filePath,
          fileType: documents.fileType,
        })
        .from(documents)
        .innerJoin(workspaces, eq(workspaces.id, documents.workspaceId))
        .where(
          and(
            eq(documents.id, parsedId.data),
            eq(workspaces.userId, currentUser.id),
          ),
        )
        .limit(1);
      if (!doc || !isImageFormat(doc.fileType)) {
        res.status(404).json({ error: 'Image not found' });
        return;
      }
      // Stored paths are server-generated UUIDs, but the containment check
      // keeps a corrupted/hand-edited row from streaming another file.
      const filePath = path.resolve(UPLOAD_DIR, doc.filePath);
      const uploadRoot = path.resolve(UPLOAD_DIR);
      if (
        filePath !== uploadRoot &&
        !filePath.startsWith(uploadRoot + path.sep)
      ) {
        res.status(404).json({ error: 'Image not found' });
        return;
      }
      const info = await stat(filePath);
      res.setHeader('Content-Type', mimeForFormat(doc.fileType));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('Content-Length', String(info.size));
      const stream = createReadStream(filePath);
      stream.on('error', (streamErr) => {
        console.error('[image] stream failed:', sanitizeForLog(streamErr));
        res.destroy();
      });
      stream.pipe(res);
    } catch (err) {
      console.error('[image] failed:', sanitizeForLog(err));
      if (!res.headersSent) {
        res.status(404).json({ error: 'Image not found' });
      }
    }
  });

  app.get('/api/audio/:audioId', async (req, res) => {
    try {
      const currentUser = await resolveUser(readSessionCookie(req.headers));
      if (!currentUser) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }
      const parsedId = audioIdSchema.safeParse(req.params.audioId);
      if (!parsedId.success) {
        res.status(400).json({ error: 'Invalid audio id' });
        return;
      }
      const asset = await getOwnedAudio(currentUser.id, parsedId.data);
      if (!asset) {
        res.status(404).json({ error: 'Audio not found' });
        return;
      }
      const filePath = audioFilePath(asset.filePath);
      const info = await stat(filePath);
      const download = req.query.download === '1';

      res.setHeader('Content-Type', asset.mimeType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      if (download) {
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="nexus-audio.${asset.format}"`,
        );
      } else {
        res.setHeader('Content-Disposition', 'inline');
      }

      const range = parseRange(req.headers.range, info.size);
      if (!range && req.headers.range) {
        // Present but unsatisfiable (RFC 7233): report 416 rather than
        // silently downgrading to a full 200 response.
        res.status(416);
        res.setHeader('Content-Range', `bytes */${info.size}`);
        res.end();
        return;
      }
      // A read error (or a client abort) must not surface as an unhandled
      // stream 'error' event and crash the process.
      const pipeFile = (options?: { start: number; end: number }): void => {
        const stream = options
          ? createReadStream(filePath, options)
          : createReadStream(filePath);
        stream.on('error', (streamErr) => {
          console.error('[audio] stream failed:', sanitizeForLog(streamErr));
          res.destroy();
        });
        stream.pipe(res);
      };

      if (range) {
        res.status(206);
        res.setHeader(
          'Content-Range',
          `bytes ${range.start}-${range.end}/${info.size}`,
        );
        res.setHeader('Content-Length', String(range.end - range.start + 1));
        pipeFile({ start: range.start, end: range.end });
      } else {
        res.setHeader('Content-Length', String(info.size));
        pipeFile();
      }
    } catch (err) {
      console.error('[audio] failed:', sanitizeForLog(err));
      if (!res.headersSent) {
        res.status(404).json({ error: 'Audio not found' });
      }
    }
  });

  // --- Workspace archive import (multipart JSON, no JSON body cap) ------
  // The tRPC `workspace.import` mutation shares the 1 MB JSON body limit of
  // every tRPC call, which real backups exceed immediately. The UI uploads
  // the archive as a file here instead; the service re-validates the decoded
  // payload against row/size limits.
  const importLimiter = rateLimit({
    windowMs: 60_000,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many imports, please retry in a minute' },
  });
  app.post(
    '/api/workspace/import',
    importLimiter,
    archiveUpload.single('archive'),
    async (req, res) => {
      try {
        const currentUser = await resolveUser(readSessionCookie(req.headers));
        if (!currentUser) {
          res.status(401).json({ error: 'Not authenticated' });
          return;
        }
        if (!req.file) {
          res.status(400).json({ error: 'No archive provided' });
          return;
        }
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(req.file.buffer.toString('utf8'));
        } catch {
          res
            .status(400)
            .json({ error: 'Workspace archive is not valid JSON' });
          return;
        }
        const parsed = workspaceArchiveSchema.safeParse(parsedJson);
        if (!parsed.success) {
          res.status(400).json({
            error: 'Not a valid Nexus workspace archive (version 1)',
          });
          return;
        }
        const workspace = await importWorkspaceArchive(
          currentUser.id,
          parsed.data,
        );
        res.status(201).json({ workspace });
      } catch (err) {
        console.error('[import] failed:', sanitizeForLog(err));
        if (!res.headersSent) {
          res.status(400).json({
            error: err instanceof Error ? err.message : 'Import failed',
          });
        }
      }
    },
  );

  // multer errors -> JSON 400 instead of HTML stack (size limit, filter, ...)
  app.use(
    '/api',
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
