import { createHash, randomUUID } from 'node:crypto';

import { and, eq, ne } from 'drizzle-orm';

import type { IngestUrlResult } from '@nexus/shared-types';

import { db } from '../db/index.js';
import { assertWorkspaceAccess } from './access.service.js';
import { documents, workspaces } from '../db/schema.js';
import { enqueueDocumentEmbedding } from '../queues/index.js';
import { toDocumentDTO } from '../utils/dto.js';
import { ApiError } from '../utils/errors.js';
import { storage } from './storage/index.js';
import { assertStorageQuota } from './storage.service.js';
import {
  ingestUrlContent,
  type UrlIngestResult as UrlContent,
} from './ingestion/url-ingest.js';
import { UnsafeUrlError } from './ingestion/url-fetch.js';

export interface UrlIngestResult extends IngestUrlResult {
  /** True when the extracted text already existed in this workspace. */
  duplicate?: boolean;
}

/**
 * Import a web article or YouTube transcript into a workspace: the fetch is
 * SSRF-guarded and size-capped, the extracted Markdown is written as a normal
 * upload with provenance metadata, and indexing happens offline like any other
 * document. Shared by the session route and `POST /api/v1/urls`.
 */
export async function ingestUrlForWorkspace(params: {
  userId: string;
  workspaceId: string;
  url: string;
}): Promise<UrlIngestResult> {
  await assertWorkspaceAccess(params.userId, params.workspaceId, 'editor');
  const [workspace] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, params.workspaceId))
    .limit(1);
  if (!workspace) throw new ApiError('Workspace not found', 404);

  let content: UrlContent;
  try {
    content = await ingestUrlContent(params.url);
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw new ApiError(err.message, 400);
    throw err;
  }

  const sizeBytes = Buffer.byteLength(content.markdown, 'utf8');
  await assertStorageQuota(params.userId, sizeBytes);

  const contentHash = createHash('sha256')
    .update(content.markdown)
    .digest('hex');
  const [existing] = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.workspaceId, workspace.id),
        eq(documents.contentHash, contentHash),
        ne(documents.status, 'failed'),
      ),
    )
    .limit(1);
  if (existing) {
    return {
      document: toDocumentDTO(existing),
      kind: content.kind,
      sourceUrl: content.sourceUrl,
      title: existing.title,
      wordCount: content.wordCount,
      duplicate: true,
    };
  }

  const key = `${workspace.id}/${randomUUID()}`;
  await storage.put(key, content.markdown);

  try {
    const [created] = await db
      .insert(documents)
      .values({
        workspaceId: workspace.id,
        title: content.title.slice(0, 300),
        filePath: key,
        // The extracted body is Markdown; provenance lives in metadata.
        fileType: 'md',
        contentHash,
        sourceUrl: content.sourceUrl,
        metadata: content.metadata,
        sizeBytes,
        status: 'processing',
      })
      .returning();
    if (!created) throw new Error('Failed to create document record');

    try {
      await enqueueDocumentEmbedding(created.id);
    } catch (enqueueError) {
      await db
        .delete(documents)
        .where(eq(documents.id, created.id))
        .catch(() => undefined);
      throw enqueueError;
    }

    return {
      document: toDocumentDTO(created),
      kind: content.kind,
      sourceUrl: content.sourceUrl,
      title: content.title,
      wordCount: content.wordCount,
    };
  } catch (err) {
    await storage.delete(key).catch(() => undefined);
    throw err;
  }
}
