import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { WorkspaceArchive, WorkspaceDTO } from '@nexus/shared-types';

import { db } from '../db/index.js';
import {
  conversations,
  documents,
  messages,
  workspaces,
} from '../db/schema.js';
import { enqueueDocumentEmbedding } from '../queues/index.js';
import { ALLOWED_EXTENSIONS } from '../utils/multer.config.js';
import { UPLOAD_DIR } from '../utils/paths.js';

/** Sanity limits for archives restored from untrusted JSON. */
export interface ArchiveLimits {
  maxDocuments: number;
  maxTotalDocumentBytes: number;
  maxConversations: number;
  maxMessagesPerConversation: number;
}

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxDocuments: 1000,
  maxTotalDocumentBytes: 200 * 1024 * 1024,
  maxConversations: 500,
  maxMessagesPerConversation: 5000,
};

/** Decoded byte length of a base64 string (without allocating a Buffer). */
function base64Bytes(value: string): number {
  return Math.floor((value.length * 3) / 4);
}

/**
 * Reject archives that would exhaust memory/disk before any row or file is
 * written. The encoded upload size is capped by multer; this guards the
 * decoded payload and the row counts.
 */
export function assertArchiveWithinLimits(
  archive: WorkspaceArchive,
  limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS,
): void {
  if (archive.documents.length > limits.maxDocuments) {
    throw new Error(
      `Archive has too many documents (${archive.documents.length}; limit ${limits.maxDocuments})`,
    );
  }
  let totalBytes = 0;
  for (const doc of archive.documents) {
    totalBytes += base64Bytes(doc.contentBase64);
    if (totalBytes > limits.maxTotalDocumentBytes) {
      throw new Error(
        `Archive documents exceed the ${Math.floor(limits.maxTotalDocumentBytes / (1024 * 1024))} MB restore limit`,
      );
    }
  }
  if (archive.conversations.length > limits.maxConversations) {
    throw new Error(
      `Archive has too many conversations (${archive.conversations.length}; limit ${limits.maxConversations})`,
    );
  }
  for (const conversation of archive.conversations) {
    if (conversation.messages.length > limits.maxMessagesPerConversation) {
      throw new Error(
        `A conversation has too many messages (${conversation.messages.length}; limit ${limits.maxMessagesPerConversation})`,
      );
    }
  }
}

/** Parse a date from an archive, falling back to "now" when invalid. */
function safeDate(value: string): Date {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

/**
 * Restore an exported workspace: metadata, uploaded files (written under
 * fresh server-controlled names) and chat history. Documents are queued for
 * re-indexing. Used by both the tRPC mutation and the streaming REST import
 * endpoint.
 */
export async function importWorkspaceArchive(
  userId: string,
  archive: WorkspaceArchive,
): Promise<WorkspaceDTO> {
  assertArchiveWithinLimits(archive);

  const [created] = await db
    .insert(workspaces)
    .values({
      userId,
      name: archive.workspace.name.trim().slice(0, 80) || 'Imported workspace',
      description: archive.workspace.description,
    })
    .returning();
  if (!created) {
    throw new Error('Failed to create workspace');
  }

  // Restore documents: write file contents under fresh server-controlled
  // names and re-queue embeddings.
  const workspaceDir = path.join(UPLOAD_DIR, created.id);
  await mkdir(workspaceDir, { recursive: true });

  for (const doc of archive.documents) {
    const filename = randomUUID();
    const filePath = path.join(workspaceDir, filename);
    try {
      await writeFile(filePath, Buffer.from(doc.contentBase64, 'base64'));
    } catch (err) {
      console.error('[import] skipping unreadable document:', err);
      continue;
    }
    // Never trust an arbitrary file type from the archive: only extensions
    // the ingestion pipeline understands are kept.
    const fileType =
      doc.fileType && ALLOWED_EXTENSIONS.has(doc.fileType.toLowerCase())
        ? doc.fileType.toLowerCase()
        : null;
    const [inserted] = await db
      .insert(documents)
      .values({
        workspaceId: created.id,
        title: doc.title,
        filePath: `${created.id}/${filename}`,
        fileType,
        status: 'processing',
      })
      .returning({ id: documents.id });
    if (inserted) {
      await enqueueDocumentEmbedding(inserted.id).catch((err) =>
        console.error('[import] enqueue failed:', err),
      );
    }
  }

  // Restore conversations and their messages (usage included).
  for (const conversation of archive.conversations) {
    const [conv] = await db
      .insert(conversations)
      .values({
        workspaceId: created.id,
        title: conversation.title.slice(0, 200) || 'Imported conversation',
      })
      .returning({ id: conversations.id });
    if (!conv) continue;
    for (const message of conversation.messages) {
      await db.insert(messages).values({
        conversationId: conv.id,
        role: message.role,
        content: message.content,
        sources: message.sources,
        usage: message.usage,
        createdAt: safeDate(message.createdAt),
      });
    }
  }

  return {
    id: created.id,
    name: created.name,
    description: created.description,
    documentCount: archive.documents.length,
    createdAt: created.createdAt.toISOString(),
  };
}
