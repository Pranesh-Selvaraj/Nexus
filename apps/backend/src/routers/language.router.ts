import { and, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

import type {
  CefrProfile,
  DictationScore,
  MineVocabularyResult,
  VocabularyItemDTO,
} from '@nexus/shared-types';
import {
  deleteVocabularyInputSchema,
  dictationScoreInputSchema,
  listVocabularyInputSchema,
  mineVocabularyInputSchema,
  updateVocabularyInputSchema,
  workspaceIdSchema,
} from '@nexus/shared-types';

import { db } from '../db/index.js';
import { vocabularyItems, workspaces } from '../db/schema.js';
import { protectedProcedure, t } from '../middleware/auth.js';
import { estimateCefr, scoreDictation } from '../services/language.service.js';
import {
  deleteVocabulary,
  listVocabulary,
  mineAndStore,
  updateVocabulary,
} from '../services/vocabulary.service.js';

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

async function assertVocabularyOwnership(
  userId: string,
  vocabularyId: string,
): Promise<typeof vocabularyItems.$inferSelect> {
  const [row] = await db
    .select({ item: vocabularyItems })
    .from(vocabularyItems)
    .innerJoin(workspaces, eq(workspaces.id, vocabularyItems.workspaceId))
    .where(
      and(eq(vocabularyItems.id, vocabularyId), eq(workspaces.userId, userId)),
    )
    .limit(1);
  if (!row) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Vocabulary item not found',
    });
  }
  return row.item;
}

export const languageRouter = t.router({
  vocabulary: t.router({
    list: protectedProcedure
      .input(listVocabularyInputSchema)
      .query(async ({ ctx, input }): Promise<VocabularyItemDTO[]> => {
        await assertWorkspaceOwnership(ctx.user.id, input.workspaceId);
        return listVocabulary(input.workspaceId, {
          state: input.state,
          query: input.query,
        });
      }),

    /** Mine terms from a passage and create a card per new term. */
    mine: protectedProcedure
      .input(mineVocabularyInputSchema)
      .mutation(async ({ ctx, input }): Promise<MineVocabularyResult> => {
        await assertWorkspaceOwnership(ctx.user.id, input.workspaceId);
        return mineAndStore(input);
      }),

    update: protectedProcedure
      .input(updateVocabularyInputSchema)
      .mutation(async ({ ctx, input }): Promise<VocabularyItemDTO> => {
        await assertVocabularyOwnership(ctx.user.id, input.vocabularyId);
        return updateVocabulary(input.vocabularyId, {
          state: input.state,
          translation: input.translation,
        });
      }),

    delete: protectedProcedure
      .input(deleteVocabularyInputSchema)
      .mutation(async ({ ctx, input }): Promise<{ deleted: boolean }> => {
        await assertVocabularyOwnership(ctx.user.id, input.vocabularyId);
        return { deleted: await deleteVocabulary(input.vocabularyId) };
      }),
  }),

  cefr: t.router({
    /** Recompute and return the CEFR estimate per skill. */
    get: protectedProcedure
      .input(workspaceIdSchema)
      .query(async ({ ctx, input }): Promise<CefrProfile> => {
        await assertWorkspaceOwnership(ctx.user.id, input.workspaceId);
        return estimateCefr(input.workspaceId);
      }),
  }),

  dictation: t.router({
    score: protectedProcedure
      .input(dictationScoreInputSchema)
      .mutation(async ({ ctx, input }): Promise<DictationScore> => {
        await assertWorkspaceOwnership(ctx.user.id, input.workspaceId);
        return scoreDictation({
          userId: ctx.user.id,
          workspaceId: input.workspaceId,
          target: input.target,
          typed: input.typed,
          language: input.language,
        });
      }),
  }),
});
