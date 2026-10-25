import { randomUUID } from 'node:crypto';

import JSZip from 'jszip';
import { and, eq } from 'drizzle-orm';

import type { WorkspaceArchive, WorkspaceDTO } from '@nexus/shared-types';

import { db } from '../db/index.js';
import { ApiError } from '../utils/errors.js';
import {
  conversations,
  documents,
  messages,
  workspaces,
} from '../db/schema.js';
import { enqueueDocumentEmbedding } from '../queues/index.js';
import { ALLOWED_EXTENSIONS } from '../utils/multer.config.js';
import { storage } from './storage/index.js';

/**
 * Build the JSON archive for a workspace the caller owns. Shared by the tRPC
 * export (still used for programmatic round-trips) and the zip download.
 */
export async function exportWorkspaceArchive(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceArchive> {
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.userId, userId)))
    .limit(1);
  if (!workspace) throw new ApiError('Workspace not found', 404);

  const docRows = await db
    .select()
    .from(documents)
    .where(eq(documents.workspaceId, workspace.id));
  const documentsArchive = await Promise.all(
    docRows.map(async (doc) => {
      let contentBase64 = '';
      try {
        contentBase64 = (await storage.get(doc.filePath)).toString('base64');
      } catch {
        // file missing on disk - export metadata only
      }
      return { title: doc.title, fileType: doc.fileType, contentBase64 };
    }),
  );

  const conversationRows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.workspaceId, workspace.id));
  const conversationsArchive = await Promise.all(
    conversationRows.map(async (conversation) => {
      const messageRows = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversation.id))
        .orderBy(messages.createdAt);
      return {
        title: conversation.title,
        messages: messageRows.map((message) => ({
          role: message.role,
          content: message.content,
          sources: message.sources,
          usage: message.usage,
          createdAt: new Date(message.createdAt).toISOString(),
        })),
      };
    }),
  );

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    workspace: {
      name: workspace.name,
      description: workspace.description,
    },
    documents: documentsArchive,
    conversations: conversationsArchive,
  };
}

/** Upper bound for one zip export (decoded bytes), to keep memory sane. */
const MAX_ZIP_BYTES = 300 * 1024 * 1024;

function safeFileName(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

/**
 * Zip export (B-5): the manifest plus the original stored files, so a user can
 * read their library without Nexus. The manifest omits the base64 payloads
 * (the files are the payload); conversations and metadata stay in JSON.
 */
export async function buildWorkspaceZip(
  userId: string,
  workspaceId: string,
): Promise<{ buffer: Buffer; fileName: string }> {
  const archive = await exportWorkspaceArchive(userId, workspaceId);
  const zip = new JSZip();

  let totalBytes = 0;
  const documents = archive.documents.map((document, index) => {
    const content = Buffer.from(document.contentBase64, 'base64');
    totalBytes += content.length;
    if (totalBytes > MAX_ZIP_BYTES) {
      throw new ApiError(
        'This workspace is too large to export as one zip (300 MB limit). Export individual documents or use the JSON API.',
        413,
      );
    }
    const fileName = `${String(index + 1).padStart(4, '0')}-${safeFileName(
      document.title,
      'document',
    )}`;
    if (content.length > 0) zip.file(`documents/${fileName}`, content);
    return {
      ...document,
      contentBase64: undefined,
      file: `documents/${fileName}`,
    };
  });

  zip.file(
    'workspace.json',
    JSON.stringify({ ...archive, documents }, null, 2),
  );
  zip.file(
    'README.txt',
    [
      `Nexus workspace export: ${archive.workspace.name}`,
      `Exported at: ${archive.exportedAt}`,
      '',
      'Contents:',
      '- workspace.json  workspace metadata, documents manifest and conversations',
      '- documents/      the original stored files (as ingested)',
      '',
      'The JSON export (GET /trpc/workspace.export) remains the round-trip',
      'format used by the import endpoint; this zip is for reading and backup.',
    ].join('\n'),
  );

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const fileName = `nexus-${safeFileName(
    archive.workspace.name.toLowerCase(),
    'workspace',
  )}-${new Date().toISOString().slice(0, 10)}.zip`;
  return { buffer, fileName };
}

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
  for (const doc of archive.documents) {
    const key = `${created.id}/${randomUUID()}`;
    try {
      await storage.put(key, Buffer.from(doc.contentBase64, 'base64'));
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
        filePath: key,
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
