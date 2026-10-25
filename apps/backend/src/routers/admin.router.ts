import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { protectedProcedure, t } from '../middleware/auth.js';
import { ApiError } from '../utils/errors.js';
import {
  queueStatus,
  removeEmbeddingJob,
  retryEmbeddingJob,
  type QueueStatus,
} from '../services/queue-admin.service.js';

function asTrpcError(err: unknown): never {
  if (err instanceof ApiError) {
    throw new TRPCError({
      code: err.status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST',
      message: err.message,
    });
  }
  throw err;
}

const documentJobInput = z.object({ documentId: z.string().uuid() });

/**
 * Operator view of the embedding queue (P-3): what is pending, what failed and
 * why, with retry/drop actions. Session-only: an API key cannot clear jobs.
 */
export const adminRouter = t.router({
  queue: protectedProcedure.query(async (): Promise<QueueStatus> =>
    queueStatus(),
  ),

  retryJob: protectedProcedure
    .input(documentJobInput)
    .mutation(async ({ input }): Promise<{ retried: boolean }> => {
      await retryEmbeddingJob(input.documentId).catch(asTrpcError);
      return { retried: true };
    }),

  removeJob: protectedProcedure
    .input(documentJobInput)
    .mutation(async ({ input }): Promise<{ removed: boolean }> => {
      await removeEmbeddingJob(input.documentId).catch(asTrpcError);
      return { removed: true };
    }),
});
