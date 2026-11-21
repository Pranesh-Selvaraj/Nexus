import { z } from 'zod';
export const vocabularyStateSchema = z.enum(['known', 'learning', 'ignored']);
export type VocabularyState = z.infer<typeof vocabularyStateSchema>;

export const vocabularyItemDTOSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  term: z.string(),
  lemma: z.string(),
  language: z.string(),
  translation: z.string().nullable(),
  partOfSpeech: z.string().nullable(),
  example: z.string().nullable(),
  frequencyRank: z.number().int().nullable(),
  state: vocabularyStateSchema,
  cardId: z.string().uuid().nullable(),
  createdAt: z.string(),
});
export type VocabularyItemDTO = z.infer<typeof vocabularyItemDTOSchema>;

export const mineVocabularyInputSchema = z.object({
  workspaceId: z.string().uuid(),
  text: z.string().trim().min(1).max(8000),
  language: z.string().max(40).optional(),
  targetLanguage: z.string().max(40).optional(),
  createCards: z.boolean().default(true),
  sourceChunkId: z.string().uuid().optional(),
  sourceMessageId: z.string().uuid().optional(),
  maxTerms: z.number().int().min(1).max(30).default(12),
});
export type MineVocabularyInput = z.infer<typeof mineVocabularyInputSchema>;

export const mineVocabularyResultSchema = z.object({
  items: z.array(vocabularyItemDTOSchema),
  cardsCreated: z.number().int().nonnegative(),
  deckId: z.string().uuid().nullable(),
});
export type MineVocabularyResult = z.infer<typeof mineVocabularyResultSchema>;

export const listVocabularyInputSchema = z.object({
  workspaceId: z.string().uuid(),
  state: vocabularyStateSchema.optional(),
  query: z.string().max(120).optional(),
});
export const updateVocabularyInputSchema = z.object({
  vocabularyId: z.string().uuid(),
  state: vocabularyStateSchema.optional(),
  translation: z.string().max(400).optional(),
});
export const deleteVocabularyInputSchema = z.object({
  vocabularyId: z.string().uuid(),
});

// --- CEFR ------------------------------------------------------------------

export const cefrLevelSchema = z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
export type CefrLevel = z.infer<typeof cefrLevelSchema>;

export const CEFR_LEVELS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export const languageSkillSchema = z.enum([
  'reading',
  'writing',
  'listening',
  'speaking',
]);
export type LanguageSkill = z.infer<typeof languageSkillSchema>;

export const cefrSkillSchema = z.object({
  skill: languageSkillSchema,
  level: cefrLevelSchema,
  score: z.number().min(0).max(1),
  evidence: z.number().int().nonnegative(),
  updatedAt: z.string(),
});
export type CefrSkill = z.infer<typeof cefrSkillSchema>;

export const cefrProfileSchema = z.object({
  workspaceId: z.string().uuid(),
  overall: cefrLevelSchema,
  skills: z.array(cefrSkillSchema),
  targetLanguage: z.string(),
});
export type CefrProfile = z.infer<typeof cefrProfileSchema>;

// --- Dictation -------------------------------------------------------------

export const dictationWordSchema = z.object({
  word: z.string(),
  status: z.enum(['correct', 'wrong', 'missing', 'extra']),
});
export type DictationWord = z.infer<typeof dictationWordSchema>;

export const dictationScoreSchema = z.object({
  accuracy: z.number().min(0).max(1),
  correct: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  words: z.array(dictationWordSchema),
});
export type DictationScore = z.infer<typeof dictationScoreSchema>;

export const dictationScoreInputSchema = z.object({
  workspaceId: z.string().uuid(),
  target: z.string().trim().min(1).max(1000),
  typed: z.string().max(2000),
  language: z.string().max(40).optional(),
});
export type DictationScoreInput = z.infer<typeof dictationScoreInputSchema>;
