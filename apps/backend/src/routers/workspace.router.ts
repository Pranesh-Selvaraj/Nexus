import { TRPCError } from '@trpc/server';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { WorkspaceArchive, WorkspaceDTO } from '@nexus/shared-types';
import {
  createWorkspaceInputSchema,
  updateWorkspaceInputSchema,
  workspaceArchiveSchema,
  workspaceIdSchema,
} from '@nexus/shared-types';

import { db } from '../db/index.js';
import { documents, workspaces } from '../db/schema.js';
import { protectedProcedure, t } from '../middleware/auth.js';
import {
  exportWorkspaceArchive,
  importWorkspaceArchive,
} from '../services/workspace-archive.service.js';
import { ApiError } from '../utils/errors.js';
import { storage } from '../services/storage/index.js';

const importWorkspaceInputSchema = z.object({
  archive: workspaceArchiveSchema,
});

interface WorkspaceRow {
  id: string;
  name: string;
  description: string | null;
  created_at: Date;
  document_count: number;
}

function toWorkspaceDTO(row: WorkspaceRow): WorkspaceDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    documentCount: Number(row.document_count),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export const workspaceRouter = t.router({
  list: protectedProcedure.query(async ({ ctx }): Promise<WorkspaceDTO[]> => {
    const result = await db.execute(
      sql`
        SELECT w.id, w.name, w.description, w.created_at,
               (SELECT COUNT(*)::int FROM documents d
                WHERE d.workspace_id = w.id
                  AND d.status <> 'deleted') AS document_count
        FROM workspaces w
        WHERE w.user_id = ${ctx.user.id}
        ORDER BY w.created_at DESC
      `,
    );
    const rows = (result as unknown as { rows: WorkspaceRow[] }).rows;
    return rows.map(toWorkspaceDTO);
  }),

  create: protectedProcedure
    .input(createWorkspaceInputSchema)
    .mutation(async ({ ctx, input }): Promise<WorkspaceDTO> => {
      const [created] = await db
        .insert(workspaces)
        .values({
          userId: ctx.user.id,
          name: input.name.trim(),
          description: input.description?.trim() || null,
        })
        .returning();
      if (!created) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      }
      return toWorkspaceDTO({
        id: created.id,
        name: created.name,
        description: created.description,
        created_at: created.createdAt,
        document_count: 0,
      });
    }),

  update: protectedProcedure
    .input(updateWorkspaceInputSchema)
    .mutation(async ({ ctx, input }): Promise<WorkspaceDTO> => {
      const [workspace] = await db
        .select()
        .from(workspaces)
        .where(
          and(
            eq(workspaces.id, input.workspaceId),
            eq(workspaces.userId, ctx.user.id),
          ),
        )
        .limit(1);
      if (!workspace) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Workspace not found',
        });
      }

      const [updated] = await db
        .update(workspaces)
        .set({
          name: input.name ? input.name.trim() : workspace.name,
          description:
            input.description !== undefined
              ? input.description.trim() || null
              : workspace.description,
        })
        .where(eq(workspaces.id, workspace.id))
        .returning();
      if (!updated) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      }

      const [docCount] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(documents)
        .where(eq(documents.workspaceId, updated.id));
      if (!docCount) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      }
      return toWorkspaceDTO({
        id: updated.id,
        name: updated.name,
        description: updated.description,
        created_at: updated.createdAt,
        document_count: Number(docCount.count),
      });
    }),

  delete: protectedProcedure
    .input(workspaceIdSchema)
    .mutation(async ({ ctx, input }): Promise<{ deleted: boolean }> => {
      const [deleted] = await db
        .delete(workspaces)
        .where(
          and(
            eq(workspaces.id, input.workspaceId),
            eq(workspaces.userId, ctx.user.id),
          ),
        )
        .returning({ id: workspaces.id });
      if (!deleted) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Workspace not found',
        });
      }

      // Remove the workspace's uploaded files (the DB rows cascade, but the
      // stored objects do not).
      await storage.deletePrefix(deleted.id).catch(() => undefined);
      return { deleted: true };
    }),

  /**
   * Full workspace backup: metadata, uploaded file contents (base64) and
   * the complete chat history. Restore with `import`.
   */
  export: protectedProcedure
    .input(workspaceIdSchema)
    .query(async ({ ctx, input }): Promise<WorkspaceArchive> => {
      return exportWorkspaceArchive(ctx.user.id, input.workspaceId).catch(
        (err: unknown) => {
          if (err instanceof ApiError) {
            throw new TRPCError({
              code: err.status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST',
              message: err.message,
            });
          }
          throw err;
        },
      );
    }),

  /**
   * Restore an exported workspace (documents are re-indexed). Kept for API
   * clients; the UI uses the streaming `/api/workspace/import` endpoint so
   * large archives are not limited by the JSON body cap.
   */
  import: protectedProcedure
    .input(importWorkspaceInputSchema)
    .mutation(async ({ ctx, input }): Promise<WorkspaceDTO> => {
      try {
        return await importWorkspaceArchive(ctx.user.id, input.archive);
      } catch (err) {
        if (err instanceof Error) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
        }
        throw err;
      }
    }),
});
