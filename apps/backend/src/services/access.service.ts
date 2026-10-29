import { sql } from 'drizzle-orm';

import type { WorkspaceRole } from '@nexus/shared-types';

import { db } from '../db/index.js';
import { workspaces } from '../db/schema.js';
import { ApiError } from '../utils/errors.js';

export const ROLE_RANK: Record<WorkspaceRole, number> = {
  reader: 1,
  editor: 2,
  owner: 3,
};

/**
 * SQL predicate matching a workspace the user can access: they created it or
 * they are a member. Use it in joins so a resource lookup (deck, note, quiz,
 * conversation) cannot escape the workspace.
 */
export function workspaceAccessPredicate(userId: string) {
  return sql`(${workspaces.userId} = ${userId} OR EXISTS (
    SELECT 1 FROM workspace_members m
    WHERE m.workspace_id = ${workspaces.id} AND m.user_id = ${userId}
  ))`;
}

/** The caller's effective role, or null when they have no access. */
export async function workspaceRoleFor(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceRole | null> {
  const result = await db.execute(
    sql`
      SELECT w.user_id AS owner_id,
        (SELECT m.role FROM workspace_members m
         WHERE m.workspace_id = w.id AND m.user_id = ${userId}) AS member_role
      FROM workspaces w
      WHERE w.id = ${workspaceId}
    `,
  );
  const row = (
    result as unknown as {
      rows: Array<{ owner_id: string; member_role: WorkspaceRole | null }>;
    }
  ).rows[0];
  if (!row) return null;
  if (row.owner_id === userId) return 'owner';
  return row.member_role ?? null;
}

/**
 * Require at least `minRole` on a workspace. Missing workspaces and missing
 * memberships are both a 404 so a caller cannot probe workspace ids; an
 * existing membership with too few permissions is a 403.
 */
export async function assertWorkspaceAccess(
  userId: string,
  workspaceId: string,
  minRole: WorkspaceRole = 'reader',
): Promise<WorkspaceRole> {
  const role = await workspaceRoleFor(userId, workspaceId);
  if (!role) throw new ApiError('Workspace not found', 404);
  if (ROLE_RANK[role] < ROLE_RANK[minRole]) {
    throw new ApiError(
      `This action needs the ${minRole} role in this workspace`,
      403,
    );
  }
  return role;
}

export function canEdit(role: WorkspaceRole | undefined): boolean {
  return role === 'owner' || role === 'editor';
}

export function isOwner(role: WorkspaceRole | undefined): boolean {
  return role === 'owner';
}
