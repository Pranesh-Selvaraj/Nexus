import { z } from 'zod';
export const reviewRatingSchema = z.enum(['again', 'hard', 'good', 'easy']);
export type ReviewRating = z.infer<typeof reviewRatingSchema>;

export const deckDTOSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string(),
  cardCount: z.number().int().nonnegative(),
  dueCount: z.number().int().nonnegative(),
  newCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type DeckDTO = z.infer<typeof deckDTOSchema>;

export const flashcardDTOSchema = z.object({
  id: z.string().uuid(),
  deckId: z.string().uuid(),
  kind: z.enum(['qa', 'cloze']),
  front: z.string(),
  back: z.string(),
  dueAt: z.string(),
  state: z.number().int(),
  reps: z.number().int().nonnegative(),
  lapses: z.number().int().nonnegative(),
  suspended: z.boolean(),
  createdAt: z.string(),
});
export type FlashcardDTO = z.infer<typeof flashcardDTOSchema>;

/** A due card plus the interval each rating would schedule (preview). */
export const dueCardSchema = flashcardDTOSchema.extend({
  deckName: z.string(),
  intervals: z.object({
    again: z.string(),
    hard: z.string(),
    good: z.string(),
    easy: z.string(),
  }),
});
export type DueCard = z.infer<typeof dueCardSchema>;

export const createDeckInputSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
});

export const deckIdSchema = z.object({ deckId: z.string().uuid() });

export const cardIdSchema = z.object({ cardId: z.string().uuid() });

export const createCardInputSchema = z.object({
  deckId: z.string().uuid(),
  front: z.string().trim().min(1).max(2000),
  back: z.string().trim().min(1).max(4000),
  kind: z.enum(['qa', 'cloze']).optional(),
  sourceChunkId: z.string().uuid().optional(),
  sourceMessageId: z.string().uuid().optional(),
});

export const updateCardInputSchema = z.object({
  cardId: z.string().uuid(),
  front: z.string().trim().min(1).max(2000).optional(),
  back: z.string().trim().min(1).max(4000).optional(),
  suspended: z.boolean().optional(),
});

export const generateCardsInputSchema = z
  .object({
    workspaceId: z.string().uuid(),
    deckId: z.string().uuid().optional(),
    documentId: z.string().uuid().optional(),
    text: z.string().trim().min(20).max(8000).optional(),
    count: z.number().int().min(1).max(30).default(8),
  })
  .refine((value) => value.documentId || value.text, {
    message: 'Provide a documentId or text to generate cards from',
  });

export const reviewCardInputSchema = z.object({
  cardId: z.string().uuid(),
  rating: reviewRatingSchema,
  durationMs: z.number().int().nonnegative().optional(),
});

export const dueCardsInputSchema = z.object({
  workspaceId: z.string().uuid(),
  deckId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export const studyProgressSchema = z.object({
  totalCards: z.number().int().nonnegative(),
  dueNow: z.number().int().nonnegative(),
  newCards: z.number().int().nonnegative(),
  reviewsToday: z.number().int().nonnegative(),
  streakDays: z.number().int().nonnegative(),
  /** Share of reviews rated Hard/Good/Easy in the last 30 days (null when no data). */
  retention30d: z.number().min(0).max(1).nullable(),
  cardsAdded7d: z.number().int().nonnegative(),
});
export type StudyProgress = z.infer<typeof studyProgressSchema>;

export const noteDTOSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  title: z.string(),
  contentMd: z.string(),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type NoteDTO = z.infer<typeof noteDTOSchema>;

export const createNoteInputSchema = z.object({
  workspaceId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  contentMd: z.string().max(20000).default(''),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
});

export const updateNoteInputSchema = z.object({
  noteId: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  contentMd: z.string().max(20000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
});

export const noteIdSchema = z.object({ noteId: z.string().uuid() });

export const highlightDTOSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  documentId: z.string().uuid().nullable(),
  messageId: z.string().uuid().nullable(),
  quotedText: z.string(),
  note: z.string().nullable(),
  color: z.string(),
  tags: z.array(z.string()),
  createdAt: z.string(),
});
export type HighlightDTO = z.infer<typeof highlightDTOSchema>;

export const createHighlightInputSchema = z.object({
  workspaceId: z.string().uuid(),
  documentId: z.string().uuid().optional(),
  messageId: z.string().uuid().optional(),
  chunkId: z.string().uuid().optional(),
  quotedText: z.string().trim().min(1).max(8000),
  note: z.string().trim().max(2000).optional(),
  color: z.string().trim().max(20).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
});

export const updateHighlightInputSchema = z.object({
  highlightId: z.string().uuid(),
  note: z.string().trim().max(2000).optional(),
  color: z.string().trim().max(20).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
});

export const highlightIdSchema = z.object({
  highlightId: z.string().uuid(),
});
