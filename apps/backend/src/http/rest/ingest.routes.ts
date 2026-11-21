import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { ingestUrlInputSchema } from '@nexus/shared-types';
import { readSessionCookie, resolveUser } from '../../platform/auth/context.js';
import { sanitizeForLog } from '../../shared/multer.js';
import { ApiError } from '../../platform/errors.js';
import { ingestUrlForWorkspace } from '../../modules/ingestion/url-ingest.service.js';
import { friendlyErrorMessage } from '../../platform/errors.js';

/**
 * REST surface: ingest. Handlers keep their original bodies; only the router
 * they mount on and the imports moved out of the composition root.
 */
export function ingestRoutes(): Router {
  const router = Router();

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
  router.post('/api/ingest/url', ingestLimiter, async (req, res) => {
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
      const result = await ingestUrlForWorkspace({
        userId: currentUser.id,
        workspaceId: parsed.data.workspaceId,
        url: parsed.data.url,
      });
      res.status(result.duplicate ? 200 : 201).json(result);
    } catch (err) {
      if (err instanceof ApiError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      console.error('[ingest] url failed:', sanitizeForLog(err));
      if (!res.headersSent) {
        res.status(502).json({
          error: friendlyErrorMessage(err) || 'Could not import that URL',
        });
      }
    }
  });

  return router;
}
