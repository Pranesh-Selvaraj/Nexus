import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { messages } from './chat.js';
import { chunks, documents } from './documents.js';
import { workspaces } from './workspaces.js';

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
