import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

import { eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import { settings } from '../db/schema.js';

// ---------------------------------------------------------------------------
// Settings registry
//
// Every configurable setting is declared here with its metadata. The UI is
// rendered generically from these definitions (label, type, bounds, group)
// and the effective value is: DB (set from the UI) -> env var -> default.
// ---------------------------------------------------------------------------

export type SettingType =
  'text' | 'textarea' | 'secret' | 'number' | 'slider' | 'select';

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
}

export const SETTING_DEFS: SettingDef[] = [
  {
    key: 'openai.baseUrl',
    label: 'API base URL',
    description:
      'OpenAI-compatible base URL. Leave empty for OpenAI. Examples: http://localhost:11434/v1 (Ollama), https://openrouter.ai/api/v1',
    type: 'text',
    env: 'OPENAI_BASE_URL',
    default: '',
    group: 'openai',
  },
  {
    key: 'openai.apiKey',
    label: 'API key',
    description:
      'OpenAI API key. Stored encrypted; leave empty to keep the env value.',
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
  },
  {
    key: 'openai.embeddingModel',
    label: 'Embedding model',
    description:
      'Must produce 1536-dimension vectors (schema is vector(1536)).',
    type: 'text',
    env: 'OPENAI_EMBEDDING_MODEL',
    default: 'text-embedding-3-small',
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

/** Resolve the effective (raw, decrypted) value for a key. */
export async function getSetting(key: string): Promise<string> {
  const def = defByKey.get(key);
  if (!def) throw new Error(`Unknown setting: ${key}`);

  const row = await getDbRow(key);
  if (row) {
    return row.isSecret ? decryptSecret(row.value) : row.value;
  }
  const envValue = def.env ? process.env[def.env] : undefined;
  if (envValue !== undefined && envValue !== '') return envValue;
  return String(def.default);
}

/** Number-typed convenience accessor. */
export async function getSettingNumber(key: string): Promise<number> {
  const value = Number(await getSetting(key));
  if (Number.isNaN(value)) {
    throw new Error(`Setting ${key} is not a number: ${await getSetting(key)}`);
  }
  return value;
}

export interface SettingView {
  key: string;
  def: SettingDef;
  value: string;
  source: 'ui' | 'env';
  /** Masked value for secrets; raw for everything else. */
  displayValue: string;
  secretConfigured: boolean;
}

/** Full listing for the settings UI (secrets masked). */
export async function listSettings(): Promise<SettingView[]> {
  const rows = await db.select().from(settings);
  const byKey = new Map(rows.map((r) => [r.key, r]));

  return SETTING_DEFS.map((def) => {
    const row = byKey.get(def.key);
    if (row) {
      const raw = row.isSecret ? decryptSecret(row.value) : row.value;
      return {
        key: def.key,
        def,
        value: raw,
        source: 'ui' as const,
        displayValue: row.isSecret ? maskSecret(raw) : raw,
        secretConfigured: encryptionKeyConfigured(),
      };
    }
    const envValue = def.env ? process.env[def.env] : undefined;
    const fromEnv = envValue !== undefined && envValue !== '';
    const value = fromEnv ? (envValue as string) : String(def.default);
    return {
      key: def.key,
      def,
      value,
      source: fromEnv ? ('env' as const) : ('ui' as const),
      displayValue: def.type === 'secret' && value ? maskSecret(value) : value,
      secretConfigured: encryptionKeyConfigured(),
    };
  });
}

/** Validate + persist one setting; empty value deletes the row (reset to default). */
export async function updateSetting(
  key: string,
  rawValue: string,
): Promise<SettingView> {
  const def = defByKey.get(key);
  if (!def) throw new Error(`Unknown setting: ${key}`);

  const value = rawValue.trim();

  // Empty input -> reset to default (env or registry default)
  if (value === '') {
    await db.delete(settings).where(eq(settings.key, key));
    return (await listSettings()).find((s) => s.key === key) as SettingView;
  }

  // Type validation / clamping
  let stored = value;
  if (def.type === 'select' && def.options && !def.options.includes(value)) {
    throw new Error(`${def.label} must be one of: ${def.options.join(', ')}`);
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
  if (def.key === 'rag.chunkOverlap') {
    const chunkSize = Number(await getSetting('rag.chunkSize'));
    if (Number(stored) >= chunkSize) {
      throw new Error('Chunk overlap must be smaller than chunk size');
    }
  }

  const isSecret = def.type === 'secret';
  await db
    .insert(settings)
    .values({
      key,
      value: isSecret ? encryptSecret(stored) : stored,
      isSecret,
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: {
        value: isSecret ? encryptSecret(stored) : stored,
        isSecret,
        updatedAt: new Date(),
      },
    });

  return (await listSettings()).find((s) => s.key === key) as SettingView;
}

/** Secret values cannot be stored when SETTINGS_SECRET is missing. */
export function assertSecretsAvailable(): void {
  if (!encryptionKeyConfigured()) {
    throw new Error(
      'SETTINGS_SECRET is not set - add it to .env to manage secret settings (e.g. the OpenAI API key) from the UI',
    );
  }
}
