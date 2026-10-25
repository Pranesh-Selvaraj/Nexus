import { rm } from 'node:fs/promises';
import path from 'node:path';

import { and, eq, lt, sql } from 'drizzle-orm';

import { db } from '../db/index.js';
import { documents, workspaces } from '../db/schema.js';
import { ApiError } from '../utils/errors.js';
import { UPLOAD_DIR } from '../utils/paths.js';
import { getSettingNumber } from './settings.service.js';

export interface WorkspaceUsage {
  workspaceId: string;
  name: string;
  bytes: number;
  documentCount: number;
  trashedCount: number;
}

export interface StorageUsage {
  usedBytes: number;
  quotaBytes: number;
  documentCount: number;
  trashedCount: number;
  trashDays: number;
  byWorkspace: WorkspaceUsage[];
}

/** Quota in bytes from the `storage.quotaMb` setting. */
export async function storageQuotaBytes(): Promise<number> {
  const quotaMb = await getSettingNumber('storage.quotaMb');
  return Math.max(0, quotaMb) * 1024 * 1024;
}

/** Bytes stored for one user, counting trashed documents (they still occupy disk). */
export async function storageUsedBytes(userId: string): Promise<number> {
  const [row] = await db
    .select({
      used: sql<number>`coalesce(sum("documents"."size_bytes"), 0)::bigint`,
    })
    .from(documents)
    .innerJoin(workspaces, eq(workspaces.id, documents.workspaceId))
    .where(eq(workspaces.userId, userId));
  return Number(row?.used ?? 0);
}

/**
 * Refuse an upload that would exceed the storage quota. Trashed documents are
 * still counted: they occupy disk until the purge window elapses.
 */
export async function assertStorageQuota(
  userId: string,
  incomingBytes: number,
): Promise<void> {
  const quota = await storageQuotaBytes();
  if (quota <= 0) return; // 0 disables the limit
  const used = await storageUsedBytes(userId);
  if (used + incomingBytes > quota) {
    const usedMb = Math.round((used / 1024 / 1024) * 10) / 10;
    const quotaMb = Math.round(quota / 1024 / 1024);
    throw new ApiError(
      `Storage quota exceeded: ${usedMb} MB used of ${quotaMb} MB. Delete documents or raise storage.quotaMb in Settings.`,
      413,
    );
  }
}

export async function storageUsage(userId: string): Promise<StorageUsage> {
  const rows = await db
    .select({
      workspaceId: workspaces.id,
      name: workspaces.name,
      bytes: sql<number>`coalesce(sum("documents"."size_bytes"), 0)::bigint`,
      documentCount: sql<number>`count(*)::int`,
      trashedCount: sql<number>`count(*) FILTER (WHERE "documents"."status" = 'deleted')::int`,
    })
    .from(workspaces)
    .leftJoin(documents, eq(documents.workspaceId, workspaces.id))
    .where(eq(workspaces.userId, userId))
    .groupBy(workspaces.id, workspaces.name)
    .orderBy(sql`coalesce(sum("documents"."size_bytes"), 0) DESC`);

  const byWorkspace: WorkspaceUsage[] = rows.map((row) => ({
    workspaceId: row.workspaceId,
    name: row.name,
    bytes: Number(row.bytes),
    documentCount: Number(row.documentCount),
    trashedCount: Number(row.trashedCount),
  }));

  return {
    usedBytes: byWorkspace.reduce((sum, row) => sum + row.bytes, 0),
    quotaBytes: await storageQuotaBytes(),
    documentCount: byWorkspace.reduce((sum, row) => sum + row.documentCount, 0),
    trashedCount: byWorkspace.reduce((sum, row) => sum + row.trashedCount, 0),
    trashDays: await getSettingNumber('storage.trashDays'),
    byWorkspace,
  };
}

/**
 * Delete a document permanently: row (chunks cascade) and stored file. Returns
 * false when it was already gone.
 */
export async function purgeDocument(documentId: string): Promise<boolean> {
  const [doc] = await db
    .select({ filePath: documents.filePath })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  if (!doc) return false;
  await db.delete(documents).where(eq(documents.id, documentId));
  await rm(path.resolve(UPLOAD_DIR, doc.filePath), { force: true }).catch(
    () => undefined,
  );
  return true;
}

/**
 * Purge trashed documents whose purge window elapsed. Files are removed after
 * the row so a failed unlink leaves no dangling row pointing at missing data.
 */
export async function purgeExpiredTrash(
  now: Date = new Date(),
): Promise<number> {
  const trashDays = await getSettingNumber('storage.trashDays');
  if (trashDays <= 0) return 0;
  const cutoff = new Date(now.getTime() - trashDays * 24 * 60 * 60 * 1000);
  const expired = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(eq(documents.status, 'deleted'), lt(documents.deletedAt, cutoff)),
    );
  let purged = 0;
  for (const row of expired) {
    if (await purgeDocument(row.id)) purged++;
  }
  return purged;
}
