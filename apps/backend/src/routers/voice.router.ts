import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import type {
  MinimalPair,
  PronunciationScore,
  VoiceConfig,
} from '@nexus/shared-types';
import {
  scorePronunciationInputSchema,
  TTS_VOICES,
  workspaceIdSchema,
} from '@nexus/shared-types';

import { db } from '../db/index.js';
import { audioAssets, workspaces } from '../db/schema.js';
import { protectedProcedure, t } from '../middleware/auth.js';
import { deleteAudioAsset, toAudioDTO } from '../services/audio.service.js';
import {
  listPronunciationAttempts,
  MINIMAL_PAIRS,
  scorePronunciation,
} from '../services/pronunciation.service.js';
import {
  getSetting,
  getSettingBoolean,
  getSettingNumber,
} from '../services/settings.service.js';
import { sttServerAvailable } from '../services/stt.service.js';
import { resolveVoice, ttsServerAvailable } from '../services/tts.service.js';

/** Languages offered in the dictation/pronunciation pickers. */
export const VOICE_LANGUAGES = [
  'auto',
  'en-US',
  'en-GB',
  'es-ES',
  'fr-FR',
  'de-DE',
  'it-IT',
  'pt-BR',
  'nl-NL',
  'pl-PL',
  'ru-RU',
  'tr-TR',
  'ar-SA',
  'hi-IN',
  'ja-JP',
  'ko-KR',
  'zh-CN',
];

const audioIdSchema = z.object({ audioId: z.string().uuid() });

const audioListInputSchema = z.object({
  workspaceId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

async function assertWorkspaceOwnership(
  userId: string,
  workspaceId: string,
): Promise<void> {
  const [workspace] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.userId, userId)))
    .limit(1);
  if (!workspace) throw new Error('Workspace not found');
}

export const voiceRouter = t.router({
  /** Effective voice capabilities and defaults for the client. */
  config: protectedProcedure.query(async (): Promise<VoiceConfig> => {
    const [
      sttMode,
      ttsProvider,
      sttLanguage,
      ttsVoice,
      ttsSpeed,
      targetLanguage,
      nativeLanguage,
      correctionPolicy,
      autoSend,
      retentionDays,
      maxStorageMb,
      hasStt,
      hasTts,
    ] = await Promise.all([
      getSetting('voice.sttMode'),
      getSetting('voice.ttsProvider'),
      getSetting('voice.sttLanguage'),
      getSetting('voice.ttsVoice'),
      getSettingNumber('voice.ttsSpeed'),
      getSetting('language.target'),
      getSetting('language.native'),
      getSetting('voice.correctionPolicy'),
      getSettingBoolean('voice.autoSend'),
      getSettingNumber('voice.retentionDays'),
      getSettingNumber('voice.maxStorageMb'),
      sttServerAvailable(),
      ttsServerAvailable(),
    ]);

    return {
      sttMode: sttMode === 'server' ? 'server' : 'browser',
      ttsProvider: ttsProvider === 'browser' ? 'browser' : 'server',
      sttLanguage,
      ttsVoice: resolveVoice(ttsVoice),
      ttsSpeed,
      targetLanguage,
      nativeLanguage,
      correctionPolicy:
        correctionPolicy === 'immediate' || correctionPolicy === 'asked'
          ? correctionPolicy
          : 'recap',
      autoSend,
      retentionDays,
      maxStorageMb,
      sttServerAvailable: hasStt,
      ttsServerAvailable: hasTts,
      voices: TTS_VOICES,
      languages: VOICE_LANGUAGES,
    };
  }),

  audio: t.router({
    /** Retained audio assets for the current user (retention UI). */
    list: protectedProcedure
      .input(audioListInputSchema)
      .query(async ({ ctx, input }) => {
        if (input.workspaceId) {
          await assertWorkspaceOwnership(ctx.user.id, input.workspaceId);
        }
        // Scope by workspace when one is given (the parameter is not only an
        // authorisation probe); without one, list the user's whole cache.
        const filters = [eq(audioAssets.userId, ctx.user.id)];
        if (input.workspaceId) {
          filters.push(eq(audioAssets.workspaceId, input.workspaceId));
        }
        const rows = await db
          .select()
          .from(audioAssets)
          .where(and(...filters))
          .orderBy(desc(audioAssets.createdAt))
          .limit(input.limit);
        return rows.map(toAudioDTO);
      }),

    delete: protectedProcedure
      .input(audioIdSchema)
      .mutation(async ({ ctx, input }): Promise<{ deleted: boolean }> => {
        const [row] = await db
          .select({ id: audioAssets.id })
          .from(audioAssets)
          .where(
            and(
              eq(audioAssets.id, input.audioId),
              eq(audioAssets.userId, ctx.user.id),
            ),
          )
          .limit(1);
        if (!row) throw new Error('Audio asset not found');
        return { deleted: await deleteAudioAsset(input.audioId) };
      }),
  }),

  pronunciation: t.router({
    score: protectedProcedure
      .input(scorePronunciationInputSchema)
      .mutation(async ({ ctx, input }): Promise<PronunciationScore> => {
        await assertWorkspaceOwnership(ctx.user.id, input.workspaceId);
        return scorePronunciation({
          userId: ctx.user.id,
          workspaceId: input.workspaceId,
          target: input.target,
          transcript: input.transcript,
          language: input.language,
          durationMs: input.durationMs,
        });
      }),

    list: protectedProcedure
      .input(workspaceIdSchema)
      .query(async ({ ctx, input }): Promise<PronunciationScore[]> => {
        await assertWorkspaceOwnership(ctx.user.id, input.workspaceId);
        return listPronunciationAttempts(input.workspaceId);
      }),

    minimalPairs: protectedProcedure.query((): MinimalPair[] => MINIMAL_PAIRS),
  }),
});
