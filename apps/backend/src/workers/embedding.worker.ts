import '../utils/env.js';

import path from 'node:path';

import { Worker } from 'bullmq';
import { eq, lt, sql } from 'drizzle-orm';

import { db } from '../db/index.js';
import { chunks, documents, sessions, workspaces } from '../db/schema.js';
import type { EmbeddingJobData, WebhookJobData } from '../queues/index.js';
import {
  MAINTENANCE_JOB,
  redisConnection,
  scheduleMaintenance,
} from '../queues/index.js';
import {
  buildEmbeddingText,
  splitIntoChunks,
} from '../services/chunking.service.js';
import { parseStoredFile } from '../services/ingestion/registry.js';
import {
  EMBEDDING_VERSION,
  embedTexts,
  getEffectiveEmbeddingModel,
  getEmbeddingDimensions,
} from '../services/embedding.service.js';
import { safeFtsLanguage } from '../services/retrieval-language.js';
import { purgeExpiredAudio } from '../services/audio.service.js';
import { purgeExpiredTrash } from '../services/storage.service.js';
import { runBackup } from '../services/backup.service.js';
import {
  deliverWebhook,
  emitWebhookEvent,
} from '../services/webhook.service.js';
import { sanitizeForLog } from '../utils/sanitize.js';
import { UPLOAD_DIR } from '../utils/paths.js';

async function processDocument(documentId: string): Promise<void> {
  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  if (!doc) return;

  await db
    .update(documents)
    .set({ status: 'processing', errorMessage: null, updatedAt: new Date() })
    .where(eq(documents.id, doc.id));

  const filePath = path.resolve(UPLOAD_DIR, doc.filePath);

  // 1. Parse file -> pages through the format registry (magic-byte format is
  //    stored on the row at upload time). Media transcription needs the
  //    workspace owner for the STT pipeline's accounting.
  const [owner] = await db
    .select({ userId: workspaces.userId })
    .from(workspaces)
    .where(eq(workspaces.id, doc.workspaceId))
    .limit(1);
  if (!owner) {
    throw new Error('The workspace for this document no longer exists');
  }
  const parsed = await parseStoredFile({
    filePath,
    format: doc.fileType ?? 'txt',
    fileName: doc.title,
    userId: owner.userId,
    workspaceId: doc.workspaceId,
    documentId: doc.id,
  });
  const pages = parsed.pages;
  // Precomputed metadata (URL/YouTube ingestion) wins over what the Markdown
  // parser can infer; parser fields fill the gaps.
  const documentMetadata = { ...parsed.metadata, ...(doc.metadata ?? {}) };

  // 2. Split into chunks (heading-aware; heading context is prepended for
  //    embedding so section meaning is searchable, while the stored content
  //    stays clean).
  const textChunks = await splitIntoChunks(pages);
  const texts = textChunks.map((chunk) => buildEmbeddingText(chunk));

  // 3. Embed in batches of 100 (document id = stable provider session id)
  const embeddings = await embedTexts(texts, doc.id);
  if (embeddings.length !== texts.length) {
    throw new Error(
      `Embedding count mismatch: expected ${texts.length}, got ${embeddings.length}`,
    );
  }
  const [expectedDims, embeddingModel, language] = await Promise.all([
    getEmbeddingDimensions(),
    getEffectiveEmbeddingModel(),
    safeFtsLanguage(),
  ]);
  for (const [i, vec] of embeddings.entries()) {
    if (vec.length !== expectedDims) {
      throw new Error(
        `Embedding dimension mismatch for chunk ${i}: model returned ${vec.length} dimensions, expected ${expectedDims}. Check the embedding model and the 'Embedding dimensions' setting.`,
      );
    }
  }

  const rows = textChunks.map((chunk, i) => ({
    documentId: doc.id,
    content: chunk.content,
    embedding: embeddings[i] ?? [],
    metadata: {
      chunkIndex: chunk.index,
      page: chunk.page,
      pageEnd: chunk.pageEnd,
      headingPath: chunk.headingPath,
    },
    embeddingModel,
    embeddingDims: expectedDims,
    embeddingVersion: EMBEDDING_VERSION,
    contentHash: chunk.contentHash,
    tokenCount: chunk.tokenCount,
    language,
  }));

  // 4. Wipe stale chunks (idempotent retry) and write new ones
  await db.transaction(async (tx) => {
    await tx.delete(chunks).where(eq(chunks.documentId, doc.id));
    if (rows.length > 0) {
      await tx.insert(chunks).values(rows);
      // Populate the indexed full-text column with the same language the
      // queries will use (a fixed expression index cannot serve all
      // configured languages).
      await tx.execute(
        sql`UPDATE chunks SET content_fts = to_tsvector(${language}::regconfig, content) WHERE document_id = ${doc.id}`,
      );
    }
    await tx
      .update(documents)
      .set({
        status: 'ready',
        chunkCount: rows.length,
        errorMessage: null,
        metadata: documentMetadata,
        title: (parsed.title?.trim() || doc.title).slice(0, 300),
        updatedAt: new Date(),
      })
      .where(eq(documents.id, doc.id));
  });
}

/** Delete sessions whose expiry has passed (daily maintenance job). */
async function purgeExpiredSessions(): Promise<number> {
  const deleted = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, new Date()))
    .returning({ id: sessions.id });
  return deleted.length;
}

const worker = new Worker<EmbeddingJobData>(
  'embedding',
  async (job) => {
    if (job.name === MAINTENANCE_JOB) {
      const purged = await purgeExpiredSessions();
      const audioPurged = await purgeExpiredAudio();
      const trashPurged = await purgeExpiredTrash();
      // Nightly logical backup, opt-in: a failure is logged and retried on the
      // next maintenance run; it never fails the maintenance job.
      let backup: string | null = null;
      if (process.env.BACKUP_ENABLED === 'true') {
        backup = await runBackup()
          .then((result) => result.file)
          .catch((err: unknown) => {
            console.error(
              '[worker] scheduled backup failed:',
              sanitizeForLog(err),
            );
            return null;
          });
      }
      console.log(
        `[worker] maintenance: purged ${purged} expired session(s), ${audioPurged} audio asset(s), ${trashPurged} trashed document(s)` +
          (backup ? `, backup ${backup}` : ''),
      );
      return {
        maintenance: 'sessions-purged',
        purged,
        audioPurged,
        trashPurged,
        backup,
      };
    }
    const documentId = job.data.documentId;
    await processDocument(documentId);
    return { documentId, chunks: undefined as number | undefined };
  },
  { connection: redisConnection, concurrency: 3 },
);

worker.on('completed', async (job) => {
  // Maintenance jobs carry no document id.
  if (job.name === MAINTENANCE_JOB || !job.data.documentId) return;
  const [doc] = await db
    .select({
      title: documents.title,
      chunkCount: documents.chunkCount,
      workspaceId: documents.workspaceId,
      ownerId: workspaces.userId,
    })
    .from(documents)
    .innerJoin(workspaces, eq(workspaces.id, documents.workspaceId))
    .where(eq(documents.id, job.data.documentId))
    .limit(1);
  console.log(
    `[worker] embedded "${doc?.title ?? job.data.documentId}" (${doc?.chunkCount ?? 0} chunks)`,
  );
  if (doc) {
    await emitWebhookEvent({
      userId: doc.ownerId,
      workspaceId: doc.workspaceId,
      event: 'document.indexed',
      data: {
        documentId: job.data.documentId,
        workspaceId: doc.workspaceId,
        title: doc.title,
        chunkCount: doc.chunkCount,
      },
    });
  }
});

// Webhook deliveries share this process so a deployment needs no extra
// service; concurrency stays low because each delivery is a short HTTP POST.
const webhookWorker = new Worker<WebhookJobData>(
  'webhook',
  async (job) => {
    await deliverWebhook(job.data);
  },
  { connection: redisConnection, concurrency: 5 },
);

webhookWorker.on('failed', (job, err) => {
  console.error(
    `[worker] webhook delivery ${job?.data.payload.deliveryId ?? ''} failed:`,
    sanitizeForLog(err),
  );
});

worker.on('failed', async (job, err) => {
  if (!job?.data.documentId) return;

  // A workspace (and its documents) can be deleted while its job is still in
  // flight: the delete cascades to the chunks insert, BullMQ keeps the job and
  // retries it. That race is not an indexing failure, and there is no row left
  // to mark, so report it as a dropped job instead of an error.
  const [doc] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.id, job.data.documentId))
    .limit(1)
    .catch(() => [] as Array<{ id: string }>);
  if (!doc) {
    console.log(
      `[worker] dropped job for deleted document ${job.data.documentId}`,
    );
    return;
  }

  console.error(
    `[worker] embedding failed for document ${job.data.documentId} (attempt ${job.attemptsMade}):`,
    err.message,
  );

  // BullMQ emits 'failed' after every attempt, including ones that will be
  // retried. Only mark the document failed once retries are exhausted; until
  // then record the latest error and attempt count while it stays processing.
  const maxAttempts = job.opts.attempts ?? 1;
  const terminal = job.attemptsMade >= maxAttempts;

  if (terminal) {
    const [owner] = await db
      .select({
        workspaceId: documents.workspaceId,
        ownerId: workspaces.userId,
      })
      .from(documents)
      .innerJoin(workspaces, eq(workspaces.id, documents.workspaceId))
      .where(eq(documents.id, job.data.documentId))
      .limit(1);
    if (owner) {
      await emitWebhookEvent({
        userId: owner.ownerId,
        workspaceId: owner.workspaceId,
        event: 'document.failed',
        data: {
          documentId: job.data.documentId,
          workspaceId: owner.workspaceId,
          error: sanitizeForLog(err.message),
        },
      });
    }
  }

  await db
    .update(documents)
    .set({
      status: terminal ? 'failed' : 'processing',
      errorMessage: sanitizeForLog(err.message),
      attempts: job.attemptsMade,
      updatedAt: new Date(),
    })
    .where(eq(documents.id, job.data.documentId))
    .catch((dbErr) =>
      console.error('[worker] failed to record document failure:', dbErr),
    );
});

worker.on('error', (err) => {
  console.error('[worker] redis error:', err.message);
});

void scheduleMaintenance().catch((err) =>
  console.error('[worker] failed to schedule maintenance job:', err.message),
);

console.log(
  `[worker] listening for embedding jobs (redis: ${process.env.REDIS_URL ?? 'redis://localhost:6379'}, uploads: ${path.resolve(UPLOAD_DIR)})`,
);
