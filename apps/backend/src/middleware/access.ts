import { TRPCError } from '@trpc/server';

import type { WorkspaceRole } from '@nexus/shared-types';

import { assertWorkspaceAccess } from '../services/access.service.js';
import { ApiError } from '../utils/errors.js';

/** tRPC flavour of the workspace access guard (ApiError -> TRPCError). */
export async function assertWorkspaceAccessTrpc(
  userId: string,
  workspaceId: string,
  minRole: WorkspaceRole = 'reader',
): Promise<WorkspaceRole> {
  try {
    return await assertWorkspaceAccess(userId, workspaceId, minRole);
  } catch (err) {
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
}
