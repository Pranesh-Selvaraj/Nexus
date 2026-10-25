import { Router, type Request, type Response } from 'express';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { askInputSchema, searchQuerySchema } from '@nexus/shared-types';

import { db } from '../db/index.js';
import { documents, workspaces } from '../db/schema.js';
import { authenticateApiKey, requireApiKey } from '../middleware/api-auth.js';
import {
  ApiError,
  answerQuestion,
  searchWorkspace,
} from '../services/api.service.js';
import { toDocumentDTO } from '../utils/dto.js';

const workspaceQuerySchema = z.object({ workspaceId: z.string().uuid() });

const searchRequestSchema = searchQuerySchema.extend({
  workspaceId: z.string().uuid(),
});

/** The key middleware always sets `apiKey`; this narrows it without `!`. */
function identityOf(req: Request): { userId: string } {
  if (!req.apiKey) throw new ApiError('Missing API key', 401);
  return { userId: req.apiKey.userId };
}

/** Maps a service error onto the wire; unknown failures stay 500s. */
function sendError(res: Response, err: unknown): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'Invalid request', issues: err.issues });
    return;
  }
  // The provider refusing to answer is a gateway problem for the caller.
  if (err instanceof Error && /not configured|API key/i.test(err.message)) {
    res.status(502).json({ error: err.message });
    return;
  }
  res
    .status(500)
    .json({ error: err instanceof Error ? err.message : 'Request failed' });
}

/**
 * Public REST surface (P-5). Mounted under /api/v1 and authenticated by API
 * key only - a browser session cookie is deliberately not accepted here, so
 * an integration cannot be driven by a CSRF'd request.
 */
export function apiV1Router(): Router {
  const router = Router();

  // Any live key may inspect itself and its granted scopes.
  router.get('/me', authenticateApiKey, (req, res) => {
    const identity = req.apiKey;
    res.json({
      userId: identity?.userId,
      apiKeyId: identity?.apiKeyId,
      scopes: identity?.scopes ?? [],
    });
  });

  router.get(
    '/workspaces',
    requireApiKey('documents:read'),
    async (req, res) => {
      try {
        const { userId } = identityOf(req);
        const rows = await db
          .select({
            id: workspaces.id,
            name: workspaces.name,
            description: workspaces.description,
            createdAt: workspaces.createdAt,
            documentCount: sql<number>`(
            SELECT count(*)::int FROM documents d WHERE d.workspace_id = ${workspaces.id}
          )`,
          })
          .from(workspaces)
          .where(eq(workspaces.userId, userId))
          .orderBy(desc(workspaces.createdAt));
        res.json({
          workspaces: rows.map((row) => ({
            id: row.id,
            name: row.name,
            description: row.description,
            documentCount: Number(row.documentCount),
            createdAt: row.createdAt.toISOString(),
          })),
        });
      } catch (err) {
        sendError(res, err);
      }
    },
  );

  router.get(
    '/documents',
    requireApiKey('documents:read'),
    async (req, res) => {
      try {
        const parsed = workspaceQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          res.status(400).json({ error: 'workspaceId is required' });
          return;
        }
        const { userId } = identityOf(req);
        const [workspace] = await db
          .select({ id: workspaces.id })
          .from(workspaces)
          .where(
            and(
              eq(workspaces.id, parsed.data.workspaceId),
              eq(workspaces.userId, userId),
            ),
          )
          .limit(1);
        if (!workspace) {
          res.status(404).json({ error: 'Workspace not found' });
          return;
        }
        const rows = await db
          .select()
          .from(documents)
          .where(eq(documents.workspaceId, workspace.id))
          .orderBy(desc(documents.createdAt));
        res.json({ documents: rows.map((row) => toDocumentDTO(row)) });
      } catch (err) {
        sendError(res, err);
      }
    },
  );

  router.get('/search', requireApiKey('search'), async (req, res) => {
    try {
      const parsed = searchRequestSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'workspaceId and q are required' });
        return;
      }
      const result = await searchWorkspace({
        workspaceId: parsed.data.workspaceId,
        userId: identityOf(req).userId,
        query: parsed.data.q,
        limit: parsed.data.limit,
      });
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post('/ask', requireApiKey('ask'), async (req, res) => {
    try {
      const parsed = askInputSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: 'Invalid request', issues: parsed.error.issues });
        return;
      }
      const result = await answerQuestion({
        workspaceId: parsed.data.workspaceId,
        userId: identityOf(req).userId,
        question: parsed.data.question,
        persona: parsed.data.persona,
      });
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  return router;
}
