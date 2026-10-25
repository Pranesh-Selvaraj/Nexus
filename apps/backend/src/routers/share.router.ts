import type { CreatedShareLink, ShareLinkDTO } from '@nexus/shared-types';
import {
  createShareLinkInputSchema,
  shareLinkIdSchema,
  workspaceIdSchema,
} from '@nexus/shared-types';
import { TRPCError } from '@trpc/server';

import { protectedProcedure, t } from '../middleware/auth.js';
import { ApiError } from '../utils/errors.js';
import {
  createShareLink,
  listShareLinks,
  revokeShareLink,
} from '../services/share.service.js';

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
 * Read-only share links (L-13). Session-only management: an API key cannot
 * mint a capability URL for a workspace.
 */
export const shareRouter = t.router({
  list: protectedProcedure
    .input(workspaceIdSchema)
    .query(async ({ ctx, input }): Promise<ShareLinkDTO[]> =>
      listShareLinks(ctx.user.id, input.workspaceId).catch(asTrpcError),
    ),

  create: protectedProcedure
    .input(createShareLinkInputSchema)
    .mutation(async ({ ctx, input }): Promise<CreatedShareLink> =>
      createShareLink(ctx.user.id, input).catch(asTrpcError),
    ),

  revoke: protectedProcedure
    .input(shareLinkIdSchema)
    .mutation(async ({ ctx, input }): Promise<{ revoked: boolean }> =>
      revokeShareLink(ctx.user.id, input.id).catch(asTrpcError),
    ),
});
