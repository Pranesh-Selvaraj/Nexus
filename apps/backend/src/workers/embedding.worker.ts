import '../utils/env.js';

import path from 'node:path';

import { Worker } from 'bullmq';
import { eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import { chunks, documents } from '../db/schema.js';
import type { EmbeddingJobData } from '../queues/index.js';
import { redisConnection } from '../queues/index.js';
import { extractPages, splitIntoChunks } from '../services/chunking.service.js';
import {
  embedTexts,
  getEmbeddingDimensions,
} from '../services/embedding.service.js';
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
    .set({ status: 'processing' })
    .where(eq(documents.id, doc.id));

  const filePath = path.resolve(UPLOAD_DIR, doc.filePath);

  // 1. Parse file -> pages
  const pages = await extractPages(filePath, doc.fileType ?? 'txt');

  // 2. Split into chunks
  const textChunks = await splitIntoChunks(pages);
  const texts = textChunks.map((chunk) => chunk.content);

  // 3. Embed in batches of 100
  const embeddings = await embedTexts(texts);
  if (embeddings.length !== texts.length) {
    throw new Error(
      `Embedding count mismatch: expected ${texts.length}, got ${embeddings.length}`,
    );
  }
  const expectedDims = await getEmbeddingDimensions();
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
    metadata: { chunkIndex: chunk.index, page: chunk.page },
  }));

  // 4. Wipe stale chunks (idempotent retry) and write new ones
  await db.transaction(async (tx) => {
    await tx.delete(chunks).where(eq(chunks.documentId, doc.id));
    if (rows.length > 0) {
      await tx.insert(chunks).values(rows);
    }
    await tx
      .update(documents)
      .set({ status: 'ready', chunkCount: rows.length })
      .where(eq(documents.id, doc.id));
  });
}

const worker = new Worker<EmbeddingJobData>(
  'embedding',
  async (job) => {
    const documentId = job.data.documentId;
    await processDocument(documentId);
    return { documentId, chunks: undefined as number | undefined };
  },
  { connection: redisConnection, concurrency: 3 },
);

worker.on('completed', async (job) => {
  const [doc] = await db
    .select({ title: documents.title, chunkCount: documents.chunkCount })
    .from(documents)
    .where(eq(documents.id, job.data.documentId))
    .limit(1);
  console.log(
    `[worker] embedded "${doc?.title ?? job.data.documentId}" (${doc?.chunkCount ?? 0} chunks)`,
  );
});

worker.on('failed', async (job, err) => {
  console.error(
    `[worker] embedding failed for document ${job?.data.documentId}:`,
    err.message,
  );
  if (job?.data.documentId) {
    await db
      .update(documents)
      .set({ status: 'failed' })
      .where(eq(documents.id, job.data.documentId))
      .catch((dbErr) =>
        console.error('[worker] failed to mark document as failed:', dbErr),
      );
  }
});

worker.on('error', (err) => {
  console.error('[worker] redis error:', err.message);
});

console.log(
  `[worker] listening for embedding jobs (redis: ${process.env.REDIS_URL ?? 'redis://localhost:6379'}, uploads: ${path.resolve(UPLOAD_DIR)})`,
);
