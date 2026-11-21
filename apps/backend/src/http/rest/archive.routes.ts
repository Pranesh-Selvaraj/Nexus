import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { workspaceArchiveSchema } from '@nexus/shared-types';
import { readSessionCookie, resolveUser } from '../../middleware/auth.js';
import { archiveUpload, sanitizeForLog } from '../../utils/multer.config.js';
import { importWorkspaceArchive } from '../../services/workspace-archive.service.js';

/**
 * REST surface: archive. Handlers keep their original bodies; only the router
 * they mount on and the imports moved out of the composition root.
 */
export function archiveRoutes(): Router {
  const router = Router();

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
  router.post(
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

  return router;
}
