import { eq, inArray } from 'drizzle-orm';

import { db } from '../db/index.js';
import { documents } from '../db/schema.js';
import { embeddingQueue } from '../queues/index.js';
import { ApiError } from '../utils/errors.js';

export interface QueueJobSummary {
  jobId: string;
  documentId: string;
  title: string | null;
  error: string | null;
  attemptsMade: number;
  failedAt: string | null;
}

export interface QueueStatus {
  counts: {
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
    completed: number;
    paused: number;
  };
  /** Failed indexing jobs, newest first, with their document title. */
  failed: QueueJobSummary[];
}

/**
 * Embedding queue status for the admin view (P-3). Reads BullMQ directly
 * rather than the documents table so retried/retained jobs are visible even
 * after their document was deleted.
 */
export async function queueStatus(limit = 25): Promise<QueueStatus> {
  const raw = await embeddingQueue.getJobCounts(
    'waiting',
    'active',
    'delayed',
    'failed',
    'completed',
    'paused',
  );
  const counts = {
    waiting: Number(raw.waiting ?? 0),
    active: Number(raw.active ?? 0),
    delayed: Number(raw.delayed ?? 0),
    failed: Number(raw.failed ?? 0),
    completed: Number(raw.completed ?? 0),
    paused: Number(raw.paused ?? 0),
  };

  const jobs = await embeddingQueue.getFailed(0, Math.max(0, limit - 1));
  const documentIds = jobs
    .map((job) => (job.data as { documentId?: string }).documentId)
    .filter((id): id is string => typeof id === 'string');
  const titles = new Map<string, string>();
  if (documentIds.length > 0) {
    const rows = await db
      .select({ id: documents.id, title: documents.title })
      .from(documents)
      .where(inArray(documents.id, documentIds));
    for (const row of rows) titles.set(row.id, row.title);
  }

  return {
    counts,
    failed: jobs.map((job) => {
      const documentId = String(
        (job.data as { documentId?: string }).documentId ?? '',
      );
      return {
        jobId: String(job.id ?? ''),
        documentId,
        title: titles.get(documentId) ?? null,
        error: job.failedReason ?? null,
        attemptsMade: job.attemptsMade,
        failedAt: job.finishedOn
          ? new Date(job.finishedOn).toISOString()
          : null,
      };
    }),
  };
}

/** Retry one failed indexing job (job id == document id) and clear its error. */
export async function retryEmbeddingJob(documentId: string): Promise<void> {
  const job = await embeddingQueue.getJob(documentId);
  if (!job) throw new ApiError('No failed job for that document', 404);
  await job.retry();
  await db
    .update(documents)
    .set({ status: 'processing', errorMessage: null, updatedAt: new Date() })
    .where(eq(documents.id, documentId))
    .catch(() => undefined);
}

/** Drop one failed job without retrying it (the document keeps its error). */
export async function removeEmbeddingJob(documentId: string): Promise<void> {
  const job = await embeddingQueue.getJob(documentId);
  if (!job) throw new ApiError('No job for that document', 404);
  await job.remove();
}
