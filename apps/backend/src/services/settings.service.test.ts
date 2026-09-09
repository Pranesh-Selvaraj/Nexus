import { beforeAll, describe, expect, it } from 'vitest';

import {
  decryptSecret,
  encryptSecret,
  maskSecret,
  SETTING_DEFS,
  updateSetting,
} from './settings.service.js';

describe('settings registry', () => {
  it('has unique keys and defined bounds', () => {
    const keys = SETTING_DEFS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);

    for (const def of SETTING_DEFS) {
      if (def.type === 'number' || def.type === 'slider') {
        expect(def.min).toBeDefined();
        expect(def.max).toBeDefined();
        expect(Number(def.default)).toBeGreaterThanOrEqual(def.min as number);
        expect(Number(def.default)).toBeLessThanOrEqual(def.max as number);
        if (def.type === 'slider') expect(def.step).toBeDefined();
      }
    }
  });

  it('covers every settings group', () => {
    const groups = new Set(SETTING_DEFS.map((d) => d.group));
    expect(groups).toEqual(
      new Set(['openai', 'retrieval', 'server', 'auth', 'ui']),
    );
  });

  it('declares an optional separate embedding provider', () => {
    const baseUrl = SETTING_DEFS.find(
      (d) => d.key === 'openai.embeddingBaseUrl',
    );
    expect(baseUrl?.type).toBe('text');
    expect(baseUrl?.env).toBe('OPENAI_EMBEDDING_BASE_URL');
    expect(baseUrl?.default).toBe('');
    expect(baseUrl?.group).toBe('openai');

    const apiKey = SETTING_DEFS.find((d) => d.key === 'openai.embeddingApiKey');
    expect(apiKey?.type).toBe('secret');
    expect(apiKey?.env).toBe('OPENAI_EMBEDDING_API_KEY');
    expect(apiKey?.default).toBe('');
    expect(apiKey?.group).toBe('openai');
  });

  it('rejects base URLs that contain an endpoint path', async () => {
    // Nexus appends /chat/completions, /models etc. itself - a full endpoint
    // URL pasted from a provider dashboard must be rejected with the
    // corrected base URL. These throw before any DB access.
    await expect(
      updateSetting(
        'openai.baseUrl',
        'https://opencode.ai/zen/go/v1/chat/completions',
      ),
    ).rejects.toThrow('https://opencode.ai/zen/go/v1');
    await expect(
      updateSetting(
        'openai.embeddingBaseUrl',
        'https://api.openai.com/v1/embeddings',
      ),
    ).rejects.toThrow('https://api.openai.com/v1');
  });
});

describe('secret encryption', () => {
  beforeAll(() => {
    process.env.SETTINGS_SECRET = 'unit-test-secret';
  });

  it('round-trips through AES-256-GCM', () => {
    const payload = encryptSecret('sk-test-1234567890');
    expect(payload.startsWith('v1:')).toBe(true);
    expect(payload).not.toContain('sk-test');
    expect(decryptSecret(payload)).toBe('sk-test-1234567890');
  });

  it('produces different ciphertext for the same value (random IV)', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
  });

  it('rejects tampered payloads', () => {
    const payload = encryptSecret('secret');
    const tampered =
      payload.slice(0, -2) + (payload.endsWith('==') ? 'AA' : 'x');
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('rejects malformed payloads', () => {
    expect(() => decryptSecret('garbage')).toThrow('Malformed');
  });
});

describe('maskSecret', () => {
  it('masks long values with head + tail', () => {
    expect(maskSecret('sk-proj-abcdefghijklmnop')).toBe('sk-…mnop');
  });

  it('fully masks short values', () => {
    expect(maskSecret('abc')).toBe('••••••');
  });
});
