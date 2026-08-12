import { rm } from 'node:fs/promises';
import path from 'node:path';

import { TRPCError } from '@trpc/server';
import { and, desc, eq, getTableColumns } from 'drizzle-orm';

import { documentIdSchema, listDocumentsInputSchema } from '@nexus/shared-types';
import type { DocumentDTO } from '@nexus/shared-types';

import { db } from '../db';
import { documents, workspaces } from '../db/schema';
import { protectedProcedure, t } from '../middleware/auth';
import { enqueueDocumentEmbedding } from '../queues';
import { UPLOAD_DIR } from '../utils/paths';
import { toDocumentDTO } from '../utils/dto';

/** Ensures the workspace exists and belongs to the authenticated user. */
async function assertWorkspaceOwnership(
  userId: string,
  workspaceId: string,
): Promise<void> {
  const [workspace] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(
      and(eq(workspaces.id, workspaceId), eq(workspaces.userId, userId)),
    )
    .limit(1);
  if (!workspace) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
  }
}

export const documentRouter = t.router({
  listByWorkspace: protectedProcedure
    .input(listDocumentsInputSchema)
    .query(async ({ ctx, input }): Promise<DocumentDTO[]> => {
      await assertWorkspaceOwnership(ctx.user.id, input.workspaceId);
      const rows = await db
        .select()
        .from(documents)
        .where(eq(documents.workspaceId, input.workspaceId))
        .orderBy(desc(documents.createdAt));
      return rows.map(toDocumentDTO);
    }),

  retry: protectedProcedure
    .input(documentIdSchema)
    .mutation(async ({ ctx, input }): Promise<DocumentDTO> => {
      const [doc] = await db
        .select({ ...getTableColumns(documents), workspaceUserId: workspaces.userId })
        .from(documents)
        .innerJoin(workspaces, eq(workspaces.id, documents.workspaceId))
        .where(eq(documents.id, input.documentId))
        .limit(1);
      if (!doc || doc.workspaceUserId !== ctx.user.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      }

      const [updated] = await db
        .update(documents)
        .set({ status: 'processing' })
        .where(eq(documents.id, doc.id))
        .returning();
      if (!updated) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      }
      await enqueueDocumentEmbedding(updated.id);
      return toDocumentDTO(updated);
    }),

  remove: protectedProcedure
    .input(documentIdSchema)
    .mutation(async ({ ctx, input }): Promise<{ deleted: boolean }> => {
      const [doc] = await db
        .select({ ...getTableColumns(documents), workspaceUserId: workspaces.userId })
        .from(documents)
        .innerJoin(workspaces, eq(workspaces.id, documents.workspaceId))
        .where(eq(documents.id, input.documentId))
        .limit(1);
      if (!doc || doc.workspaceUserId !== ctx.user.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      }

      await db.delete(documents).where(eq(documents.id, doc.id));
      await rm(path.resolve(UPLOAD_DIR, doc.filePath), { force: true }).catch(
        () => undefined,
      );
      return { deleted: true };
    }),
});