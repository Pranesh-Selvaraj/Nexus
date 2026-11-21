import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { conversations, messages } from './chat.js';
import { chunks, documents, highlights } from './documents.js';
import { apiKeys, webhooks } from './settings.js';
import {
  artifacts,
  cardReviews,
  decks,
  flashcards,
  notes,
  progressEvents,
  quizAttempts,
  quizQuestions,
  quizzes,
} from './study.js';
import { audioAssets } from './voice.js';
import {
  workspaceMembers,
  workspaceShareLinks,
  workspaces,
} from './workspaces.js';

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
export type WorkspaceShareLink = typeof workspaceShareLinks.$inferSelect;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
