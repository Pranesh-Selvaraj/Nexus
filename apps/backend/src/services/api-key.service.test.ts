import { describe, expect, it } from 'vitest';

import {
  API_KEY_NAMESPACE,
  hasScope,
  hashApiKey,
  isApiKeyFormat,
  knownScopes,
} from './api-key.service.js';

describe('isApiKeyFormat', () => {
  it('accepts a well-formed key', () => {
    expect(
      isApiKeyFormat(`${API_KEY_NAMESPACE}abcdef012345_${'A'.repeat(43)}`),
    ).toBe(true);
  });

  it('rejects keys without the namespace, prefix or secret', () => {
    expect(isApiKeyFormat('')).toBe(false);
    expect(isApiKeyFormat(`${'A'.repeat(43)}`)).toBe(false);
    expect(isApiKeyFormat('ndx_abcdef012345')).toBe(false);
    expect(isApiKeyFormat('ndx_abc_def')).toBe(false);
    expect(isApiKeyFormat(`sk_abcdef012345_${'A'.repeat(43)}`)).toBe(false);
  });

  it('rejects a key whose secret contains separators or spaces', () => {
    expect(
      isApiKeyFormat(`ndx_abcdef012345_${'A'.repeat(20)} ${'A'.repeat(23)}`),
    ).toBe(false);
    expect(
      isApiKeyFormat(`ndx_abcdef012345_${'A'.repeat(20)}.${'A'.repeat(22)}`),
    ).toBe(false);
  });
});

describe('hashApiKey', () => {
  it('is deterministic and hides the secret', () => {
    const key = `ndx_abcdefgh_${'A'.repeat(43)}`;
    const hash = hashApiKey(key);
    expect(hash).toBe(hashApiKey(key));
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain('abcdef012345');
    expect(hash).not.toContain('AAAA');
  });

  it('differs for keys that differ by one character', () => {
    const a = `ndx_abcdef012345_${'A'.repeat(43)}`;
    const b = `ndx_abcdef012345_${'A'.repeat(42)}B`;
    expect(hashApiKey(a)).not.toBe(hashApiKey(b));
  });
});

describe('knownScopes', () => {
  it('keeps supported scopes in order and drops unknown ones', () => {
    expect(knownScopes(['search', 'admin', 'ask', 'documents:read'])).toEqual([
      'search',
      'ask',
      'documents:read',
    ]);
  });

  it('returns an empty list when nothing is recognised', () => {
    expect(knownScopes(['root', ''])).toEqual([]);
  });
});

describe('hasScope', () => {
  const identity = { scopes: ['search', 'documents:read'] as const };

  it('matches an exact granted scope', () => {
    expect(hasScope({ scopes: [...identity.scopes] }, 'search')).toBe(true);
    expect(hasScope({ scopes: [...identity.scopes] }, 'documents:read')).toBe(
      true,
    );
  });

  it('does not treat a name prefix as a grant', () => {
    // `documents:read` must not satisfy a different documents permission, and
    // a granted search scope is not a granted ask scope.
    expect(hasScope({ scopes: ['documents:read'] }, 'ask')).toBe(false);
    expect(hasScope({ scopes: ['search'] }, 'ask')).toBe(false);
  });
});
