import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';

import type { HighlightDTO, NoteDTO } from '@nexus/shared-types';
import {
  createHighlightInputSchema,
  createNoteInputSchema,
  highlightIdSchema,
  noteIdSchema,
  updateHighlightInputSchema,
  updateNoteInputSchema,
  workspaceIdSchema,
} from '@nexus/shared-types';

import { db } from '../db/index.js';
import { workspaceAccessPredicate } from '../services/access.service.js';
import {
  chunks,
  conversations,
  documents,
  highlights,
  messages,
  notes,
  workspaces,
} from '../db/schema.js';
import { protectedProcedure, t } from '../middleware/auth.js';
import { assertWorkspaceAccessTrpc } from '../middleware/access.js';

async function assertWorkspaceOwnership(
  userId: string,
  workspaceId: string,
  minRole: 'reader' | 'editor' | 'owner' = 'reader',
): Promise<void> {
  await assertWorkspaceAccessTrpc(userId, workspaceId, minRole);
}

function toNoteDTO(row: typeof notes.$inferSelect): NoteDTO {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    title: row.title,
    contentMd: row.contentMd,
    tags: row.tags ?? [],
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function toHighlightDTO(row: typeof highlights.$inferSelect): HighlightDTO {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    documentId: row.documentId,
    messageId: row.messageId,
    quotedText: row.quotedText,
    note: row.note,
    color: row.color,
    tags: row.tags ?? [],
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

/** Confirms an optional highlight target belongs to the workspace. */
async function assertTargetsInWorkspace(input: {
  workspaceId: string;
  documentId?: string;
  messageId?: string;
  chunkId?: string;
}): Promise<void> {
  if (input.documentId) {
    const [doc] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.id, input.documentId),
          eq(documents.workspaceId, input.workspaceId),
        ),
      )
      .limit(1);
    if (!doc) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Document not found in this workspace',
      });
    }
  }
  if (input.messageId) {
    const [message] = await db
      .select({ id: messages.id })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(
        and(
          eq(messages.id, input.messageId),
          eq(conversations.workspaceId, input.workspaceId),
        ),
      )
      .limit(1);
    if (!message) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Message not found in this workspace',
      });
    }
  }
  if (input.chunkId) {
    const [chunk] = await db
      .select({ id: chunks.id })
      .from(chunks)
      .innerJoin(documents, eq(documents.id, chunks.documentId))
      .where(
        and(
          eq(chunks.id, input.chunkId),
          eq(documents.workspaceId, input.workspaceId),
        ),
      )
      .limit(1);
    if (!chunk) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Chunk not found in this workspace',
      });
    }
  }
}

export const notesRouter = t.router({
  notes: t.router({
    list: protectedProcedure
      .input(workspaceIdSchema)
      .query(async ({ ctx, input }): Promise<NoteDTO[]> => {
        await assertWorkspaceOwnership(ctx.user.id, input.workspaceId);
        const rows = await db
          .select()
          .from(notes)
          .where(eq(notes.workspaceId, input.workspaceId))
          .orderBy(desc(notes.updatedAt))
          .limit(500);
        return rows.map(toNoteDTO);
      }),

    create: protectedProcedure
      .input(createNoteInputSchema)
      .mutation(async ({ ctx, input }): Promise<NoteDTO> => {
        await assertWorkspaceOwnership(
          ctx.user.id,
          input.workspaceId,
          'editor',
        );
        const [created] = await db
          .insert(notes)
          .values({
            workspaceId: input.workspaceId,
            title: input.title,
            contentMd: input.contentMd,
            tags: input.tags,
          })
          .returning();
        if (!created) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
        }
        return toNoteDTO(created);
      }),

    update: protectedProcedure
      .input(updateNoteInputSchema)
      .mutation(async ({ ctx, input }): Promise<NoteDTO> => {
        const [row] = await db
          .select()
          .from(notes)
          .innerJoin(workspaces, eq(workspaces.id, notes.workspaceId))
          .where(
            and(
              eq(notes.id, input.noteId),
              workspaceAccessPredicate(ctx.user.id),
            ),
          )
          .limit(1);
        if (!row) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Note not found' });
        }
        await assertWorkspaceOwnership(
          ctx.user.id,
          row.workspaces.id,
          'editor',
        );
        const [updated] = await db
          .update(notes)
          .set({
            title: input.title ?? row.notes.title,
            contentMd: input.contentMd ?? row.notes.contentMd,
            tags: input.tags ?? row.notes.tags,
            updatedAt: new Date(),
          })
          .where(eq(notes.id, input.noteId))
          .returning();
        if (!updated) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
        }
        return toNoteDTO(updated);
      }),

    delete: protectedProcedure
      .input(noteIdSchema)
      .mutation(async ({ ctx, input }): Promise<{ deleted: boolean }> => {
        const [row] = await db
          .select({ id: notes.id, workspaceId: notes.workspaceId })
          .from(notes)
          .innerJoin(workspaces, eq(workspaces.id, notes.workspaceId))
          .where(
            and(
              eq(notes.id, input.noteId),
              workspaceAccessPredicate(ctx.user.id),
            ),
          )
          .limit(1);
        if (!row) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Note not found' });
        }
        await assertWorkspaceOwnership(ctx.user.id, row.workspaceId, 'editor');
        await db.delete(notes).where(eq(notes.id, row.id));
        return { deleted: true };
      }),
  }),

  highlights: t.router({
    list: protectedProcedure
      .input(
        workspaceIdSchema.extend({
          documentId: workspaceIdSchema.shape.workspaceId.optional(),
        }),
      )
      .query(async ({ ctx, input }): Promise<HighlightDTO[]> => {
        await assertWorkspaceOwnership(ctx.user.id, input.workspaceId);
        const conditions = [eq(highlights.workspaceId, input.workspaceId)];
        if (input.documentId) {
          conditions.push(eq(highlights.documentId, input.documentId));
        }
        const rows = await db
          .select()
          .from(highlights)
          .where(and(...conditions))
          .orderBy(desc(highlights.createdAt))
          .limit(500);
        return rows.map(toHighlightDTO);
      }),

    create: protectedProcedure
      .input(createHighlightInputSchema)
      .mutation(async ({ ctx, input }): Promise<HighlightDTO> => {
        await assertWorkspaceOwnership(
          ctx.user.id,
          input.workspaceId,
          'editor',
        );
        await assertTargetsInWorkspace(input);
        const [created] = await db
          .insert(highlights)
          .values({
            workspaceId: input.workspaceId,
            documentId: input.documentId ?? null,
            messageId: input.messageId ?? null,
            chunkId: input.chunkId ?? null,
            quotedText: input.quotedText,
            note: input.note ?? null,
            color: input.color ?? 'yellow',
            tags: input.tags,
          })
          .returning();
        if (!created) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
        }
        return toHighlightDTO(created);
      }),

    update: protectedProcedure
      .input(updateHighlightInputSchema)
      .mutation(async ({ ctx, input }): Promise<HighlightDTO> => {
        const [row] = await db
          .select()
          .from(highlights)
          .innerJoin(workspaces, eq(workspaces.id, highlights.workspaceId))
          .where(
            and(
              eq(highlights.id, input.highlightId),
              workspaceAccessPredicate(ctx.user.id),
            ),
          )
          .limit(1);
        if (!row) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Highlight not found',
          });
        }
        const [updated] = await db
          .update(highlights)
          .set({
            note: input.note ?? row.highlights.note,
            color: input.color ?? row.highlights.color,
            tags: input.tags ?? row.highlights.tags,
          })
          .where(eq(highlights.id, input.highlightId))
          .returning();
        if (!updated) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
        }
        return toHighlightDTO(updated);
      }),

    delete: protectedProcedure
      .input(highlightIdSchema)
      .mutation(async ({ ctx, input }): Promise<{ deleted: boolean }> => {
        const [row] = await db
          .select({ id: highlights.id })
          .from(highlights)
          .innerJoin(workspaces, eq(workspaces.id, highlights.workspaceId))
          .where(
            and(
              eq(highlights.id, input.highlightId),
              workspaceAccessPredicate(ctx.user.id),
            ),
          )
          .limit(1);
        if (!row) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Highlight not found',
          });
        }
        await db.delete(highlights).where(eq(highlights.id, row.id));
        return { deleted: true };
      }),
  }),
});
