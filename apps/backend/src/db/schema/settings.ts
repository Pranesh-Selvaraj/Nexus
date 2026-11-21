import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { ApiScope, WebhookEvent } from '@nexus/shared-types';
import { users } from './auth.js';
import { workspaces } from './workspaces.js';

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
// Sharing (L-13): read-only capability links for a workspace
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
