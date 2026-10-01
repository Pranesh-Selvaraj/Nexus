import OpenAI from 'openai';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { protectedProcedure, t } from '../middleware/auth.js';
import {
  assertSecretsAvailable,
  isSecretSetting,
  listSettings,
  updateSetting,
  updateSettings,
} from '../services/settings.service.js';
import type { SettingView } from '../services/settings.service.js';
import { getSetting } from '../services/settings.service.js';
import {
  embedText,
  getEmbeddingDimensions,
} from '../services/embedding.service.js';
import { getProviderConfig } from '../services/openai-client.js';
import type { ProviderConfig } from '../services/openai-client.js';
import { defaultProviderHeaders } from '../services/openai-client.js';
import { friendlyErrorMessage } from '../utils/errors.js';
import { baseUrlEndpointPath, suggestBaseUrl } from '../utils/provider-url.js';

const settingKeySchema = z.object({ key: z.string().min(1).max(64) });

const settingValuesSchema = z.record(
  z.string().min(1).max(64),
  z.string().max(4000),
);

/** True when the batch contains a non-empty value for a secret setting. */
function touchesSecrets(values: Record<string, string>): boolean {
  return Object.entries(values).some(
    ([key, value]) => value !== '' && isSecretSetting(key),
  );
}

/** Short timeout + one retry: settings-panel probes must stay snappy while
 * surviving transient network blips (DNS, Wi-Fi, resets). */
const PROBE_TIMEOUT_MS = 15_000;

function providerLabel(baseUrl: string): string {
  return baseUrl || 'api.openai.com';
}

/** Fresh, uncached client for one-off settings-panel probes. */
function probeClient(config: ProviderConfig): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey || 'local',
    baseURL: config.baseUrl || undefined,
    defaultHeaders: defaultProviderHeaders(),
    timeout: PROBE_TIMEOUT_MS,
    maxRetries: 1,
  });
}

function errMessage(err: unknown): string {
  return friendlyErrorMessage(err);
}

/** Clear hint when a base URL already contains an endpoint path. */
function endpointPathHint(baseUrl: string): string | null {
  const path = baseUrlEndpointPath(baseUrl);
  if (!path) return null;
  return `the base URL ends with ${path} — Nexus appends the API paths (e.g. /chat/completions, /models) itself, set it to ${suggestBaseUrl(baseUrl)}`;
}

function errStatus(err: unknown): number | undefined {
  return err instanceof OpenAI.APIError ? err.status : undefined;
}

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

  /**
   * Update several settings in one validated batch. The UI uses this so
   * cross-field invariants (chunk overlap < chunk size) are checked against
   * the final state rather than per-field save order.
   */
  updateMany: protectedProcedure
    .input(z.object({ values: settingValuesSchema }))
    .mutation(async ({ input }): Promise<SettingView[]> => {
      if (touchesSecrets(input.values)) {
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
        return await updateSettings(input.values);
      } catch (err) {
        if (err instanceof Error) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
        }
        throw err;
      }
    }),

  /**
   * List models served by the configured chat provider (OpenAI-compatible
   * `GET {baseUrl}/models`). Returns ids for the settings panel.
   */
  listModels: protectedProcedure.mutation(
    async (): Promise<{ models: string[]; error: string | null }> => {
      const config = await getProviderConfig('chat');
      const hint = endpointPathHint(config.baseUrl);
      try {
        const client = probeClient(config);
        const list = await client.models.list();
        return {
          models: list.data.map((m) => m.id).sort(),
          error: null,
        };
      } catch (err) {
        return {
          models: [],
          error: `Could not reach ${providerLabel(config.baseUrl)}: ${errMessage(err)}${hint ? ` (${hint})` : ''}`,
        };
      }
    },
  ),

  /**
   * List models served by the embedding provider (dedicated embedding
   * settings, falling back to the main provider).
   */
  listEmbeddingModels: protectedProcedure.mutation(
    async (): Promise<{ models: string[]; error: string | null }> => {
      const config = await getProviderConfig('embedding');
      const hint = endpointPathHint(config.baseUrl);
      try {
        const client = probeClient(config);
        const list = await client.models.list();
        return {
          models: list.data.map((m) => m.id).sort(),
          error: null,
        };
      } catch (err) {
        return {
          models: [],
          error: `Could not reach ${providerLabel(config.baseUrl)}: ${errMessage(err)}${hint ? ` (${hint})` : ''}`,
        };
      }
    },
  ),

  /**
   * Validate the effective provider configuration end to end:
   *
   *   1. chat endpoint  - reachable (models) + authenticated with the
   *      configured chat model (tiny completion)
   *   2. embedding endpoint - real embedding request against the effective
   *      embedding provider, verifying the returned vector dimensions
   *
   * Every check targets the configured base URLs, so non-OpenAI providers
   * (OpenCode Zen, OpenRouter, Ollama, ...) are tested correctly.
   */
  testOpenAI: protectedProcedure.mutation(
    async (): Promise<{
      ok: boolean;
      message: string;
    }> => {
      const chat = await getProviderConfig('chat');
      const embedding = await getProviderConfig('embedding');

      // The .env.example placeholder never counts as a configured key.
      const chatKeyReal =
        Boolean(chat.apiKey) && chat.apiKey !== 'sk-your-key-here';
      if (!chatKeyReal && !chat.baseUrl) {
        return {
          ok: false,
          message:
            'No provider configured - set an API key or an API base URL in the settings panel or .env.',
        };
      }

      // A base URL that already contains an endpoint path (e.g. the full
      // /chat/completions URL copied from a provider dashboard) can never
      // work - fail fast with the corrected URL to paste.
      const chatPathHint = endpointPathHint(chat.baseUrl);
      if (chatPathHint) {
        return {
          ok: false,
          message: `API base URL misconfigured: ${chatPathHint} and save.`,
        };
      }

      // --- 1. Chat provider ------------------------------------------------
      const chatUrl = providerLabel(chat.baseUrl);
      const chatClient = probeClient(chat);
      try {
        await chatClient.models.list();
      } catch (err) {
        return {
          ok: false,
          message: `Chat endpoint unreachable at ${chatUrl}: ${errMessage(err)}`,
        };
      }
      // models.list is public on some providers (OpenCode Zen), so also send
      // a tiny completion to validate the key and the configured chat model.
      // No optional parameters: reasoning models reject max_tokens/temperature.
      try {
        const model = await getSetting('openai.model');
        await chatClient.chat.completions.create({
          model,
          messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        });
      } catch (err) {
        return {
          ok: false,
          message: `Chat check failed at ${chatUrl}: ${errMessage(err)}`,
        };
      }

      // --- 2. Embedding provider -------------------------------------------
      const embeddingUrl = providerLabel(embedding.baseUrl);
      const embeddingPathHint = endpointPathHint(embedding.baseUrl);
      if (embeddingPathHint) {
        return {
          ok: false,
          message: `Embedding base URL misconfigured: ${embeddingPathHint} and save.`,
        };
      }
      const embeddingBaseUrlSetting = await getSetting(
        'openai.embeddingBaseUrl',
      );
      try {
        const [vector, expectedDims] = await Promise.all([
          embedText('nexus connection test'),
          getEmbeddingDimensions(),
        ]);
        if (vector.length !== expectedDims) {
          return {
            ok: false,
            message: `Embedding model returned ${vector.length}-dimensional vectors but the Embedding dimensions setting is ${expectedDims}. Adjust the setting and re-index your documents, or pick another embedding model.`,
          };
        }
      } catch (err) {
        // Chat-only providers (OpenCode Zen) 404 on the embeddings endpoint.
        // The hint only applies when no separate embedding provider is set,
        // i.e. embeddings were routed to the (chat-only) main provider.
        const chatOnlyHint =
          errStatus(err) === 404 && embeddingBaseUrlSetting === ''
            ? ' The provider does not serve embeddings - set a separate embedding base URL and key for a provider that does (OpenAI, Ollama, ...).'
            : '';
        return {
          ok: false,
          message: `Embedding check failed at ${embeddingUrl}: ${errMessage(err)}.${chatOnlyHint}`,
        };
      }

      return {
        ok: true,
        message:
          embeddingUrl === chatUrl
            ? `Connected to ${chatUrl} - chat and embeddings verified.`
            : `Chat verified at ${chatUrl}; embeddings verified at ${embeddingUrl}.`,
      };
    },
  ),
});
