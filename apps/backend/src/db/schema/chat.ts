import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { RetrievalDebug, Source } from '@nexus/shared-types';
import { messageKindEnum, messageRoleEnum } from './enums.js';
import { workspaces } from './workspaces.js';

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
