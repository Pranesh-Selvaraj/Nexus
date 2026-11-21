import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { WorkspaceMetadata } from '@nexus/shared-types';
import { users } from './auth.js';
import { workspaceRoleEnum } from './enums.js';

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
    // Presentation/onboarding metadata: installed domain pack, icon, plan and
    // starter prompts. Null for ordinary topics.
    metadata: jsonb('metadata').$type<WorkspaceMetadata | null>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('workspaces_user_id_idx').on(table.userId)],
);

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: workspaceRoleEnum('role').notNull().default('reader'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index('workspace_members_user_id_idx').on(table.userId),
  ],
);

export const workspaceShareLinks = pgTable(
  'workspace_share_links',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text('label'),
    // sha256 of the capability token; the token itself is shown once.
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('workspace_share_links_workspace_id_idx').on(table.workspaceId),
  ],
);

// ---------------------------------------------------------------------------
// Webhooks (P-5): user-configured endpoints notified when indexing finishes
// ---------------------------------------------------------------------------
