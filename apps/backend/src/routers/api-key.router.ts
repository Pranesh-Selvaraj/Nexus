import type { ApiKeyDTO, CreatedApiKey } from '@nexus/shared-types';
import {
  createApiKeyInputSchema,
  revokeApiKeyInputSchema,
} from '@nexus/shared-types';

import { protectedProcedure, t } from '../middleware/auth.js';
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from '../services/api-key.service.js';

/**
 * API key management (P-5). Session-only on purpose: a key can never mint or
 * revoke keys, so a leaked integration credential cannot extend its own life.
 */
export const apiKeyRouter = t.router({
  list: protectedProcedure.query(async ({ ctx }): Promise<ApiKeyDTO[]> =>
    listApiKeys(ctx.user.id),
  ),

  create: protectedProcedure
    .input(createApiKeyInputSchema)
    .mutation(async ({ ctx, input }): Promise<CreatedApiKey> => {
      return createApiKey(ctx.user.id, input);
    }),

  revoke: protectedProcedure
    .input(revokeApiKeyInputSchema)
    .mutation(async ({ ctx, input }): Promise<{ revoked: boolean }> => {
      return { revoked: await revokeApiKey(ctx.user.id, input.id) };
    }),
});
