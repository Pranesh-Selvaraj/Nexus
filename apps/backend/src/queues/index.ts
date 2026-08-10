import { Redis } from 'ioredis';
import { Queue } from 'bullmq';

export interface EmbeddingJobData {
  documentId: string;
}

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
export async function enqueueDocumentEmbedding(documentId: string): Promise<void> {
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