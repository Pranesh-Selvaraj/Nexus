import { Router } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';

import { readSessionCookie, resolveUser } from '../../middleware/auth.js';
import { sanitizeForLog, upload } from '../../utils/multer.config.js';
import { ApiError } from '../../utils/errors.js';
import { getSettingNumber } from '../../services/settings.service.js';
import { ingestUpload } from '../../services/upload.service.js';

/**
 * REST surface: upload. Handlers keep their original bodies; only the router
 * they mount on and the imports moved out of the composition root.
 */
export function uploadRoutes(): Router {
  const router = Router();

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
  router.post(
    '/api/upload',
    uploadLimiter,
    enforceUploadLimit,
    upload.single('file'),
    async (req, res) => {
      try {
        // Identity comes from the session (or the local user in no-auth mode),
        // never from the request body.
        const currentUser = await resolveUser(readSessionCookie(req.headers));
        if (!currentUser) {
          res.status(401).json({ error: 'Not authenticated' });
          return;
        }
        const result = await ingestUpload({
          workspaceId: req.body?.workspaceId,
          userId: currentUser.id,
          file: req.file
            ? { buffer: req.file.buffer, originalname: req.file.originalname }
            : undefined,
        });
        res.status(result.duplicate ? 200 : 201).json(result);
      } catch (err) {
        if (err instanceof ApiError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        console.error('[upload] failed:', sanitizeForLog(err));
        if (!res.headersSent) {
          res.status(500).json({ error: 'Upload failed' });
        }
      }
    },
  );

  return router;
}
