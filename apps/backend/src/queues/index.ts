import { Redis } from 'ioredis';
import { Queue } from 'bullmq';

export interface EmbeddingJobData {
  documentId: string;
}

/** Repeatable maintenance job names (same queue, branched in the worker). */
export const MAINTENANCE_JOB = 'purge-expired-sessions';

const MAINTENANCE_CRON = '0 3 * * *'; // daily at 03:00 server time

export const redisConnection = new Redis(
  process.env.REDIS_URL ?? 'redis://localhost:6379',
  { maxRetriesPerRequest: null },
);

export const embeddingQueue = new Queue<EmbeddingJobData>('embedding', {
  connection: redisConnection,
});

/**
 * Queue a document for async embedding generation. Retried up to 3 times
 * (exponential backoff) before the document is marked as failed.
 */
export async function enqueueDocumentEmbedding(
  documentId: string,
): Promise<void> {
  await embeddingQueue.add(
    'embed',
    { documentId },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    },
  );
}

/**
 * Register the daily housekeeping job (idempotent - fixed jobId). Sessions
 * are deleted lazily on lookup, so without this the sessions table would
 * grow forever on long-running instances. Call once at worker boot.
 */
export async function scheduleMaintenance(): Promise<void> {
  await embeddingQueue.add(MAINTENANCE_JOB, {} as EmbeddingJobData, {
    repeat: { pattern: MAINTENANCE_CRON },
    jobId: MAINTENANCE_JOB,
    removeOnComplete: true,
    removeOnFail: true,
  });
}
