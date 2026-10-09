import { sql } from 'drizzle-orm';
import {
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
  uuid,
} from 'drizzle-orm/pg-core';

import type { RetrievalDebug, Source } from '@nexus/shared-types';

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
    fileType: text('file_type'),
    status: documentStatusEnum('status').notNull().default('processing'),
    chunkCount: integer('chunk_count').notNull().default(0),
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
