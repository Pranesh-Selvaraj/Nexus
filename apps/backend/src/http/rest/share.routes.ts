import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { shareAskInputSchema } from '@nexus/shared-types';
import { sanitizeForLog } from '../../utils/multer.config.js';
import { answerQuestion } from '../../services/api.service.js';
import {
  resolveShareToken,
  sharedWorkspaceView,
} from '../../services/share.service.js';
import { friendlyErrorMessage } from '../../utils/errors.js';

/**
 * REST surface: share. Handlers keep their original bodies; only the router
 * they mount on and the imports moved out of the composition root.
 */
export function shareRoutes(): Router {
  const router = Router();

  // --- Read-only share links (L-13) ------------------------------------
  // Capability-URL endpoints: no session, no cookies, strictly read-only.
  // The token is hashed at rest and every lookup checks revocation/expiry.
  const shareLimiter = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests, please retry in a minute' },
  });
  const shareTokenSchema = z.string().regex(/^nxs_[A-Za-z0-9_-]{32,}$/);

  router.get('/api/share/:token', shareLimiter, async (req, res) => {
    try {
      const parsed = shareTokenSchema.safeParse(req.params.token);
      if (!parsed.success) {
        res.status(404).json({ error: 'Share link not found' });
        return;
      }
      const share = await resolveShareToken(parsed.data);
      if (!share) {
        res.status(404).json({ error: 'Share link not found' });
        return;
      }
      const view = await sharedWorkspaceView(share);
      res.setHeader('cache-control', 'no-store');
      res.json(view);
    } catch (err) {
      console.error('[share] view failed:', sanitizeForLog(err));
      if (!res.headersSent) {
        res.status(500).json({ error: 'Could not load the shared workspace' });
      }
    }
  });

  router.post('/api/share/:token/ask', shareLimiter, async (req, res) => {
    try {
      const parsed = shareTokenSchema.safeParse(req.params.token);
      if (!parsed.success) {
        res.status(404).json({ error: 'Share link not found' });
        return;
      }
      const ask = shareAskInputSchema.safeParse(req.body);
      if (!ask.success) {
        res.status(400).json({ error: 'A question is required' });
        return;
      }
      const share = await resolveShareToken(parsed.data);
      if (!share) {
        res.status(404).json({ error: 'Share link not found' });
        return;
      }
      // Answers run as the workspace owner, but only read the shared
      // workspace: no writes are reachable from this surface.
      const result = await answerQuestion({
        workspaceId: share.workspaceId,
        userId: share.ownerId,
        question: ask.data.question,
      });
      res.setHeader('cache-control', 'no-store');
      res.json({
        answer: result.answer,
        sources: result.sources,
        query: result.query,
      });
    } catch (err) {
      console.error('[share] ask failed:', sanitizeForLog(err));
      if (!res.headersSent) {
        res.status(502).json({
          error: friendlyErrorMessage(err) || 'Could not answer that question',
        });
      }
    }
  });

  return router;
}
