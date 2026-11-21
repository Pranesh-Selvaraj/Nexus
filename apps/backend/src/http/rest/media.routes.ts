import { Router } from 'express';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import rateLimit from 'express-rate-limit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { ttsRequestSchema, workspaceIdSchema } from '@nexus/shared-types';
import { db } from '../../db/index.js';
import { documents, workspaces } from '../../db/schema/index.js';
import { readSessionCookie, resolveUser } from '../../platform/auth/context.js';
import { storage } from '../../platform/storage/index.js';
import { audioUpload, sanitizeForLog } from '../../shared/multer.js';
import { isImageFormat, mimeForFormat } from '../../modules/ingestion/magic.js';
import { workspaceAccessPredicate } from '../../modules/workspaces/access.service.js';
import {
  audioFilePath,
  getOwnedAudio,
  parseRange,
  safeAudioMimeType,
} from '../../modules/voice/audio.service.js';
import { transcribeAudio } from '../../modules/voice/stt.service.js';
import { synthesizeSpeech } from '../../modules/voice/tts.service.js';
import { friendlyErrorMessage } from '../../platform/errors.js';

/**
 * REST surface: media. Handlers keep their original bodies; only the router
 * they mount on and the imports moved out of the composition root.
 */
export function mediaRoutes(): Router {
  const router = Router();

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

  router.post(
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
                workspaceAccessPredicate(currentUser.id),
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

  router.post('/api/tts', ttsLimiter, async (req, res) => {
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
              workspaceAccessPredicate(currentUser.id),
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
  router.get('/api/images/:documentId', async (req, res) => {
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
            workspaceAccessPredicate(currentUser.id),
          ),
        )
        .limit(1);
      if (!doc || !isImageFormat(doc.fileType)) {
        res.status(404).json({ error: 'Image not found' });
        return;
      }
      // Images are capped by VISION_MAX_IMAGE_MB, so buffering a single image
      // is bounded; the storage driver serves local disk or S3 the same way.
      const buffer = await storage.get(doc.filePath);
      res.setHeader('Content-Type', mimeForFormat(doc.fileType));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('Content-Length', String(buffer.length));
      res.send(buffer);
    } catch (err) {
      console.error('[image] failed:', sanitizeForLog(err));
      if (!res.headersSent) {
        res.status(404).json({ error: 'Image not found' });
      }
    }
  });

  router.get('/api/audio/:audioId', async (req, res) => {
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

  return router;
}
