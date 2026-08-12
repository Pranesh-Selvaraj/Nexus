import { beforeAll, describe, expect, it } from 'vitest';

import {
  decryptSecret,
  encryptSecret,
  maskSecret,
  SETTING_DEFS,
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
