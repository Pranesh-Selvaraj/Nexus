import { createHash, randomBytes } from 'node:crypto';

import { and, desc, eq, isNull, or, gt } from 'drizzle-orm';

import type { DocumentDTO } from '@nexus/shared-types';

import { db } from '../db/index.js';
import { documents, workspaceShareLinks, workspaces } from '../db/schema.js';
import { ApiError } from '../utils/errors.js';
import { toDocumentDTO } from '../utils/dto.js';

/** Capability tokens are recognisable and long enough to be unguessable. */
const TOKEN_PATTERN = /^nxs_[A-Za-z0-9_-]{32,}$/;
const TOKEN_BYTES = 32;

export interface ShareLinkDTO {
  id: string;
  label: string | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  /** Convenience flag for the management list. */
  active: boolean;
}

export interface CreatedShareLink extends ShareLinkDTO {
  /** Full URL including the token. Returned exactly once. */
  url: string;
}

export interface SharedWorkspace {
  workspaceId: string;
  name: string;
  description: string | null;
  createdAt: string;
  documents: DocumentDTO[];
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toDTO(row: typeof workspaceShareLinks.$inferSelect): ShareLinkDTO {
  const active =
    !row.revokedAt && (!row.expiresAt || row.expiresAt.getTime() > Date.now());
  return {
    id: row.id,
    label: row.label,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    active,
  };
}

async function assertOwnedWorkspace(
  userId: string,
  workspaceId: string,
): Promise<void> {
  const [workspace] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.userId, userId)))
    .limit(1);
  if (!workspace) throw new ApiError('Workspace not found', 404);
}

/**
 * Create a read-only capability link. Only the sha256 of the token is stored,
 * so a database dump cannot be replayed; the URL is returned once.
 */
export async function createShareLink(
  userId: string,
  params: {
    workspaceId: string;
    label?: string;
    expiresInDays?: number | null;
  },
): Promise<CreatedShareLink> {
  await assertOwnedWorkspace(userId, params.workspaceId);
  const token = `nxs_${randomBytes(TOKEN_BYTES).toString('base64url')}`;
  const expiresAt =
    params.expiresInDays && params.expiresInDays > 0
      ? new Date(Date.now() + params.expiresInDays * 24 * 60 * 60 * 1000)
      : null;
  const [row] = await db
    .insert(workspaceShareLinks)
    .values({
      workspaceId: params.workspaceId,
      createdBy: userId,
      label: params.label?.trim() || null,
      tokenHash: hashToken(token),
      expiresAt,
    })
    .returning();
  if (!row) throw new ApiError('Could not create the share link', 500);
  return {
    ...toDTO(row),
    url: `${publicBaseUrl()}/share/${token}`,
  };
}

function publicBaseUrl(): string {
  const configured = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '');
  return (
    configured ||
    process.env.FRONTEND_ORIGIN?.split(',')[0]?.replace(/\/$/, '') ||
    'http://localhost:5173'
  );
}

export async function listShareLinks(
  userId: string,
  workspaceId: string,
): Promise<ShareLinkDTO[]> {
  await assertOwnedWorkspace(userId, workspaceId);
  const rows = await db
    .select()
    .from(workspaceShareLinks)
    .where(
      and(
        eq(workspaceShareLinks.workspaceId, workspaceId),
        eq(workspaceShareLinks.createdBy, userId),
      ),
    )
    .orderBy(desc(workspaceShareLinks.createdAt));
  return rows.map(toDTO);
}

export async function revokeShareLink(
  userId: string,
  id: string,
): Promise<{ revoked: boolean }> {
  const updated = await db
    .update(workspaceShareLinks)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(workspaceShareLinks.id, id),
        eq(workspaceShareLinks.createdBy, userId),
        isNull(workspaceShareLinks.revokedAt),
      ),
    )
    .returning({ id: workspaceShareLinks.id });
  return { revoked: updated.length > 0 };
}

export interface ResolvedShare {
  linkId: string;
  workspaceId: string;
  ownerId: string;
  name: string;
  description: string | null;
  createdAt: Date;
}

/**
 * Resolve a capability token to its workspace. Revoked and expired links are
 * indistinguishable from unknown ones (404 at the route).
 */
export async function resolveShareToken(
  token: string,
): Promise<ResolvedShare | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const [row] = await db
    .select({
      linkId: workspaceShareLinks.id,
      workspaceId: workspaceShareLinks.workspaceId,
      ownerId: workspaces.userId,
      name: workspaces.name,
      description: workspaces.description,
      createdAt: workspaces.createdAt,
    })
    .from(workspaceShareLinks)
    .innerJoin(workspaces, eq(workspaces.id, workspaceShareLinks.workspaceId))
    .where(
      and(
        eq(workspaceShareLinks.tokenHash, hashToken(token)),
        isNull(workspaceShareLinks.revokedAt),
        or(
          isNull(workspaceShareLinks.expiresAt),
          gt(workspaceShareLinks.expiresAt, new Date()),
        ),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Read-only view of a shared workspace: metadata plus visible documents. */
export async function sharedWorkspaceView(
  share: ResolvedShare,
): Promise<SharedWorkspace> {
  const rows = await db
    .select()
    .from(documents)
    .where(eq(documents.workspaceId, share.workspaceId))
    .orderBy(desc(documents.createdAt));
  const visible = rows.filter((doc) => doc.status !== 'deleted');
  return {
    workspaceId: share.workspaceId,
    name: share.name,
    description: share.description,
    createdAt: share.createdAt.toISOString(),
    documents: visible.map((doc) => toDocumentDTO(doc)),
  };
}
