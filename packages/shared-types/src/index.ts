import { z } from 'zod';

// ---------------------------------------------------------------------------
// Users (single local user, no authentication)
// ---------------------------------------------------------------------------

export const userDTOSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
});
export type UserDTO = z.infer<typeof userDTOSchema>;

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

export const workspaceDTOSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  documentCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type WorkspaceDTO = z.infer<typeof workspaceDTOSchema>;

export const createWorkspaceInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).optional(),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInputSchema>;

export const updateWorkspaceInputSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(240).optional(),
});
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceInputSchema>;

export const workspaceIdSchema = z.object({
  workspaceId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const documentStatusSchema = z.enum(['processing', 'ready', 'failed']);
export type DocumentStatus = z.infer<typeof documentStatusSchema>;

export const documentDTOSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  title: z.string(),
  fileType: z.string().nullable(),
  status: documentStatusSchema,
  chunkCount: z.number().int().nonnegative(),
  /** Sanitized reason the last indexing attempt failed, if any. */
  errorMessage: z.string().nullable(),
  /** Number of indexing attempts made so far. */
  attempts: z.number().int().nonnegative(),
  /** True when some chunks were embedded with a different/unknown model. */
  needsReindex: z.boolean(),
  createdAt: z.string(),
});

export const retrievalStatusSchema = z.object({
  currentModel: z.string(),
  currentDims: z.number().int(),
  totalDocuments: z.number().int().nonnegative(),
  documentsNeedingReindex: z.number().int().nonnegative(),
  documentsReindexing: z.number().int().nonnegative(),
});
export type RetrievalStatus = z.infer<typeof retrievalStatusSchema>;
export type DocumentDTO = z.infer<typeof documentDTOSchema>;

export const listDocumentsInputSchema = z.object({
  workspaceId: z.string().uuid(),
});

export const documentIdSchema = z.object({
  documentId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Chat / RAG
// ---------------------------------------------------------------------------

export const chatRoleSchema = z.enum(['user', 'assistant']);
export type ChatRole = z.infer<typeof chatRoleSchema>;

export const messageKindSchema = z.enum(['answer', 'error']);
export type MessageKind = z.infer<typeof messageKindSchema>;

export const chatHistoryMessageSchema = z.object({
  role: chatRoleSchema,
  content: z.string().min(1).max(8000),
});
export type ChatHistoryMessage = z.infer<typeof chatHistoryMessageSchema>;

export const chatStreamInputSchema = z.object({
  workspaceId: z.string().uuid(),
  message: z.string().min(1).max(4000),
  conversationId: z.string().uuid().optional(),
  // Kept for backward compatibility; the server now builds history from the
  // persisted conversation so client-supplied turns can never be trusted.
  history: z.array(chatHistoryMessageSchema).max(20).default([]),
  /** Re-answer the last user message without inserting a duplicate turn. */
  regenerate: z.boolean().optional(),
});
export type ChatStreamInput = z.infer<typeof chatStreamInputSchema>;

export const conversationIdSchema = z.object({
  conversationId: z.string().uuid(),
});

export const conversationDTOSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  title: z.string(),
  messageCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ConversationDTO = z.infer<typeof conversationDTOSchema>;

export const sourceSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  title: z.string(),
  content: z.string(),
  page: z.number().nullable(),
  pageEnd: z.number().nullable().optional(),
  headingPath: z.array(z.string()).nullable().optional(),
  /** Displayed relevance (vector cosine similarity, 0..1). */
  similarity: z.number().min(0).max(1),
  /** Raw vector similarity before fusion. */
  vectorScore: z.number().min(0).max(1).optional(),
  /** Keyword (full-text rank) contribution, normalized to 0..1. */
  keywordScore: z.number().min(0).optional(),
  /** Reciprocal-rank-fusion score used for ordering. */
  fusedScore: z.number().min(0).optional(),
  /** True when the final answer cited this source by number. */
  cited: z.boolean().optional(),
});
export type Source = z.infer<typeof sourceSchema>;

// ---------------------------------------------------------------------------
// Retrieval (profiles, candidates, inspector)
// ---------------------------------------------------------------------------

export const retrievalProfileSchema = z.enum(['fast', 'balanced', 'thorough']);
export type RetrievalProfile = z.infer<typeof retrievalProfileSchema>;

export const retrievalCandidateSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  title: z.string(),
  page: z.number().nullable(),
  headingPath: z.array(z.string()).nullable().optional(),
  vectorScore: z.number(),
  keywordScore: z.number(),
  fusedScore: z.number(),
  /** 1-based position in the fused ordering before reranking. */
  rank: z.number().int(),
  /** Final position after reranking, when reranking ran. */
  rerankedRank: z.number().int().nullable().optional(),
  selected: z.boolean(),
  contentPreview: z.string(),
});
export type RetrievalCandidate = z.infer<typeof retrievalCandidateSchema>;

export const retrievalDebugSchema = z.object({
  profile: retrievalProfileSchema,
  originalQuery: z.string(),
  searchQuery: z.string(),
  rewritten: z.boolean(),
  reranked: z.boolean(),
  vectorCandidates: z.number().int(),
  keywordCandidates: z.number().int(),
  minScore: z.number(),
  tokenBudget: z.number().int(),
  usedTokens: z.number().int(),
  candidates: z.array(retrievalCandidateSchema),
});
export type RetrievalDebug = z.infer<typeof retrievalDebugSchema>;

export const usageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});
export type Usage = z.infer<typeof usageSchema>;

export const messageDTOSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  role: chatRoleSchema,
  kind: messageKindSchema,
  content: z.string(),
  sources: z.array(sourceSchema).nullable(),
  usage: usageSchema.nullable(),
  feedback: z.enum(['up', 'down']).nullable(),
  retrievalDebug: retrievalDebugSchema.nullable().optional(),
  createdAt: z.string(),
});

export const chatFeedbackInputSchema = z.object({
  messageId: z.string().uuid(),
  feedback: z.enum(['up', 'down']).nullable(),
});
export type MessageDTO = z.infer<typeof messageDTOSchema>;

export const chatEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('conversation'),
    conversationId: z.string().uuid(),
  }),
  z.object({
    type: z.literal('sources'),
    sources: z.array(sourceSchema),
    /** The query actually used for retrieval (may be rewritten). */
    query: z.string(),
    /** Inspector payload (candidates, scores, profile, budget). */
    retrieval: retrievalDebugSchema.optional(),
  }),
  z.object({
    type: z.literal('token'),
    token: z.string(),
  }),
  z.object({
    type: z.literal('done'),
    sources: z.array(sourceSchema),
    /** Persisted assistant message id (client replaces its optimistic id). */
    messageId: z.string().uuid(),
  }),
  z.object({
    type: z.literal('error'),
    message: z.string(),
  }),
]);
export type ChatEvent = z.infer<typeof chatEventSchema>;

// ---------------------------------------------------------------------------
// Usage (token tracking)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Study loop (decks, flashcards, reviews, notes, progress)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Workspace archive (export/import)
// ---------------------------------------------------------------------------

export const archiveMessageSchema = z.object({
  role: chatRoleSchema,
  content: z.string(),
  sources: z.array(sourceSchema).nullable(),
  usage: usageSchema.nullable(),
  feedback: z.enum(['up', 'down']).nullable().optional(),
  createdAt: z.string(),
});

export const archiveConversationSchema = z.object({
  title: z.string(),
  messages: z.array(archiveMessageSchema),
});

export const archiveDeckSchema = z.object({
  name: z.string(),
  cards: z.array(
    z.object({
      front: z.string(),
      back: z.string(),
      dueAt: z.string(),
      state: z.number().int(),
      reps: z.number().int(),
      lapses: z.number().int(),
    }),
  ),
});

export const archiveDocumentSchema = z.object({
  title: z.string(),
  fileType: z.string().nullable(),
  contentBase64: z.string(),
});

export const workspaceArchiveSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  workspace: z.object({
    name: z.string(),
    description: z.string().nullable(),
  }),
  documents: z.array(archiveDocumentSchema),
  conversations: z.array(archiveConversationSchema),
});
export type WorkspaceArchive = z.infer<typeof workspaceArchiveSchema>;
