import { TRPCError } from '@trpc/server';

import type { WorkspaceMemberDTO } from '@nexus/shared-types';
import {
  addWorkspaceMemberInputSchema,
  removeWorkspaceMemberInputSchema,
  updateWorkspaceMemberInputSchema,
  workspaceIdSchema,
} from '@nexus/shared-types';

import { protectedProcedure, t } from '../middleware/auth.js';
import { ApiError } from '../utils/errors.js';
import {
  addMember,
  listMembers,
  removeMember,
  updateMemberRole,
} from '../services/member.service.js';

function asTrpcError(err: unknown): never {
  if (err instanceof ApiError) {
    throw new TRPCError({
      code:
        err.status === 404
          ? 'NOT_FOUND'
          : err.status === 403
            ? 'FORBIDDEN'
            : 'BAD_REQUEST',
      message: err.message,
    });
  }
  throw err;
}

/** Workspace members and roles (L-13). */
export const membersRouter = t.router({
  list: protectedProcedure
    .input(workspaceIdSchema)
    .query(async ({ ctx, input }): Promise<WorkspaceMemberDTO[]> =>
      listMembers(ctx.user.id, input.workspaceId).catch(asTrpcError),
    ),

  add: protectedProcedure
    .input(addWorkspaceMemberInputSchema)
    .mutation(async ({ ctx, input }): Promise<WorkspaceMemberDTO> =>
      addMember(ctx.user.id, input).catch(asTrpcError),
    ),

  updateRole: protectedProcedure
    .input(updateWorkspaceMemberInputSchema)
    .mutation(async ({ ctx, input }): Promise<{ updated: boolean }> =>
      updateMemberRole(
        ctx.user.id,
        input.workspaceId,
        input.userId,
        input.role,
      ).catch(asTrpcError),
    ),

  remove: protectedProcedure
    .input(removeWorkspaceMemberInputSchema)
    .mutation(async ({ ctx, input }): Promise<{ removed: boolean }> =>
      removeMember(ctx.user.id, input.workspaceId, input.userId).catch(
        asTrpcError,
      ),
    ),
});
