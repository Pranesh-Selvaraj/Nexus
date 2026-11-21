import { protectedProcedure, t } from '../../platform/auth/context.js';
import {
  storageUsage,
  type StorageUsage,
} from '../documents/storage.service.js';

/** Storage accounting for the settings dashboard (P-6). */
export const storageRouter = t.router({
  usage: protectedProcedure.query(async ({ ctx }): Promise<StorageUsage> =>
    storageUsage(ctx.user.id),
  ),
});
