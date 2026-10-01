import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

import { eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import { settings } from '../db/schema.js';
import { baseUrlEndpointPath, suggestBaseUrl } from '../utils/provider-url.js';

// ---------------------------------------------------------------------------
// Settings registry
//
// Every configurable setting is declared here with its metadata. The UI is
// rendered generically from these definitions (label, type, bounds, group)
// and the effective value is: DB (set from the UI) -> env var -> default.
// ---------------------------------------------------------------------------

export type SettingType =
  'text' | 'textarea' | 'secret' | 'number' | 'slider' | 'select' | 'boolean';

export interface SettingDef {
  key: string;
  label: string;
  description: string;
  type: SettingType;
  env: string | null;
  default: string | number;
  group: 'openai' | 'retrieval' | 'server' | 'auth' | 'ui';
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  /** Input hint shown when the field is empty (text inputs only). */
  placeholder?: string;
}

export const SETTING_DEFS: SettingDef[] = [
  {
    key: 'openai.baseUrl',
    label: 'API base URL',
    description:
      'OpenAI-compatible base URL for chat — any custom endpoint works. Leave empty for OpenAI. Examples: https://opencode.ai/zen/go/v1 (OpenCode Zen Go), http://localhost:11434/v1 (Ollama)',
    type: 'text',
    env: 'OPENAI_BASE_URL',
    default: '',
    group: 'openai',
    placeholder: 'Custom endpoint, e.g. https://opencode.ai/zen/go/v1',
  },
  {
    key: 'openai.apiKey',
    label: 'API key',
    description:
      'API key for the chat provider. Stored encrypted; leave empty to keep the env value.',
    type: 'secret',
    env: 'OPENAI_API_KEY',
    default: '',
    group: 'openai',
  },
  {
    key: 'openai.model',
    label: 'Chat model',
    description: 'Model used for grounded answers.',
    type: 'text',
    env: 'OPENAI_MODEL',
    default: 'gpt-4o-mini',
    group: 'openai',
    placeholder: 'e.g. kimi-k3, gpt-4o-mini',
  },
  {
    key: 'openai.embeddingModel',
    label: 'Embedding model',
    description:
      'Embedding model name at the embedding provider. Must match the dimensions setting below.',
    type: 'text',
    env: 'OPENAI_EMBEDDING_MODEL',
    default: 'text-embedding-3-small',
    group: 'openai',
    placeholder: 'e.g. text-embedding-3-small, nomic-embed-text',
  },
  {
    key: 'openai.embeddingBaseUrl',
    label: 'Embedding base URL',
    description:
      'Custom OpenAI-compatible endpoint for a separate embedding provider (chat-only providers like OpenCode Zen need one). Leave empty to use the main API base URL.',
    type: 'text',
    env: 'OPENAI_EMBEDDING_BASE_URL',
    default: '',
    group: 'openai',
    placeholder: 'e.g. https://api.openai.com/v1 or http://localhost:11434/v1',
  },
  {
    key: 'openai.embeddingApiKey',
    label: 'Embedding API key',
    description:
      'API key for the embedding provider. Stored encrypted; leave empty to use the main API key.',
    type: 'secret',
    env: 'OPENAI_EMBEDDING_API_KEY',
    default: '',
    group: 'openai',
  },
  {
    key: 'embedding.dimensions',
    label: 'Embedding dimensions',
    description:
      'Vector dimensions produced by the embedding model (match the model: 1536 text-embedding-3-small, 768 nomic-embed-text, 1024 bge-m3/mistral-embed, 2560 qwen3-embedding:4b, 3072 text-embedding-3-large). Documents indexed earlier must be re-uploaded after a change.',
    type: 'number',
    env: null,
    default: 1536,
    min: 1,
    max: 16000,
    group: 'openai',
  },
  {
    key: 'openai.temperature',
    label: 'Temperature',
    description: 'LLM sampling temperature for chat.',
    type: 'slider',
    env: 'OPENAI_TEMPERATURE',
    default: 0.2,
    min: 0,
    max: 2,
    step: 0.1,
    group: 'openai',
  },
  {
    key: 'rag.chunkSize',
    label: 'Chunk size',
    description: 'Target characters per indexed chunk.',
    type: 'number',
    env: null,
    default: 1000,
    min: 200,
    max: 4000,
    group: 'retrieval',
  },
  {
    key: 'rag.chunkOverlap',
    label: 'Chunk overlap',
    description: 'Overlap between consecutive chunks (must be < chunk size).',
    type: 'number',
    env: null,
    default: 200,
    min: 0,
    max: 1000,
    group: 'retrieval',
  },
  {
    key: 'rag.topK',
    label: 'Sources retrieved',
    description: 'How many chunks are retrieved per question.',
    type: 'number',
    env: null,
    default: 6,
    min: 1,
    max: 20,
    group: 'retrieval',
  },
  {
    key: 'retrieval.language',
    label: 'Search language',
    description:
      'Full-text search language (PostgreSQL text search config) used for keyword retrieval.',
    type: 'select',
    env: 'RETRIEVAL_LANGUAGE',
    default: 'english',
    group: 'retrieval',
    options: [
      'simple',
      'english',
      'danish',
      'dutch',
      'finnish',
      'french',
      'german',
      'hungarian',
      'italian',
      'norwegian',
      'portuguese',
      'romanian',
      'russian',
      'spanish',
      'swedish',
      'turkish',
      'arabic',
      'greek',
      'hindi',
      'indonesian',
      'irish',
      'japanese',
      'korean',
      'nepali',
      'tamil',
      'thai',
      'catalan',
      'lithuanian',
      'serbian',
    ],
  },
  {
    key: 'rag.profile',
    label: 'Retrieval profile',
    description:
      'Fast: vector + keyword fusion only. Balanced: also rewrites follow-up questions and budgets the context. Thorough: also reranks candidates with the text model.',
    type: 'select',
    env: null,
    default: 'balanced',
    group: 'retrieval',
    options: ['fast', 'balanced', 'thorough'],
  },
  {
    key: 'rag.queryRewrite',
    label: 'Rewrite follow-up questions',
    description:
      'Use the chat model to turn a follow-up into a standalone search query before retrieval (ignored by the Fast profile).',
    type: 'boolean',
    env: null,
    default: 'true',
    group: 'retrieval',
  },
  {
    key: 'rag.rerank',
    label: 'Rerank candidates',
    description:
      'Ask the text model to reorder the top candidates by relevance. Adds one model call per answer; the Thorough profile always enables it.',
    type: 'boolean',
    env: null,
    default: 'false',
    group: 'retrieval',
  },
  {
    key: 'rag.minScore',
    label: 'Minimum vector score',
    description:
      'Drop sources whose vector similarity is below this value (0 disables). Keyword matches are always kept so exact terms still surface.',
    type: 'slider',
    env: null,
    default: 0,
    min: 0,
    max: 1,
    step: 0.05,
    group: 'retrieval',
  },
  {
    key: 'rag.maxContextTokens',
    label: 'Context budget (tokens)',
    description:
      'Maximum estimated tokens of retrieved sources injected into the prompt. Sources beyond the budget are dropped.',
    type: 'number',
    env: null,
    default: 6000,
    min: 500,
    max: 100000,
    group: 'retrieval',
  },
  {
    key: 'job.queryRewrite.model',
    label: 'Query rewrite model',
    description:
      'Model used to rewrite follow-up questions for retrieval. Empty uses the chat model.',
    type: 'text',
    env: null,
    default: '',
    group: 'openai',
    placeholder: 'e.g. a cheap fast model',
  },
  {
    key: 'job.rerank.model',
    label: 'Rerank model',
    description:
      'Model used to rerank retrieval candidates. Empty uses the chat model.',
    type: 'text',
    env: null,
    default: '',
    group: 'openai',
    placeholder: 'e.g. a cheap fast model',
  },
  {
    key: 'rag.similarityWeight',
    label: 'Vector weight',
    description: 'Weight of semantic (vector) similarity in hybrid ranking.',
    type: 'slider',
    env: null,
    default: 0.6,
    min: 0,
    max: 1,
    step: 0.05,
    group: 'retrieval',
  },
  {
    key: 'rag.keywordWeight',
    label: 'Keyword weight',
    description: 'Weight of keyword (full-text) matching in hybrid ranking.',
    type: 'slider',
    env: null,
    default: 0.4,
    min: 0,
    max: 1,
    step: 0.05,
    group: 'retrieval',
  },
  {
    key: 'server.maxUploadMb',
    label: 'Max upload size (MB)',
    description: 'Largest allowed document upload.',
    type: 'number',
    env: 'MAX_UPLOAD_MB',
    default: 25,
    min: 1,
    max: 100,
    group: 'server',
  },
  {
    key: 'auth.sessionTtlDays',
    label: 'Session lifetime (days)',
    description: 'How long login sessions stay valid.',
    type: 'number',
    env: 'SESSION_TTL_DAYS',
    default: 30,
    min: 1,
    max: 365,
    group: 'auth',
  },
  {
    key: 'prompt.system',
    label: 'System prompt',
    description:
      'Instructions prepended to every chat request. Leave empty for the built-in default.',
    type: 'textarea',
    env: 'PROMPT_SYSTEM',
    default: '',
    group: 'ui',
    max: 4000,
  },
  {
    key: 'ui.appName',
    label: 'App name',
    description: 'Name shown in the sidebar and browser title.',
    type: 'text',
    env: null,
    default: 'Nexus',
    max: 40,
    group: 'ui',
  },
];

const defByKey = new Map(SETTING_DEFS.map((d) => [d.key, d]));

/** True when the key is declared as a secret setting in the registry. */
export function isSecretSetting(key: string): boolean {
  return defByKey.get(key)?.type === 'secret';
}

// ---------------------------------------------------------------------------
// Read cache
//
// getSetting() is called several times per chat message and per worker job
// (model, temperature, baseUrl, chunk size, dimensions, ...). A short TTL
// cache avoids the Postgres round-trip on the hot path while keeping runtime
// edits visible within a few seconds; updateSetting() invalidates the key
// immediately so UI saves apply instantly. Secrets are cached decrypted for
// the same TTL - no worse than the previous per-call in-memory decryption.
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5_000;

const settingCache = new Map<string, { value: string; at: number }>();

/** Forget cached values for one key, or the whole cache when omitted. */
export function invalidateSettingsCache(key?: string): void {
  if (key) {
    settingCache.delete(key);
  } else {
    settingCache.clear();
  }
}

function readCachedSetting(key: string): string | null {
  const hit = settingCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at >= CACHE_TTL_MS) {
    settingCache.delete(key);
    return null;
  }
  return hit.value;
}

// ---------------------------------------------------------------------------
// Secret encryption (AES-256-GCM, key from SETTINGS_SECRET env)
// ---------------------------------------------------------------------------

export function encryptionKeyConfigured(): boolean {
  return Boolean(process.env.SETTINGS_SECRET);
}

function encryptionKey(): Buffer {
  const secret = process.env.SETTINGS_SECRET;
  if (!secret) {
    throw new Error(
      'SETTINGS_SECRET is not set - add it to .env to manage secret settings (e.g. the OpenAI API key) from the UI',
    );
  }
  return createHash('sha256').update(secret).digest();
}

export function encryptSecret(value: string): string {
  const key = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted setting');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return plain.toString('utf8');
}

/** `sk-…wxyz` style masking: first 3 chars + last 4. */
export function maskSecret(value: string): string {
  if (value.length <= 7) return '••••••';
  return `${value.slice(0, 3)}…${value.slice(-4)}`;
}

/** The .env.example placeholder is not a real key - never present it as one. */
const PLACEHOLDER_API_KEY = 'sk-your-key-here';

function isRealSecret(value: string): boolean {
  return Boolean(value) && value !== PLACEHOLDER_API_KEY;
}

// ---------------------------------------------------------------------------
// Reads / writes
// ---------------------------------------------------------------------------

export interface EffectiveSetting {
  key: string;
  value: string;
  source: 'ui' | 'env';
  isSecret: boolean;
}

/** Raw DB row for a setting, if any. */
async function getDbRow(
  key: string,
): Promise<{ value: string; isSecret: boolean } | null> {
  const [row] = await db
    .select({ value: settings.value, isSecret: settings.isSecret })
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  return row ?? null;
}

/** Env var (when set and non-empty) or registry default for a key. */
function fallbackValue(def: SettingDef): string {
  const envValue = def.env ? process.env[def.env] : undefined;
  if (envValue !== undefined && envValue !== '') return envValue;
  return String(def.default);
}

/** Resolve the effective (raw, decrypted) value for a key. */
export async function getSetting(key: string): Promise<string> {
  const def = defByKey.get(key);
  if (!def) throw new Error(`Unknown setting: ${key}`);

  const cached = readCachedSetting(key);
  if (cached !== null) return cached;

  const row = await getDbRow(key);
  let resolved: string;
  if (!row) {
    resolved = fallbackValue(def);
  } else if (!row.isSecret) {
    resolved = row.value;
  } else {
    try {
      resolved = decryptSecret(row.value);
    } catch {
      // SETTINGS_SECRET missing or rotated: degrade to the env/default value
      // (the settings UI flags the unreadable row for re-entry) instead of
      // throwing a crypto error into chat and embedding calls.
      resolved = fallbackValue(def);
    }
  }

  settingCache.set(key, { value: resolved, at: Date.now() });
  return resolved;
}

/** Number-typed convenience accessor. */
export async function getSettingNumber(key: string): Promise<number> {
  const value = Number(await getSetting(key));
  if (Number.isNaN(value)) {
    throw new Error(`Setting ${key} is not a number: ${await getSetting(key)}`);
  }
  return value;
}

/** Boolean-typed convenience accessor ('true'/'false' settings). */
export async function getSettingBoolean(key: string): Promise<boolean> {
  return (await getSetting(key)) === 'true';
}

export interface SettingView {
  key: string;
  def: SettingDef;
  value: string;
  source: 'ui' | 'env';
  /** Masked value for secrets; raw for everything else. */
  displayValue: string;
  secretConfigured: boolean;
  /** Stored secret exists but cannot be decrypted (SETTINGS_SECRET changed). */
  decryptionFailed: boolean;
}

/** Full listing for the settings UI (secrets never sent in full). */
export async function listSettings(): Promise<SettingView[]> {
  const rows = await db.select().from(settings);
  const byKey = new Map(rows.map((r) => [r.key, r]));

  return SETTING_DEFS.map((def) => {
    const row = byKey.get(def.key);
    if (row) {
      let raw = '';
      let decryptionFailed = false;
      if (row.isSecret) {
        try {
          raw = decryptSecret(row.value);
        } catch {
          // One unreadable row must not take down the whole settings page.
          decryptionFailed = true;
        }
      } else {
        raw = row.value;
      }
      return {
        key: def.key,
        def,
        // Secrets stay server-side: the client only ever sees a mask.
        value: row.isSecret ? '' : raw,
        source: 'ui' as const,
        displayValue:
          row.isSecret && !decryptionFailed && isRealSecret(raw)
            ? maskSecret(raw)
            : '',
        secretConfigured: encryptionKeyConfigured(),
        decryptionFailed,
      };
    }
    const envValue = def.env ? process.env[def.env] : undefined;
    const fromEnv =
      envValue !== undefined &&
      envValue !== '' &&
      !(def.type === 'secret' && !isRealSecret(envValue));
    const value = fromEnv ? (envValue as string) : String(def.default);
    return {
      key: def.key,
      def,
      value: def.type === 'secret' ? '' : value,
      source: fromEnv ? ('env' as const) : ('ui' as const),
      displayValue:
        def.type === 'secret' && fromEnv ? maskSecret(value) : value,
      secretConfigured: encryptionKeyConfigured(),
      decryptionFailed: false,
    };
  });
}

/** Type validation / clamping for one raw (non-empty) value. */
function normalizeSettingValue(def: SettingDef, value: string): string {
  let stored = value;
  if (def.key === 'openai.baseUrl' || def.key === 'openai.embeddingBaseUrl') {
    // A base URL that already contains an endpoint path can never work:
    // Nexus (like the OpenAI SDK) appends /chat/completions, /models, ...
    // itself, so the full endpoint URL pasted from a provider dashboard
    // would double the path. Reject with the corrected URL to paste.
    const endpointPath = baseUrlEndpointPath(value);
    if (endpointPath) {
      throw new Error(
        `${def.label} points at the ${endpointPath} endpoint itself — Nexus appends the API paths (e.g. /chat/completions, /models) itself. Use ${suggestBaseUrl(value)} instead.`,
      );
    }
  }
  if (def.type === 'select' && def.options && !def.options.includes(value)) {
    throw new Error(`${def.label} must be one of: ${def.options.join(', ')}`);
  }
  if (def.type === 'boolean' && value !== 'true' && value !== 'false') {
    throw new Error(`${def.label} must be true or false`);
  }
  if (def.type === 'number' || def.type === 'slider') {
    const num = Number(value);
    if (Number.isNaN(num)) {
      throw new Error(`${def.label} must be a number`);
    }
    stored = String(Math.min(def.max ?? num, Math.max(def.min ?? num, num)));
  }
  if (def.type === 'text' && def.max && stored.length > def.max) {
    throw new Error(`${def.label} must be at most ${def.max} characters`);
  }
  return stored;
}

/** Effective value after a save, treating '' as "reset to env/default". */
function effectiveValue(def: SettingDef, stored: string): string {
  return stored === '' ? fallbackValue(def) : stored;
}

/**
 * Chunk size and overlap are one invariant (overlap < size), so validating
 * only the field being saved allowed invalid pairs depending on save order.
 * Both sides are checked against the post-save effective values.
 */
async function assertChunkPairValid(
  effective: Map<string, string>,
): Promise<void> {
  if (!effective.has('rag.chunkSize') && !effective.has('rag.chunkOverlap')) {
    return;
  }
  const size = Number(
    effective.get('rag.chunkSize') ?? (await getSetting('rag.chunkSize')),
  );
  const overlap = Number(
    effective.get('rag.chunkOverlap') ?? (await getSetting('rag.chunkOverlap')),
  );
  if (Number.isFinite(size) && Number.isFinite(overlap) && overlap >= size) {
    throw new Error('Chunk overlap must be smaller than chunk size');
  }
}

/** Insert/update one setting; an empty stored value deletes the row. */
async function persistSetting(
  key: string,
  stored: string,
  isSecret: boolean,
): Promise<void> {
  if (stored === '') {
    await db.delete(settings).where(eq(settings.key, key));
  } else {
    const value = isSecret ? encryptSecret(stored) : stored;
    await db
      .insert(settings)
      .values({ key, value, isSecret })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, isSecret, updatedAt: new Date() },
      });
  }
  invalidateSettingsCache(key);
}

/**
 * Validate + persist a batch of settings atomically from the caller's point
 * of view: nothing is written when any value (or the chunk size/overlap pair
 * formed by the batch) is invalid. Empty values reset a key to its default.
 */
export async function updateSettings(
  values: Record<string, string>,
): Promise<SettingView[]> {
  const entries = Object.entries(values);
  if (entries.length === 0) return [];

  const normalized = new Map<string, { def: SettingDef; stored: string }>();
  for (const [key, rawValue] of entries) {
    const def = defByKey.get(key);
    if (!def) throw new Error(`Unknown setting: ${key}`);
    const value = rawValue.trim();
    normalized.set(key, {
      def,
      stored: value === '' ? '' : normalizeSettingValue(def, value),
    });
  }

  const effective = new Map<string, string>();
  for (const [key, { def, stored }] of normalized) {
    effective.set(key, effectiveValue(def, stored));
  }
  await assertChunkPairValid(effective);

  for (const [key, { def, stored }] of normalized) {
    await persistSetting(key, stored, def.type === 'secret');
  }

  const all = await listSettings();
  return all.filter((s) => normalized.has(s.key));
}

/** Validate + persist one setting; empty value deletes the row (reset to default). */
export async function updateSetting(
  key: string,
  rawValue: string,
): Promise<SettingView> {
  const [view] = await updateSettings({ [key]: rawValue });
  if (!view) throw new Error(`Unknown setting: ${key}`);
  return view;
}

/** Secret values cannot be stored when SETTINGS_SECRET is missing. */
export function assertSecretsAvailable(): void {
  if (!encryptionKeyConfigured()) {
    throw new Error(
      'SETTINGS_SECRET is not set - add it to .env to manage secret settings (e.g. the OpenAI API key) from the UI',
    );
  }
}
