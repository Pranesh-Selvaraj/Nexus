import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { workspaces } from './workspaces.js';

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
