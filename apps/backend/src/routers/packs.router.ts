import { TRPCError } from '@trpc/server';

import type { PacksOverview, WorkspaceDTO } from '@nexus/shared-types';
import { installPackInputSchema } from '@nexus/shared-types';

import { protectedProcedure, t } from '../middleware/auth.js';
import { ApiError } from '../utils/errors.js';
import { installPack, listPacks } from '../services/domain-pack.service.js';

/**
 * Domain packs (L-14): curated topic starters with a plan, starter prompts
 * and a deck. Installing creates a normal, fully editable topic.
 */
export const packsRouter = t.router({
  list: protectedProcedure.query(async ({ ctx }): Promise<PacksOverview> =>
    listPacks(ctx.user.id),
  ),

  install: protectedProcedure
    .input(installPackInputSchema)
    .mutation(async ({ ctx, input }): Promise<WorkspaceDTO> => {
      return installPack(ctx.user.id, input.packId, input.name).catch(
        (err: unknown) => {
          if (err instanceof ApiError) {
            throw new TRPCError({
              code: err.status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST',
              message: err.message,
            });
          }
          throw err;
        },
      );
    }),
});
