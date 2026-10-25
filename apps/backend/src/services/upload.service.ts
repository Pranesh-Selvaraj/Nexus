import { mkdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { and, eq, ne } from 'drizzle-orm';

import type { DocumentDTO } from '@nexus/shared-types';
import { workspaceIdSchema } from '@nexus/shared-types';

import { db } from '../db/index.js';
import { documents, workspaces } from '../db/schema.js';
import { enqueueDocumentEmbedding } from '../queues/index.js';
import { toDocumentDTO } from '../utils/dto.js';
import { ApiError } from '../utils/errors.js';
import { UPLOAD_DIR } from '../utils/paths.js';
import { getSettingNumber } from './settings.service.js';
import { assertStorageQuota } from './storage.service.js';
import { UploadRejectedError, validateUpload } from './ingestion/validate.js';

export interface UploadFileInput {
  buffer: Buffer;
  /** Client-supplied name: metadata only, never used to build a path. */
  originalname: string;
}

export interface UploadResult {
  document: DocumentDTO;
  /** True when the same bytes already existed in this workspace. */
  duplicate: boolean;
}

/**
 * The one upload path: validate the workspace id, prove ownership, admit the
 * bytes by magic bytes (with zip/vision limits), short-circuit duplicates by
 * content hash, write under a server-generated path, insert the row and queue
 * indexing. Shared by the session `/api/upload` route and `POST /api/v1/documents`
 * so the API cannot drift from the UI.
 */
export async function ingestUpload(params: {
  workspaceId: unknown;
  userId: string;
  file: UploadFileInput | undefined;
}): Promise<UploadResult> {
  // Validate the UUID before touching the filesystem: raw input must never
  // reach path construction (CWE-22).
  const parsed = workspaceIdSchema.safeParse({
    workspaceId: String(params.workspaceId ?? ''),
  });
  if (!parsed.success) {
    throw new ApiError('Invalid workspaceId: expected a UUID', 400);
  }
  const workspaceId = parsed.data.workspaceId;

  const [workspace] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(
      and(eq(workspaces.id, workspaceId), eq(workspaces.userId, params.userId)),
    )
    .limit(1);
  if (!workspace) {
    throw new ApiError('Workspace not found', 404);
  }

  if (!params.file) {
    throw new ApiError('No file provided', 400);
  }

  // Quota is checked before the file is written: the whole upload is in
  // memory, so its exact size is known.
  await assertStorageQuota(params.userId, params.file.buffer.length);

  const maxImageMb = await getSettingNumber('vision.maxImageMb');
  let validated;
  try {
    validated = await validateUpload(
      params.file.buffer,
      params.file.originalname,
      { maxImageMb },
    );
  } catch (err) {
    if (err instanceof UploadRejectedError) {
      throw new ApiError(err.message, 400);
    }
    throw err;
  }

  // Same bytes, same workspace: return the existing document instead of
  // indexing it twice. A previously failed document does not block a retry.
  const [existing] = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.workspaceId, workspace.id),
        eq(documents.contentHash, validated.contentHash),
        ne(documents.status, 'failed'),
      ),
    )
    .limit(1);
  if (existing) {
    return { document: toDocumentDTO(existing), duplicate: true };
  }

  const workspaceDir = path.join(UPLOAD_DIR, workspace.id);
  await mkdir(workspaceDir, { recursive: true });
  const finalPath = path.join(workspaceDir, randomUUID());
  await writeFile(finalPath, params.file.buffer);

  const relativePath = path
    .relative(UPLOAD_DIR, finalPath)
    .split(path.sep)
    .join('/');

  let created: typeof documents.$inferSelect | undefined;
  try {
    [created] = await db
      .insert(documents)
      .values({
        workspaceId: workspace.id,
        title: path.basename(params.file.originalname).slice(0, 200),
        filePath: relativePath,
        fileType: validated.detected.format,
        contentHash: validated.contentHash,
        sizeBytes: params.file.buffer.length,
        status: 'processing',
      })
      .returning();
    if (!created) throw new Error('Failed to create document record');

    try {
      await enqueueDocumentEmbedding(created.id);
    } catch (enqueueError) {
      // No queue -> no processing -> roll back the row as well as the file.
      await db
        .delete(documents)
        .where(eq(documents.id, created.id))
        .catch(() => undefined);
      throw enqueueError;
    }
  } catch (err) {
    await rm(finalPath, { force: true }).catch(() => undefined);
    throw err;
  }

  return { document: toDocumentDTO(created), duplicate: false };
}
