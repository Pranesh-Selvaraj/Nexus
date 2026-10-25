import type {
  CreatedWebhook,
  UpdateWebhookInput,
  WebhookDTO,
} from '@nexus/shared-types';
import {
  createWebhookInputSchema,
  updateWebhookInputSchema,
  webhookIdSchema,
} from '@nexus/shared-types';
import { TRPCError } from '@trpc/server';

import { protectedProcedure, t } from '../middleware/auth.js';
import { ApiError } from '../utils/errors.js';
import {
  createWebhook,
  deleteWebhook,
  listWebhooks,
  sendTestWebhook,
  updateWebhook,
} from '../services/webhook.service.js';

/** Re-raise a service error as the tRPC equivalent. */
function asTrpcError(err: unknown): never {
  if (err instanceof ApiError) {
    throw new TRPCError({
      code: err.status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST',
      message: err.message,
    });
  }
  throw err;
}

/**
 * Webhook management (P-5). Session-only, like API keys: a key cannot create
 * an endpoint that receives the user's indexing events.
 */
export const webhookRouter = t.router({
  list: protectedProcedure.query(async ({ ctx }): Promise<WebhookDTO[]> =>
    listWebhooks(ctx.user.id),
  ),

  create: protectedProcedure
    .input(createWebhookInputSchema)
    .mutation(async ({ ctx, input }): Promise<CreatedWebhook> => {
      return createWebhook(ctx.user.id, input).catch(asTrpcError);
    }),

  update: protectedProcedure
    .input(updateWebhookInputSchema)
    .mutation(async ({ ctx, input }): Promise<WebhookDTO> => {
      return updateWebhook(ctx.user.id, input as UpdateWebhookInput).catch(
        asTrpcError,
      );
    }),

  delete: protectedProcedure
    .input(webhookIdSchema)
    .mutation(async ({ ctx, input }): Promise<{ deleted: boolean }> => {
      return deleteWebhook(ctx.user.id, input.id);
    }),

  test: protectedProcedure
    .input(webhookIdSchema)
    .mutation(async ({ ctx, input }): Promise<{ queued: boolean }> => {
      return sendTestWebhook(ctx.user.id, input.id).catch(asTrpcError);
    }),
});
