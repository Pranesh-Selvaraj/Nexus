import { and, eq } from 'drizzle-orm';

import type {
  AddWorkspaceMemberInput,
  WorkspaceMemberDTO,
  WorkspaceRole,
} from '@nexus/shared-types';

import { db } from '../db/index.js';
import { users, workspaceMembers, workspaces } from '../db/schema.js';
import { ApiError } from '../utils/errors.js';
import { assertWorkspaceAccess } from './access.service.js';

/** Make the creator an explicit owner membership (idempotent). */
export async function ensureOwnerMembership(
  workspaceId: string,
  userId: string,
): Promise<void> {
  await db
    .insert(workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing({
      target: [workspaceMembers.workspaceId, workspaceMembers.userId],
    });
}

export async function listMembers(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceMemberDTO[]> {
  await assertWorkspaceAccess(userId, workspaceId);
  const [workspace] = await db
    .select({ ownerId: workspaces.userId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  const rows = await db
    .select({
      userId: workspaceMembers.userId,
      role: workspaceMembers.role,
      createdAt: workspaceMembers.createdAt,
      email: users.email,
      name: users.name,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId));
  const members: WorkspaceMemberDTO[] = rows.map((row) => ({
    userId: row.userId,
    email: row.email,
    name: row.name,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
  }));
  // The creator is always an owner, even if a legacy row lacks the membership.
  if (
    workspace &&
    !members.some((member) => member.userId === workspace.ownerId)
  ) {
    const [owner] = await db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, workspace.ownerId))
      .limit(1);
    if (owner) {
      members.unshift({
        userId: workspace.ownerId,
        email: owner.email,
        name: owner.name,
        role: 'owner',
        createdAt: new Date(0).toISOString(),
      });
    }
  }
  return members;
}

export async function addMember(
  actorId: string,
  input: AddWorkspaceMemberInput,
): Promise<WorkspaceMemberDTO> {
  await assertWorkspaceAccess(actorId, input.workspaceId, 'owner');
  const email = input.email.trim().toLowerCase();
  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!user) {
    throw new ApiError(
      'No account uses that email yet. Ask them to create an account first, then add them.',
      404,
    );
  }
  const [workspace] = await db
    .select({ ownerId: workspaces.userId })
    .from(workspaces)
    .where(eq(workspaces.id, input.workspaceId))
    .limit(1);
  if (workspace?.ownerId === user.id) {
    throw new ApiError('That user already owns this workspace', 400);
  }
  const [row] = await db
    .insert(workspaceMembers)
    .values({
      workspaceId: input.workspaceId,
      userId: user.id,
      role: input.role,
    })
    .onConflictDoUpdate({
      target: [workspaceMembers.workspaceId, workspaceMembers.userId],
      set: { role: input.role },
    })
    .returning();
  if (!row) throw new ApiError('Could not add the member', 500);
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function updateMemberRole(
  actorId: string,
  workspaceId: string,
  memberId: string,
  role: WorkspaceRole,
): Promise<{ updated: boolean }> {
  await assertWorkspaceAccess(actorId, workspaceId, 'owner');
  const [workspace] = await db
    .select({ ownerId: workspaces.userId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (workspace?.ownerId === memberId) {
    throw new ApiError('The workspace creator always stays an owner', 400);
  }
  const updated = await db
    .update(workspaceMembers)
    .set({ role })
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, memberId),
      ),
    )
    .returning({ userId: workspaceMembers.userId });
  if (updated.length === 0) throw new ApiError('Member not found', 404);
  return { updated: true };
}

export async function removeMember(
  actorId: string,
  workspaceId: string,
  memberId: string,
): Promise<{ removed: boolean }> {
  await assertWorkspaceAccess(actorId, workspaceId, 'owner');
  const [workspace] = await db
    .select({ ownerId: workspaces.userId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (workspace?.ownerId === memberId) {
    throw new ApiError('The workspace creator cannot be removed', 400);
  }
  const removed = await db
    .delete(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, memberId),
      ),
    )
    .returning({ userId: workspaceMembers.userId });
  if (removed.length === 0) throw new ApiError('Member not found', 404);
  return { removed: true };
}
