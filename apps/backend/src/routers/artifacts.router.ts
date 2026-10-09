import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';

import type { ArtifactDTO } from '@nexus/shared-types';
import {
  artifactIdSchema,
  generateArtifactInputSchema,
  workspaceIdSchema,
} from '@nexus/shared-types';

import { db } from '../db/index.js';
import { artifacts, workspaces } from '../db/schema.js';
import { protectedProcedure, t } from '../middleware/auth.js';
import {
  ARTIFACT_META,
  generateArtifact,
} from '../services/artifact.service.js';
import { loadDocumentText } from '../services/source-text.service.js';

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

function toArtifactDTO(row: typeof artifacts.$inferSelect): ArtifactDTO {
  const kind = (
    ['summary', 'study_guide', 'glossary', 'mindmap'] as const
  ).includes(row.kind as never)
    ? (row.kind as ArtifactDTO['kind'])
    : 'summary';
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    kind,
    title: row.title,
    contentMd: row.contentMd,
    sourceDocumentId: row.sourceDocumentId,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

export const artifactsRouter = t.router({
  list: protectedProcedure
    .input(workspaceIdSchema)
    .query(async ({ ctx, input }): Promise<ArtifactDTO[]> => {
      await assertWorkspaceOwnership(ctx.user.id, input.workspaceId);
      const rows = await db
        .select()
        .from(artifacts)
        .where(eq(artifacts.workspaceId, input.workspaceId))
        .orderBy(desc(artifacts.createdAt))
        .limit(200);
      return rows.map(toArtifactDTO);
    }),

  generate: protectedProcedure
    .input(generateArtifactInputSchema)
    .mutation(async ({ ctx, input }): Promise<ArtifactDTO> => {
      await assertWorkspaceOwnership(ctx.user.id, input.workspaceId);
      const sourceText = input.documentId
        ? await loadDocumentText(input.workspaceId, input.documentId)
        : (input.text ?? '');

      const contentMd = await generateArtifact(input.kind, sourceText);
      if (!contentMd) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Could not generate this artifact. Try again or pick another document.',
        });
      }

      const meta = ARTIFACT_META[input.kind];
      const [created] = await db
        .insert(artifacts)
        .values({
          workspaceId: input.workspaceId,
          kind: input.kind,
          title: `${meta.title} · ${new Date().toISOString().slice(0, 10)}`,
          contentMd,
          sourceDocumentId: input.documentId ?? null,
        })
        .returning();
      if (!created) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      }
      return toArtifactDTO(created);
    }),

  delete: protectedProcedure
    .input(artifactIdSchema)
    .mutation(async ({ ctx, input }): Promise<{ deleted: boolean }> => {
      const [row] = await db
        .select({ id: artifacts.id })
        .from(artifacts)
        .innerJoin(workspaces, eq(workspaces.id, artifacts.workspaceId))
        .where(
          and(
            eq(artifacts.id, input.artifactId),
            eq(workspaces.userId, ctx.user.id),
          ),
        )
        .limit(1);
      if (!row) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Artifact not found',
        });
      }
      await db.delete(artifacts).where(eq(artifacts.id, row.id));
      return { deleted: true };
    }),
});
