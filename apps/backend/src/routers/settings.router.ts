import OpenAI from 'openai';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { protectedProcedure, t } from '../middleware/auth.js';
import {
  assertSecretsAvailable,
  listSettings,
  updateSetting,
} from '../services/settings.service.js';
import type { SettingView } from '../services/settings.service.js';
import { getSetting } from '../services/settings.service.js';

const settingKeySchema = z.object({ key: z.string().min(1).max(64) });

export const settingsRouter = t.router({
  /** All settings with metadata (secrets masked) for the settings panel. */
  list: protectedProcedure.query(async (): Promise<SettingView[]> => {
    return listSettings();
  }),

  /**
   * Update a single setting. An empty value resets it to the default
   * (env var or registry default). Secret keys require SETTINGS_SECRET.
   */
  update: protectedProcedure
    .input(
      settingKeySchema.extend({
        value: z.string().max(4000),
      }),
    )
    .mutation(async ({ input }): Promise<SettingView> => {
      const defs = await listSettings();
      const def = defs.find((s) => s.key === input.key);
      if (!def) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Unknown setting: ${input.key}`,
        });
      }
      if (def.def.type === 'secret' && input.value !== '') {
        try {
          assertSecretsAvailable();
        } catch (err) {
          if (err instanceof Error) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
          }
          throw err;
        }
      }
      try {
        return await updateSetting(input.key, input.value);
      } catch (err) {
        if (err instanceof Error) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
        }
        throw err;
      }
    }),

  /** Validate the effective OpenAI API key against the API. */
  testOpenAI: protectedProcedure.mutation(
    async (): Promise<{
      ok: boolean;
      message: string;
    }> => {
      const apiKey = await getSetting('openai.apiKey');
      if (!apiKey) {
        return {
          ok: false,
          message:
            'No API key configured - set OPENAI_API_KEY in .env or the settings panel.',
        };
      }
      try {
        const client = new OpenAI({ apiKey });
        await client.models.list();
        return { ok: true, message: 'Connected to OpenAI successfully' };
      } catch (err) {
        return {
          ok: false,
          message:
            err instanceof Error
              ? `Connection failed: ${err.message}`
              : 'Connection failed',
        };
      }
    },
  ),
});
