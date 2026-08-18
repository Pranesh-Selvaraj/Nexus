import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

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
import {
  conversations,
  documents,
  messages,
  workspaces,
} from '../db/schema.js';
import { protectedProcedure, t } from '../middleware/auth.js';
import { enqueueDocumentEmbedding } from '../queues/index.js';
import { UPLOAD_DIR } from '../utils/paths.js';

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
                WHERE d.workspace_id = w.id) AS document_count
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

      // Remove the workspace's uploaded files from disk (the DB rows are
      // cascade-deleted, but the files are not).
      await rm(path.join(UPLOAD_DIR, deleted.id), {
        recursive: true,
        force: true,
      }).catch(() => undefined);
      return { deleted: true };
    }),

  /**
   * Full workspace backup: metadata, uploaded file contents (base64) and
   * the complete chat history. Restore with `import`.
   */
  export: protectedProcedure
    .input(workspaceIdSchema)
    .query(async ({ ctx, input }): Promise<WorkspaceArchive> => {
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

      const docRows = await db
        .select()
        .from(documents)
        .where(eq(documents.workspaceId, workspace.id));

      const documentsArchive = await Promise.all(
        docRows.map(async (doc) => {
          let contentBase64 = '';
          try {
            contentBase64 = (
              await readFile(path.join(UPLOAD_DIR, doc.filePath))
            ).toString('base64');
          } catch {
            // file missing on disk - export metadata only
          }
          return { title: doc.title, fileType: doc.fileType, contentBase64 };
        }),
      );

      const conversationRows = await db
        .select()
        .from(conversations)
        .where(eq(conversations.workspaceId, workspace.id));

      const conversationsArchive = await Promise.all(
        conversationRows.map(async (conversation) => {
          const messageRows = await db
            .select()
            .from(messages)
            .where(eq(messages.conversationId, conversation.id))
            .orderBy(messages.createdAt);
          return {
            title: conversation.title,
            messages: messageRows.map((m) => ({
              role: m.role,
              content: m.content,
              sources: m.sources,
              usage: null,
              createdAt: new Date(m.createdAt).toISOString(),
            })),
          };
        }),
      );

      return {
        version: 1,
        exportedAt: new Date().toISOString(),
        workspace: {
          name: workspace.name,
          description: workspace.description,
        },
        documents: documentsArchive,
        conversations: conversationsArchive,
      };
    }),

  /** Restore an exported workspace (documents are re-indexed). */
  import: protectedProcedure
    .input(importWorkspaceInputSchema)
    .mutation(async ({ ctx, input }): Promise<WorkspaceDTO> => {
      const { archive } = input;
      const [created] = await db
        .insert(workspaces)
        .values({
          userId: ctx.user.id,
          name:
            archive.workspace.name.trim().slice(0, 80) || 'Imported workspace',
          description: archive.workspace.description,
        })
        .returning();
      if (!created) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      }

      // Restore documents: write file contents under fresh server-controlled
      // names and re-queue embeddings.
      const workspaceDir = path.join(UPLOAD_DIR, created.id);
      await mkdir(workspaceDir, { recursive: true });

      for (const doc of archive.documents) {
        const filename = randomUUID();
        const filePath = path.join(workspaceDir, filename);
        try {
          await writeFile(filePath, Buffer.from(doc.contentBase64, 'base64'));
        } catch (err) {
          console.error('[import] skipping unreadable document:', err);
          continue;
        }
        const [inserted] = await db
          .insert(documents)
          .values({
            workspaceId: created.id,
            title: doc.title,
            filePath: `${created.id}/${filename}`,
            fileType: doc.fileType,
            status: 'processing',
          })
          .returning({ id: documents.id });
        if (inserted) {
          await enqueueDocumentEmbedding(inserted.id).catch((err) =>
            console.error('[import] enqueue failed:', err),
          );
        }
      }

      // Restore conversations and their messages.
      for (const conversation of archive.conversations) {
        const [conv] = await db
          .insert(conversations)
          .values({
            workspaceId: created.id,
            title: conversation.title.slice(0, 200) || 'Imported conversation',
          })
          .returning({ id: conversations.id });
        if (!conv) continue;
        for (const message of conversation.messages) {
          await db.insert(messages).values({
            conversationId: conv.id,
            role: message.role,
            content: message.content,
            sources: message.sources,
            createdAt: new Date(message.createdAt),
          });
        }
      }

      return toWorkspaceDTO({
        id: created.id,
        name: created.name,
        description: created.description,
        created_at: created.createdAt,
        document_count: archive.documents.length,
      });
    }),
});
