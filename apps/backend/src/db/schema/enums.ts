import { pgEnum } from 'drizzle-orm/pg-core';

export const documentStatusEnum = pgEnum('document_status', [
  'processing',
  'ready',
  'failed',
  // Soft-deleted (trash): row + file kept until the purge window elapses,
  // chunks removed so retrieval cannot see it.
  'deleted',
]);

export const messageRoleEnum = pgEnum('message_role', ['user', 'assistant']);

/** Workspace roles (L-13): reader can learn, editor can change content, owner administers. */

export const workspaceRoleEnum = pgEnum('workspace_role', [
  'owner',
  'editor',
  'reader',
]);

export const messageKindEnum = pgEnum('message_kind', ['answer', 'error']);

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------
