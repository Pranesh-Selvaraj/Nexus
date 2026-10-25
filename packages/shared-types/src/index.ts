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

/**
 * What an ingested file actually is, derived from its bytes (magic bytes for
 * containers and images, text heuristics for prose) rather than only from the
 * name the client sent. The parser registry keys off this value.
 */
export const fileFormatSchema = z.enum([
  'pdf',
  'docx',
  'pptx',
  'xlsx',
  'odt',
  'rtf',
  'epub',
  'zip',
  'html',
  'txt',
  'md',
  'csv',
  'json',
  'srt',
  'vtt',
  'png',
  'jpeg',
  'webp',
  'gif',
  'tiff',
  'bmp',
  'mp3',
  'wav',
  'ogg',
  'flac',
  'm4a',
  'aac',
  'webm',
  'mp4',
  'mov',
]);
export type FileFormat = z.infer<typeof fileFormatSchema>;

export const fileCategorySchema = z.enum([
  'document',
  'image',
  'audio',
  'video',
  'archive',
]);
export type FileCategory = z.infer<typeof fileCategorySchema>;

export const IMAGE_FILE_TYPES: FileFormat[] = [
  'png',
  'jpeg',
  'webp',
  'gif',
  'tiff',
  'bmp',
];

export const MEDIA_FILE_TYPES: FileFormat[] = [
  'mp3',
  'wav',
  'ogg',
  'flac',
  'm4a',
  'aac',
  'webm',
  'mp4',
  'mov',
];

/** True for formats the UI can render as an <img> (vision-capable). */
export function isImageFileType(fileType: string | null | undefined): boolean {
  return (
    !!fileType &&
    (IMAGE_FILE_TYPES as string[]).includes(fileType.toLowerCase())
  );
}

/** True for audio/video formats transcribed through the STT pipeline. */
export function isMediaFileType(fileType: string | null | undefined): boolean {
  return (
    !!fileType &&
    (MEDIA_FILE_TYPES as string[]).includes(fileType.toLowerCase())
  );
}

/**
 * Structure the ingestion pipeline extracted from a document: the format it
 * detected, whether OCR/vision/transcription ran, and the table of contents.
 * Rendered as document cards in the library and used to label citations.
 */
export const documentStructureSchema = z.object({
  /** Parser that produced the text (usually the detected file format). */
  format: z.string(),
  /** Human-facing family: book, slides, sheet, web, image, transcript, ... */
  kind: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  /** Original URL for web/YouTube ingestion. */
  sourceUrl: z.string().nullable().optional(),
  /** ISO timestamp of the fetch that produced sourceUrl content. */
  fetchedAt: z.string().nullable().optional(),
  pageCount: z.number().int().nonnegative().nullable().optional(),
  wordCount: z.number().int().nonnegative().nullable().optional(),
  /** Estimated reading time in minutes (~200 words/min). */
  readingMinutes: z.number().int().nonnegative().nullable().optional(),
  /** True when OCR (tesseract) produced the text. */
  ocr: z.boolean().optional(),
  /** True when a vision model described the image. */
  vision: z.boolean().optional(),
  /** True when the text is a speech-to-text transcript. */
  transcript: z.boolean().optional(),
  /** Spoken duration for audio/video, in seconds. */
  durationSeconds: z.number().nonnegative().nullable().optional(),
  /** Table of contents (chapters, slides, sheets, archive members). */
  chapters: z
    .array(
      z.object({
        title: z.string(),
        page: z.number().int().nonnegative(),
      }),
    )
    .optional(),
});
export type DocumentStructure = z.infer<typeof documentStructureSchema>;

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
  /** Structure extracted at ingestion (format, TOC, OCR/vision flags). */
  metadata: documentStructureSchema.nullable().optional(),
  /** Canonical URL for URL/YouTube ingestion. */
  sourceUrl: z.string().nullable().optional(),
  /** sha256 of the uploaded bytes, used for duplicate detection. */
  contentHash: z.string().nullable().optional(),
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

/** POST /api/ingest/url body: a web article or a YouTube link. */
export const ingestUrlInputSchema = z.object({
  workspaceId: z.string().uuid(),
  url: z.string().trim().min(8).max(2048),
});
export type IngestUrlInput = z.infer<typeof ingestUrlInputSchema>;

export const ingestUrlResultSchema = z.object({
  document: documentDTOSchema,
  /** 'article' for Readability-extracted pages, 'video' for transcripts. */
  kind: z.enum(['article', 'video']),
  sourceUrl: z.string(),
  title: z.string(),
  wordCount: z.number().int().nonnegative(),
});
export type IngestUrlResult = z.infer<typeof ingestUrlResultSchema>;

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
  /** Tutor persona id (see chat.personas); falls back to the setting. */
  persona: z.string().max(40).optional(),
  /** Image documents attached to this turn (vision chat). */
  imageDocumentIds: z.array(z.string().uuid()).max(4).optional(),
  /** Instruction preset used when images are attached. */
  visionMode: z.enum(['general', 'art', 'diagram', 'equation']).optional(),
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
  /** Detected format of the source document (image/pdf/epub/...). */
  fileType: z.string().nullable().optional(),
  /** True when this source came from an image attached to the question. */
  attached: z.boolean().optional(),
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
  /** Images attached to a user turn (vision chat). */
  attachments: z
    .object({ imageDocumentIds: z.array(z.string().uuid()) })
    .nullable()
    .optional(),
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
// Quizzes
// ---------------------------------------------------------------------------

export const quizKindSchema = z.enum(['mcq', 'truefalse', 'short']);
export type QuizKind = z.infer<typeof quizKindSchema>;

export const quizQuestionDTOSchema = z.object({
  id: z.string().uuid(),
  kind: quizKindSchema,
  prompt: z.string(),
  options: z.array(z.string()).nullable(),
  explanation: z.string().nullable(),
});
export type QuizQuestionDTO = z.infer<typeof quizQuestionDTOSchema>;

export const quizDTOSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  title: z.string(),
  questionCount: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative(),
  bestScore: z.number().min(0).max(1).nullable(),
  createdAt: z.string(),
});
export type QuizDTO = z.infer<typeof quizDTOSchema>;

export const quizDetailSchema = quizDTOSchema.extend({
  questions: z.array(quizQuestionDTOSchema),
});
export type QuizDetail = z.infer<typeof quizDetailSchema>;

export const generateQuizInputSchema = z
  .object({
    workspaceId: z.string().uuid(),
    documentId: z.string().uuid().optional(),
    text: z.string().trim().min(20).max(8000).optional(),
    count: z.number().int().min(1).max(20).default(5),
    kinds: z.array(quizKindSchema).min(1).default(['mcq', 'truefalse']),
  })
  .refine((value) => value.documentId || value.text, {
    message: 'Provide a documentId or text to build the quiz from',
  });

export const quizIdSchema = z.object({ quizId: z.string().uuid() });

export const submitQuizInputSchema = z.object({
  quizId: z.string().uuid(),
  answers: z
    .array(
      z.object({
        questionId: z.string().uuid(),
        answer: z.string().max(2000),
      }),
    )
    .max(20),
  createCardsForMistakes: z.boolean().default(true),
});

export const quizResultSchema = z.object({
  score: z.number().min(0).max(1),
  correct: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  cardsCreated: z.number().int().nonnegative(),
  results: z.array(
    z.object({
      questionId: z.string().uuid(),
      prompt: z.string(),
      kind: quizKindSchema,
      yourAnswer: z.string(),
      correctAnswer: z.string(),
      correct: z.boolean(),
      explanation: z.string().nullable(),
      feedback: z.string().nullable(),
    }),
  ),
});
export type QuizResult = z.infer<typeof quizResultSchema>;

// ---------------------------------------------------------------------------
// Studio artifacts
// ---------------------------------------------------------------------------

export const artifactKindSchema = z.enum([
  'summary',
  'study_guide',
  'glossary',
  'mindmap',
]);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

export const artifactDTOSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  kind: artifactKindSchema,
  title: z.string(),
  contentMd: z.string(),
  sourceDocumentId: z.string().uuid().nullable(),
  createdAt: z.string(),
});
export type ArtifactDTO = z.infer<typeof artifactDTOSchema>;

export const generateArtifactInputSchema = z
  .object({
    workspaceId: z.string().uuid(),
    documentId: z.string().uuid().optional(),
    text: z.string().trim().min(20).max(8000).optional(),
    kind: artifactKindSchema,
  })
  .refine((value) => value.documentId || value.text, {
    message: 'Provide a documentId or text to build the artifact from',
  });

export const artifactIdSchema = z.object({
  artifactId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------

export const personaDTOSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  /** True for the persona selected by the stored default setting. */
  isDefault: z.boolean(),
});
export type PersonaDTO = z.infer<typeof personaDTOSchema>;

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

// ---------------------------------------------------------------------------
// Voice & audio (STT, TTS, pronunciation)
// ---------------------------------------------------------------------------

/** Which engine a speech capability uses: the browser API or the server. */
export const speechProviderSchema = z.enum(['browser', 'server']);
export type SpeechProvider = z.infer<typeof speechProviderSchema>;

export const ttsVoiceSchema = z.enum([
  'alloy',
  'echo',
  'fable',
  'onyx',
  'nova',
  'shimmer',
]);
export type TtsVoice = z.infer<typeof ttsVoiceSchema>;

export const TTS_VOICES: TtsVoice[] = [
  'alloy',
  'echo',
  'fable',
  'onyx',
  'nova',
  'shimmer',
];

export const audioKindSchema = z.enum(['tts', 'stt', 'pronunciation']);
export type AudioKind = z.infer<typeof audioKindSchema>;

/** Result of `POST /api/transcribe` (and the client's browser path). */
export const transcriptionResultSchema = z.object({
  text: z.string(),
  language: z.string().nullable(),
  provider: z.string(),
  durationMs: z.number().int().nonnegative().nullable(),
  /** Retained recording id, or null when retention is disabled. */
  audioId: z.string().uuid().nullable(),
});
export type TranscriptionResult = z.infer<typeof transcriptionResultSchema>;

export const ttsRequestSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  voice: ttsVoiceSchema.optional(),
  speed: z.number().min(0.5).max(2).optional(),
  format: z.enum(['mp3', 'wav']).optional(),
  workspaceId: z.string().uuid().optional(),
});
export type TtsRequest = z.infer<typeof ttsRequestSchema>;

/** Result of `POST /api/tts`: metadata plus a playable URL. */
export const ttsResultSchema = z.object({
  audioId: z.string().uuid(),
  url: z.string(),
  mimeType: z.string(),
  cached: z.boolean(),
  voice: ttsVoiceSchema,
  speed: z.number(),
  /** In-order sentences for karaoke highlighting (client times them). */
  sentences: z.array(z.string()),
});
export type TtsResult = z.infer<typeof ttsResultSchema>;

export const audioAssetDTOSchema = z.object({
  id: z.string().uuid(),
  kind: audioKindSchema,
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().nullable(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
});
export type AudioAssetDTO = z.infer<typeof audioAssetDTOSchema>;

export const correctionPolicySchema = z.enum(['immediate', 'recap', 'asked']);
export type CorrectionPolicy = z.infer<typeof correctionPolicySchema>;

/** Effective voice capabilities for the client (provider keys never leave). */
export const voiceConfigSchema = z.object({
  sttMode: speechProviderSchema,
  ttsProvider: speechProviderSchema,
  sttLanguage: z.string(),
  ttsVoice: ttsVoiceSchema,
  ttsSpeed: z.number(),
  targetLanguage: z.string(),
  nativeLanguage: z.string(),
  correctionPolicy: correctionPolicySchema,
  autoSend: z.boolean(),
  retentionDays: z.number().int(),
  maxStorageMb: z.number(),
  /** True when the server has a usable STT/TTS provider configured. */
  sttServerAvailable: z.boolean(),
  ttsServerAvailable: z.boolean(),
  voices: z.array(ttsVoiceSchema),
  languages: z.array(z.string()),
});
export type VoiceConfig = z.infer<typeof voiceConfigSchema>;

// --- Pronunciation ---------------------------------------------------------

export const pronunciationWordSchema = z.object({
  word: z.string(),
  /** The aligned word the recognizer heard, or null when omitted. */
  heard: z.string().nullable(),
  score: z.number().min(0).max(1),
  status: z.enum(['good', 'close', 'off', 'missing']),
});
export type PronunciationWord = z.infer<typeof pronunciationWordSchema>;

export const pronunciationScoreSchema = z.object({
  id: z.string().uuid(),
  target: z.string(),
  transcript: z.string(),
  overall: z.number().min(0).max(1),
  words: z.array(pronunciationWordSchema),
  language: z.string().nullable(),
  createdAt: z.string(),
});
export type PronunciationScore = z.infer<typeof pronunciationScoreSchema>;

export const scorePronunciationInputSchema = z.object({
  workspaceId: z.string().uuid(),
  target: z.string().trim().min(1).max(500),
  transcript: z.string().trim().min(1).max(2000),
  language: z.string().max(40).optional(),
  durationMs: z.number().int().nonnegative().optional(),
});
export type ScorePronunciationInput = z.infer<
  typeof scorePronunciationInputSchema
>;

export const minimalPairSchema = z.object({
  a: z.string(),
  b: z.string(),
  hint: z.string(),
});
export type MinimalPair = z.infer<typeof minimalPairSchema>;

// ---------------------------------------------------------------------------
// Language learning (vocabulary, CEFR, dictation)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Vision (image ingestion, image chat, art/diagram analysis)
// ---------------------------------------------------------------------------

export const visionModeSchema = z.enum([
  'general',
  'art',
  'diagram',
  'equation',
]);
export type VisionMode = z.infer<typeof visionModeSchema>;

export const VISION_MODES: { id: VisionMode; label: string; hint: string }[] = [
  {
    id: 'general',
    label: 'Describe',
    hint: 'What is in the image, its text, and how it relates to your material.',
  },
  {
    id: 'art',
    label: 'Art critique',
    hint: 'Composition, colour, technique, and art-historical context.',
  },
  {
    id: 'diagram',
    label: 'Diagram',
    hint: 'Components, labels, flows, and the relationships between them.',
  },
  {
    id: 'equation',
    label: 'Equations',
    hint: 'Transcribe formulas to LaTeX and explain each symbol.',
  },
];

/** Effective vision capabilities for the client (keys stay on the server). */
export const visionConfigSchema = z.object({
  /** The feature switch (settings: vision.enabled). */
  enabled: z.boolean(),
  /** True when a vision-capable provider is configured. */
  available: z.boolean(),
  /** Model used for image requests (empty means the chat model). */
  model: z.string(),
  ocrEnabled: z.boolean(),
  /** True when a tesseract binary (and rasterizer for PDFs) was detected. */
  ocrAvailable: z.boolean(),
  maxImageMb: z.number(),
  modes: z.array(visionModeSchema),
});
export type VisionConfig = z.infer<typeof visionConfigSchema>;

export const analyzeImageInputSchema = z.object({
  workspaceId: z.string().uuid(),
  documentId: z.string().uuid(),
  mode: visionModeSchema.default('general'),
  /** Optional extra instruction from the user. */
  question: z.string().trim().max(2000).optional(),
});
export type AnalyzeImageInput = z.infer<typeof analyzeImageInputSchema>;

export const analyzeImageResultSchema = z.object({
  documentId: z.string().uuid(),
  mode: visionModeSchema,
  analysis: z.string(),
  model: z.string(),
  /** Text OCR extracted (empty when OCR is disabled or unavailable). */
  ocrText: z.string(),
  cached: z.boolean(),
});
export type AnalyzeImageResult = z.infer<typeof analyzeImageResultSchema>;
