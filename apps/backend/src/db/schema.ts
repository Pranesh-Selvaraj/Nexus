import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type {
  ApiScope,
  DocumentStructure,
  WebhookEvent,
  RetrievalDebug,
  Source,
} from '@nexus/shared-types';

// ---------------------------------------------------------------------------
// Custom types
// ---------------------------------------------------------------------------

// pgvector type without a fixed dimension so local embedding models
// (768/1024/1536/2048 dims) all fit; the worker validates each vector
// against the `embedding.dimensions` setting before insert.
export const vectorDim = customType<{ data: number[]; driverData: string }>({
  dataType: () => 'vector',
  toDriver: (value) => JSON.stringify(value),
  fromDriver: (value) => JSON.parse(value),
});

// Full-text vector populated by the ingestion worker with
// `to_tsvector(<language>, content)`. Never bound from application code; the
// column exists so the GIN index below works for every configured language
// (an expression index on a fixed regconfig cannot serve other languages).
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => 'tsvector',
});

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const documentStatusEnum = pgEnum('document_status', [
  'processing',
  'ready',
  'failed',
  // Soft-deleted (trash): row + file kept until the purge window elapses,
  // chunks removed so retrieval cannot see it.
  'deleted',
]);

export const messageRoleEnum = pgEnum('message_role', ['user', 'assistant']);

export const messageKindEnum = pgEnum('message_kind', ['answer', 'error']);

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('workspaces_user_id_idx').on(table.userId)],
);

export const documents = pgTable(
  'documents',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    filePath: text('file_path').notNull(),
    // Detected format (magic bytes), not the client-supplied extension.
    fileType: text('file_type'),
    // sha256 of the uploaded bytes: duplicate detection within a workspace.
    contentHash: text('content_hash'),
    // Canonical URL for URL/YouTube ingestion (provenance + citations).
    sourceUrl: text('source_url'),
    // Structure extracted by the parser: format, TOC, OCR/vision flags.
    metadata: jsonb('metadata').$type<DocumentStructure | null>(),
    status: documentStatusEnum('status').notNull().default('processing'),
    chunkCount: integer('chunk_count').notNull().default(0),
    // Bytes of the stored file, for storage accounting and quotas. Existing
    // rows default to 0 until re-uploaded.
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    // Set when the document is moved to the trash; the maintenance job purges
    // it (row + file) once storage.trashDays has elapsed.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    // Populated when indexing fails: sanitized error + attempt count so the
    // UI can explain what happened instead of showing a bare 'failed' badge.
    errorMessage: text('error_message'),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('documents_workspace_id_idx').on(table.workspaceId)],
);

export interface ChunkMetadata {
  chunkIndex: number;
  page: number | null;
  pageEnd?: number | null;
  headingPath?: string[];
}

export const chunks = pgTable(
  'chunks',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    // Denormalised from the document: retrieval filters by workspace, and the
    // ANN scan can only use the HNSW index when the predicate is on `chunks`.
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    embedding: vectorDim('embedding').notNull(),
    metadata: jsonb('metadata').$type<ChunkMetadata>().notNull(),
    // Embedding provenance: which model/dimensions produced this vector.
    // Retrieval only compares vectors from the active model (legacy NULL rows
    // are matched by vector dimension instead) so switching models can never
    // mix vector spaces or crash pgvector with mismatched dimensions.
    embeddingModel: text('embedding_model'),
    embeddingDims: integer('embedding_dims'),
    embeddingVersion: integer('embedding_version'),
    contentHash: text('content_hash'),
    tokenCount: integer('token_count'),
    language: text('language'),
    contentFts: tsvector('content_fts'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('chunks_document_id_idx').on(table.documentId),
    index('chunks_workspace_id_idx').on(table.workspaceId),
    index('chunks_embedding_model_idx').on(table.embeddingModel),
    index('chunks_content_fts_idx').using('gin', table.contentFts),
  ],
);

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('conversations_workspace_id_idx').on(table.workspaceId)],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: messageRoleEnum('role').notNull(),
    // 'error' rows carry a friendly error string instead of an answer; they
    // render distinctly and are excluded from the model's chat history.
    kind: messageKindEnum('kind').notNull().default('answer'),
    content: text('content').notNull(),
    sources: jsonb('sources').$type<Source[] | null>(),
    // Images attached to a user turn (vision chat); assistant turns leave it
    // null. Persisted so a reloaded conversation still shows the image.
    attachments: jsonb('attachments').$type<{
      imageDocumentIds: string[];
    } | null>(),
    usage: jsonb('usage').$type<{
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    } | null>(),
    /** Thumbs up/down on an assistant answer (feedback loop for retrieval). */
    feedback: text('feedback').$type<'up' | 'down' | null>(),
    /** Retrieval debug payload for the inspector (candidates, scores, query). */
    retrievalDebug: jsonb('retrieval_debug').$type<RetrievalDebug | null>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('messages_conversation_id_idx').on(table.conversationId)],
);

// ---------------------------------------------------------------------------
// Study loop: decks, flashcards (FSRS), reviews, notes/highlights, progress
// ---------------------------------------------------------------------------

export const decks = pgTable(
  'decks',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('decks_workspace_id_idx').on(table.workspaceId)],
);

export const flashcards = pgTable(
  'flashcards',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    deckId: uuid('deck_id')
      .notNull()
      .references(() => decks.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().default('qa'),
    front: text('front').notNull(),
    back: text('back').notNull(),
    sourceChunkId: uuid('source_chunk_id').references(() => chunks.id, {
      onDelete: 'set null',
    }),
    sourceMessageId: uuid('source_message_id').references(() => messages.id, {
      onDelete: 'set null',
    }),
    // FSRS scheduling state (ts-fsrs Card fields)
    dueAt: timestamp('due_at', { withTimezone: true }).notNull().defaultNow(),
    stability: real('stability').notNull().default(0),
    difficulty: real('difficulty').notNull().default(0),
    elapsedDays: integer('elapsed_days').notNull().default(0),
    scheduledDays: integer('scheduled_days').notNull().default(0),
    // FSRS learning-step counter; required for a card to graduate from the
    // learning state to review.
    learningSteps: integer('learning_steps').notNull().default(0),
    reps: integer('reps').notNull().default(0),
    lapses: integer('lapses').notNull().default(0),
    state: integer('state').notNull().default(0),
    lastReviewAt: timestamp('last_review_at', { withTimezone: true }),
    suspended: boolean('suspended').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('flashcards_deck_id_idx').on(table.deckId),
    index('flashcards_due_at_idx').on(table.dueAt),
  ],
);

export const cardReviews = pgTable(
  'card_reviews',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    cardId: uuid('card_id')
      .notNull()
      .references(() => flashcards.id, { onDelete: 'cascade' }),
    rating: integer('rating').notNull(),
    durationMs: integer('duration_ms'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('card_reviews_card_id_idx').on(table.cardId)],
);

export const highlights = pgTable(
  'highlights',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').references(() => documents.id, {
      onDelete: 'set null',
    }),
    messageId: uuid('message_id').references(() => messages.id, {
      onDelete: 'set null',
    }),
    chunkId: uuid('chunk_id').references(() => chunks.id, {
      onDelete: 'set null',
    }),
    quotedText: text('quoted_text').notNull(),
    note: text('note'),
    color: text('color').notNull().default('yellow'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('highlights_workspace_id_idx').on(table.workspaceId)],
);

export const notes = pgTable(
  'notes',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    contentMd: text('content_md').notNull().default(''),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('notes_workspace_id_idx').on(table.workspaceId)],
);

export const progressEvents = pgTable(
  'progress_events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, {
      onDelete: 'cascade',
    }),
    kind: text('kind').notNull(),
    subject: text('subject'),
    correct: boolean('correct'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('progress_events_user_created_idx').on(table.userId, table.createdAt),
  ],
);

export const quizzes = pgTable(
  'quizzes',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('quizzes_workspace_id_idx').on(table.workspaceId)],
);

export const quizQuestions = pgTable(
  'quiz_questions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    quizId: uuid('quiz_id')
      .notNull()
      .references(() => quizzes.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    kind: text('kind').notNull(),
    prompt: text('prompt').notNull(),
    options: jsonb('options').$type<string[] | null>(),
    answer: jsonb('answer').$type<string | boolean | null>(),
    explanation: text('explanation'),
    sourceChunkId: uuid('source_chunk_id').references(() => chunks.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('quiz_questions_quiz_id_idx').on(table.quizId)],
);

export const quizAttempts = pgTable(
  'quiz_attempts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    quizId: uuid('quiz_id')
      .notNull()
      .references(() => quizzes.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    answers: jsonb('answers').$type<unknown>(),
    score: real('score').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('quiz_attempts_quiz_id_idx').on(table.quizId)],
);

export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    contentMd: text('content_md').notNull(),
    sourceDocumentId: uuid('source_document_id').references(
      () => documents.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('artifacts_workspace_id_idx').on(table.workspaceId)],
);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  // For secret settings this holds the AES-256-GCM ciphertext
  // (see services/settings.service.ts); plaintext otherwise.
  value: text('value').notNull(),
  isSecret: boolean('is_secret').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // sha256 hex of the bearer token - the raw token is only ever sent to
    // the browser as an httpOnly cookie
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
);

// ---------------------------------------------------------------------------
// Public API access (P-5): scoped API keys for the REST v1 surface
// ---------------------------------------------------------------------------

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Displayable head of the key: lets the UI list keys without ever storing
    // the secret. Also the lookup key when authenticating.
    prefix: text('prefix').notNull(),
    // sha256 hex of the full key. The raw key is shown exactly once.
    keyHash: text('key_hash').notNull().unique(),
    // Additive permission set checked per REST route.
    scopes: text('scopes').array().notNull().$type<ApiScope[]>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Updated at most once per minute so authentication stays cheap.
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    // Soft revocation: the row and its audit trail stay.
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    index('api_keys_user_id_idx').on(table.userId),
    uniqueIndex('api_keys_prefix_idx').on(table.prefix),
  ],
);

// ---------------------------------------------------------------------------
// Webhooks (P-5): user-configured endpoints notified when indexing finishes
// ---------------------------------------------------------------------------

export const webhooks = pgTable(
  'webhooks',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Null = every workspace the user owns.
    workspaceId: uuid('workspace_id').references(() => workspaces.id, {
      onDelete: 'cascade',
    }),
    url: text('url').notNull(),
    // AES-256-GCM ciphertext of the HMAC secret (SETTINGS_SECRET). Returned
    // once at creation; deliveries sign with the decrypted value.
    secret: text('secret').notNull(),
    events: text('events').array().notNull().$type<WebhookEvent[]>(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Last delivery attempt, for the settings list ("failing" is visible).
    lastDeliveryAt: timestamp('last_delivery_at', { withTimezone: true }),
    lastStatus: integer('last_status'),
    lastError: text('last_error'),
  },
  (table) => [index('webhooks_user_id_idx').on(table.userId)],
);

// ---------------------------------------------------------------------------
// Voice & language: audio assets (cache + retention), vocabulary, CEFR,
// pronunciation attempts
// ---------------------------------------------------------------------------

export const audioAssets = pgTable(
  'audio_assets',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, {
      onDelete: 'set null',
    }),
    kind: text('kind').notNull(),
    // Content address for the TTS cache: sha256(owner|model|voice|speed|format|text).
    // The owner is part of the key because playback is owner-scoped, so a
    // shared key would hand one user another user's audio. Null for retained
    // recordings, which are never reused.
    cacheKey: text('cache_key').unique(),
    voice: text('voice'),
    speed: real('speed'),
    mimeType: text('mime_type').notNull(),
    format: text('format').notNull().default('mp3'),
    sizeBytes: integer('size_bytes').notNull().default(0),
    durationMs: integer('duration_ms'),
    // Relative to the uploads directory; never contains user input.
    filePath: text('file_path').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Retention deadline; null means keep until the quota forces eviction.
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => [
    index('audio_assets_user_id_idx').on(table.userId),
    index('audio_assets_expires_at_idx').on(table.expiresAt),
  ],
);

export const vocabularyItems = pgTable(
  'vocabulary_items',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    term: text('term').notNull(),
    /** Normalized lookup key (lowercased, accent-stripped). */
    lemma: text('lemma').notNull(),
    language: text('language').notNull().default(''),
    translation: text('translation'),
    partOfSpeech: text('part_of_speech'),
    example: text('example'),
    frequencyRank: integer('frequency_rank'),
    state: text('state').notNull().default('learning'),
    /** SRS card created for this term, when createCards was enabled. */
    cardId: uuid('card_id').references(() => flashcards.id, {
      onDelete: 'set null',
    }),
    sourceChunkId: uuid('source_chunk_id').references(() => chunks.id, {
      onDelete: 'set null',
    }),
    sourceMessageId: uuid('source_message_id').references(() => messages.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('vocabulary_items_workspace_id_idx').on(table.workspaceId),
    // One entry per term per language per workspace; also serves the
    // (workspace, lemma, language) lookup mining uses to skip duplicates.
    uniqueIndex('vocabulary_items_workspace_lemma_language_idx').on(
      table.workspaceId,
      table.lemma,
      table.language,
    ),
  ],
);

export const cefrEstimates = pgTable(
  'cefr_estimates',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    skill: text('skill').notNull(),
    level: text('level').notNull(),
    score: real('score').notNull().default(0),
    evidence: integer('evidence').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('cefr_estimates_workspace_id_idx').on(table.workspaceId),
    uniqueIndex('cefr_estimates_workspace_skill_idx').on(
      table.workspaceId,
      table.skill,
    ),
  ],
);

export const pronunciationAttempts = pgTable(
  'pronunciation_attempts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, {
      onDelete: 'cascade',
    }),
    target: text('target').notNull(),
    transcript: text('transcript').notNull(),
    overall: real('overall').notNull(),
    words: jsonb('words').$type<
      Array<{
        word: string;
        heard: string | null;
        score: number;
        status: 'good' | 'close' | 'off' | 'missing';
      }>
    >(),
    language: text('language'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('pronunciation_attempts_user_id_idx').on(table.userId),
    index('pronunciation_attempts_workspace_id_idx').on(table.workspaceId),
  ],
);

// ---------------------------------------------------------------------------
// Inferred row types
// ---------------------------------------------------------------------------

export type User = typeof users.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type Chunk = typeof chunks.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Deck = typeof decks.$inferSelect;
export type Flashcard = typeof flashcards.$inferSelect;
export type CardReview = typeof cardReviews.$inferSelect;
export type Highlight = typeof highlights.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type ProgressEvent = typeof progressEvents.$inferSelect;
export type Quiz = typeof quizzes.$inferSelect;
export type QuizQuestion = typeof quizQuestions.$inferSelect;
export type QuizAttempt = typeof quizAttempts.$inferSelect;
export type Artifact = typeof artifacts.$inferSelect;
export type AudioAsset = typeof audioAssets.$inferSelect;
export type VocabularyItem = typeof vocabularyItems.$inferSelect;
export type CefrEstimate = typeof cefrEstimates.$inferSelect;
export type PronunciationAttempt = typeof pronunciationAttempts.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
