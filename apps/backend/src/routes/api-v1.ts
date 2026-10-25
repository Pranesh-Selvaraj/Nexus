import { Router, type Request, type Response } from 'express';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  askInputSchema,
  createNoteInputSchema,
  dueCardsInputSchema,
  ingestUrlInputSchema,
  reviewCardInputSchema,
  searchQuerySchema,
} from '@nexus/shared-types';

import { db } from '../db/index.js';
import { documents, notes, workspaces } from '../db/schema.js';
import { authenticateApiKey, requireApiKey } from '../middleware/api-auth.js';
import {
  ApiError,
  answerQuestion,
  assertWorkspaceOwner,
  searchWorkspace,
} from '../services/api.service.js';
import { toDocumentDTO } from '../utils/dto.js';
import { upload } from '../utils/multer.config.js';
import { ingestUpload } from '../services/upload.service.js';
import { listDueCards, submitCardReview } from '../services/review.service.js';
import { ingestUrlForWorkspace } from '../services/url-ingest.service.js';

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
            // Fully qualify the outer column: an interpolated `${workspaces.id}`
            // renders as a bare `"id"` inside the subquery, which resolves to
            // `documents.id` and always counts zero.
            documentCount: sql<number>`(
            SELECT count(*)::int FROM documents d
            WHERE d.workspace_id = "workspaces"."id"
              AND d.status <> 'deleted'
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

  /**
   * Multipart upload. The bytes go through exactly the same admission as the
   * UI (`ingestUpload`): magic-byte format, zip/vision limits, duplicate hash,
   * server-generated path, queue. A duplicate is a 200 with `duplicate: true`.
   */
  router.post(
    '/documents',
    requireApiKey('documents:write'),
    upload.single('file'),
    async (req, res) => {
      try {
        const workspaceId =
          (req.body as { workspaceId?: unknown } | undefined)?.workspaceId ??
          req.query.workspaceId;
        const result = await ingestUpload({
          workspaceId,
          userId: identityOf(req).userId,
          file: req.file
            ? { buffer: req.file.buffer, originalname: req.file.originalname }
            : undefined,
        });
        res.status(result.duplicate ? 200 : 201).json(result);
      } catch (err) {
        sendError(res, err);
      }
    },
  );

  /**
   * Import a web article or YouTube transcript (the "share target" for
   * scripts/extensions). Same SSRF guard, dedupe and queue as the UI route.
   */
  router.post('/urls', requireApiKey('documents:write'), async (req, res) => {
    try {
      const parsed = ingestUrlInputSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: 'workspaceId and an http(s) URL are required' });
        return;
      }
      const result = await ingestUrlForWorkspace({
        userId: identityOf(req).userId,
        workspaceId: parsed.data.workspaceId,
        url: parsed.data.url,
      });
      res.status(result.duplicate ? 200 : 201).json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  /** Create a note, e.g. from an MCP client or a capture script. */
  router.post('/notes', requireApiKey('notes:write'), async (req, res) => {
    try {
      const parsed = createNoteInputSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: 'Invalid request', issues: parsed.error.issues });
        return;
      }
      await assertWorkspaceOwner(
        parsed.data.workspaceId,
        identityOf(req).userId,
      );
      const [created] = await db
        .insert(notes)
        .values({
          workspaceId: parsed.data.workspaceId,
          title: parsed.data.title,
          contentMd: parsed.data.contentMd,
          tags: parsed.data.tags,
        })
        .returning();
      if (!created) throw new ApiError('Could not create the note', 500);
      res.status(201).json({
        note: {
          id: created.id,
          workspaceId: created.workspaceId,
          title: created.title,
          contentMd: created.contentMd,
          tags: created.tags,
          createdAt: created.createdAt.toISOString(),
          updatedAt: created.updatedAt.toISOString(),
        },
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get(
    '/reviews/due',
    requireApiKey('reviews:read'),
    async (req, res) => {
      try {
        const parsed = dueCardsInputSchema.safeParse({
          workspaceId: req.query.workspaceId,
          deckId: req.query.deckId,
          limit: req.query.limit ? Number(req.query.limit) : undefined,
        });
        if (!parsed.success) {
          res.status(400).json({
            error: 'workspaceId is required',
            issues: parsed.error.issues,
          });
          return;
        }
        const cards = await listDueCards({
          userId: identityOf(req).userId,
          workspaceId: parsed.data.workspaceId,
          deckId: parsed.data.deckId,
          limit: parsed.data.limit,
        });
        res.json({ cards });
      } catch (err) {
        sendError(res, err);
      }
    },
  );

  router.post('/reviews', requireApiKey('reviews:write'), async (req, res) => {
    try {
      const parsed = reviewCardInputSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: 'Invalid request', issues: parsed.error.issues });
        return;
      }
      const result = await submitCardReview({
        userId: identityOf(req).userId,
        cardId: parsed.data.cardId,
        rating: parsed.data.rating,
        durationMs: parsed.data.durationMs,
      });
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

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
