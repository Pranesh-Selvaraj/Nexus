import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { DocumentStructure } from '@nexus/contracts';
import { messages } from './chat.js';
import { documentStatusEnum } from './enums.js';
import { tsvector, vectorDim } from './types.js';
import { workspaces } from './workspaces.js';

export const documents = pgTable(
  'documents',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    filePath: text('file_path').notNull(),
    // Detected format (magic bytes), not the client-supplied extension.
    fileType: text('file_type'),
    // sha256 of the uploaded bytes: duplicate detection within a workspace.
    contentHash: text('content_hash'),
    // Canonical URL for URL/YouTube ingestion (provenance + citations).
    sourceUrl: text('source_url'),
    // Structure extracted by the parser: format, TOC, OCR/vision flags.
    metadata: jsonb('metadata').$type<DocumentStructure | null>(),
    status: documentStatusEnum('status').notNull().default('processing'),
    chunkCount: integer('chunk_count').notNull().default(0),
    // Bytes of the stored file, for storage accounting and quotas. Existing
    // rows default to 0 until re-uploaded.
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    // Set when the document is moved to the trash; the maintenance job purges
    // it (row + file) once storage.trashDays has elapsed.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    // Populated when indexing fails: sanitized error + attempt count so the
    // UI can explain what happened instead of showing a bare 'failed' badge.
    errorMessage: text('error_message'),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('documents_workspace_id_idx').on(table.workspaceId)],
);

export interface ChunkMetadata {
  chunkIndex: number;
  page: number | null;
  pageEnd?: number | null;
  headingPath?: string[];
}

export const chunks = pgTable(
  'chunks',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    // Denormalised from the document: retrieval filters by workspace, and the
    // ANN scan can only use the HNSW index when the predicate is on `chunks`.
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    embedding: vectorDim('embedding').notNull(),
    metadata: jsonb('metadata').$type<ChunkMetadata>().notNull(),
    // Embedding provenance: which model/dimensions produced this vector.
    // Retrieval only compares vectors from the active model (legacy NULL rows
    // are matched by vector dimension instead) so switching models can never
    // mix vector spaces or crash pgvector with mismatched dimensions.
    embeddingModel: text('embedding_model'),
    embeddingDims: integer('embedding_dims'),
    embeddingVersion: integer('embedding_version'),
    contentHash: text('content_hash'),
    tokenCount: integer('token_count'),
    language: text('language'),
    contentFts: tsvector('content_fts'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('chunks_document_id_idx').on(table.documentId),
    index('chunks_workspace_id_idx').on(table.workspaceId),
    index('chunks_embedding_model_idx').on(table.embeddingModel),
    index('chunks_content_fts_idx').using('gin', table.contentFts),
  ],
);

export const highlights = pgTable(
  'highlights',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').references(() => documents.id, {
      onDelete: 'set null',
    }),
    messageId: uuid('message_id').references(() => messages.id, {
      onDelete: 'set null',
    }),
    chunkId: uuid('chunk_id').references(() => chunks.id, {
      onDelete: 'set null',
    }),
    quotedText: text('quoted_text').notNull(),
    note: text('note'),
    color: text('color').notNull().default('yellow'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('highlights_workspace_id_idx').on(table.workspaceId)],
);
