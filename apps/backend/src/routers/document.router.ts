import { rm } from 'node:fs/promises';
import path from 'node:path';

import { TRPCError } from '@trpc/server';
import { and, eq, getTableColumns, sql } from 'drizzle-orm';

import {
  documentIdSchema,
  listDocumentsInputSchema,
  workspaceIdSchema,
} from '@nexus/shared-types';
import type { DocumentDTO, RetrievalStatus } from '@nexus/shared-types';

import { db } from '../db/index.js';
import { documents, workspaces } from '../db/schema.js';
import { protectedProcedure, t } from '../middleware/auth.js';
import {
  cancelDocumentEmbedding,
  enqueueDocumentEmbedding,
} from '../queues/index.js';
import {
  EMBEDDING_VERSION,
  getEffectiveEmbeddingModel,
  getEmbeddingDimensions,
} from '../services/embedding.service.js';
import { UPLOAD_DIR } from '../utils/paths.js';
import { toDocumentDTO } from '../utils/dto.js';

/**
 * SQL predicate: the document has at least one chunk embedded with a
 * different model/dimensions/version than the active embedding setup. Used
 * to drive the "re-index needed" banner and the bulk re-index action.
 */
function needsReindexPredicate(
  model: string,
  dims: number,
  documentIdRef = sql`"documents"."id"`,
) {
  return sql`EXISTS (
    SELECT 1 FROM chunks c
    WHERE c.document_id = ${documentIdRef}
      AND (
        c.embedding_model IS DISTINCT FROM ${model}
        OR c.embedding_dims IS DISTINCT FROM ${dims}
        OR c.embedding_version IS DISTINCT FROM ${EMBEDDING_VERSION}
      )
  )`;
}

interface DocumentRow {
  id: string;
  workspace_id: string;
  title: string;
  file_type: string | null;
  status: 'processing' | 'ready' | 'failed';
  chunk_count: number;
  error_message: string | null;
  attempts: number;
  created_at: Date;
  needs_reindex: boolean;
}

function rowToDocumentDTO(row: DocumentRow): DocumentDTO {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    fileType: row.file_type,
    status: row.status,
    chunkCount: Number(row.chunk_count),
    errorMessage: row.error_message,
    attempts: Number(row.attempts),
    needsReindex: Boolean(row.needs_reindex),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/** Ensures the workspace exists and belongs to the authenticated user. */
async function assertWorkspaceOwnership(
  userId: string,
  workspaceId: string,
): Promise<void> {
  const [workspace] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.userId, userId)))
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
      const [model, dims] = await Promise.all([
        getEffectiveEmbeddingModel(),
        getEmbeddingDimensions(),
      ]);
      const result = await db.execute(
        sql`
          SELECT d.id, d.workspace_id, d.title, d.file_type, d.status,
                 d.chunk_count, d.error_message, d.attempts, d.created_at,
                 ${needsReindexPredicate(model, dims, sql.raw('d.id'))} AS needs_reindex
          FROM documents d
          WHERE d.workspace_id = ${input.workspaceId}
          ORDER BY d.created_at DESC
        `,
      );
      const rows = (result as unknown as { rows: DocumentRow[] }).rows;
      return rows.map(rowToDocumentDTO);
    }),

  /** Whether the workspace's chunks match the active embedding setup. */
  retrievalStatus: protectedProcedure
    .input(workspaceIdSchema)
    .query(async ({ ctx, input }): Promise<RetrievalStatus> => {
      await assertWorkspaceOwnership(ctx.user.id, input.workspaceId);
      const [model, dims] = await Promise.all([
        getEffectiveEmbeddingModel(),
        getEmbeddingDimensions(),
      ]);
      const result = await db.execute(
        sql`
          SELECT
            COUNT(*)::int AS total_documents,
            COUNT(*) FILTER (WHERE ${needsReindexPredicate(model, dims, sql.raw('d.id'))})::int AS needs_reindex,
            COUNT(*) FILTER (WHERE d.status = 'processing')::int AS reindexing
          FROM documents d
          WHERE d.workspace_id = ${input.workspaceId}
        `,
      );
      const row = (
        result as unknown as {
          rows: Array<{
            total_documents: number;
            needs_reindex: number;
            reindexing: number;
          }>;
        }
      ).rows[0];
      return {
        currentModel: model,
        currentDims: dims,
        totalDocuments: Number(row?.total_documents ?? 0),
        documentsNeedingReindex: Number(row?.needs_reindex ?? 0),
        documentsReindexing: Number(row?.reindexing ?? 0),
      };
    }),

  /** Re-queue every document whose chunks do not match the active model. */
  reindexAll: protectedProcedure
    .input(workspaceIdSchema)
    .mutation(async ({ ctx, input }): Promise<{ queued: number }> => {
      await assertWorkspaceOwnership(ctx.user.id, input.workspaceId);
      const [model, dims] = await Promise.all([
        getEffectiveEmbeddingModel(),
        getEmbeddingDimensions(),
      ]);
      const result = await db.execute(
        sql`
          SELECT d.id FROM documents d
          WHERE d.workspace_id = ${input.workspaceId}
            AND ${needsReindexPredicate(model, dims, sql.raw('d.id'))}
        `,
      );
      const ids = (
        result as unknown as { rows: Array<{ id: string }> }
      ).rows.map((row) => row.id);

      for (const id of ids) {
        await db
          .update(documents)
          .set({
            status: 'processing',
            errorMessage: null,
            attempts: 0,
            updatedAt: new Date(),
          })
          .where(eq(documents.id, id));
        await enqueueDocumentEmbedding(id);
      }
      return { queued: ids.length };
    }),

  retry: protectedProcedure
    .input(documentIdSchema)
    .mutation(async ({ ctx, input }): Promise<DocumentDTO> => {
      const [doc] = await db
        .select({
          ...getTableColumns(documents),
          workspaceUserId: workspaces.userId,
        })
        .from(documents)
        .innerJoin(workspaces, eq(workspaces.id, documents.workspaceId))
        .where(eq(documents.id, input.documentId))
        .limit(1);
      if (!doc || doc.workspaceUserId !== ctx.user.id) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Document not found',
        });
      }

      const [updated] = await db
        .update(documents)
        .set({
          status: 'processing',
          errorMessage: null,
          attempts: 0,
          updatedAt: new Date(),
        })
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
        .select({
          ...getTableColumns(documents),
          workspaceUserId: workspaces.userId,
        })
        .from(documents)
        .innerJoin(workspaces, eq(workspaces.id, documents.workspaceId))
        .where(eq(documents.id, input.documentId))
        .limit(1);
      if (!doc || doc.workspaceUserId !== ctx.user.id) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Document not found',
        });
      }

      await db.delete(documents).where(eq(documents.id, doc.id));
      // Drop any queued indexing job so a deleted document cannot burn
      // provider tokens or race the delete with chunk inserts.
      await cancelDocumentEmbedding(doc.id);
      await rm(path.resolve(UPLOAD_DIR, doc.filePath), { force: true }).catch(
        () => undefined,
      );
      return { deleted: true };
    }),
});
