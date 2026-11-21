import { Router } from 'express';
import { workspaceIdSchema } from '@nexus/shared-types';
import { readSessionCookie, resolveUser } from '../../platform/auth/context.js';
import { sanitizeForLog } from '../../shared/multer.js';
import { sendApiError } from '../../platform/errors.js';
import { buildWorkspaceZip } from '../../modules/workspaces/archive.service.js';

/**
 * REST surface: export. Handlers keep their original bodies; only the router
 * they mount on and the imports moved out of the composition root.
 */
export function exportRoutes(): Router {
  const router = Router();

  // --- Workspace zip export (B-5) --------------------------------------
  // Session-authenticated binary download: the manifest plus original files.
  // The JSON export stays available over tRPC for import round-trips.
  router.get('/api/workspaces/:workspaceId/export.zip', async (req, res) => {
    try {
      const currentUser = await resolveUser(readSessionCookie(req.headers));
      if (!currentUser) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }
      const parsed = workspaceIdSchema.safeParse({
        workspaceId: req.params.workspaceId,
      });
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid workspaceId' });
        return;
      }
      const { buffer, fileName } = await buildWorkspaceZip(
        currentUser.id,
        parsed.data.workspaceId,
      );
      res.setHeader('content-type', 'application/zip');
      res.setHeader(
        'content-disposition',
        `attachment; filename="${fileName}"`,
      );
      res.setHeader('content-length', String(buffer.length));
      res.send(buffer);
    } catch (err) {
      if (sendApiError(res, err)) return;
      console.error('[export] zip failed:', sanitizeForLog(err));
      if (!res.headersSent) {
        res.status(500).json({ error: 'Export failed' });
      }
    }
  });

  return router;
}
