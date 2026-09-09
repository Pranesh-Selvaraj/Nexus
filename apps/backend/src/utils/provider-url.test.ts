import { describe, expect, it } from 'vitest';

import { baseUrlEndpointPath, suggestBaseUrl } from './provider-url.js';

describe('baseUrlEndpointPath', () => {
  it('detects mistakenly appended endpoint paths', () => {
    for (const path of [
      '/chat/completions',
      '/embeddings',
      '/models',
      '/responses',
      '/messages',
    ]) {
      expect(baseUrlEndpointPath(`https://x.example/v1${path}`)).toBe(path);
    }
  });

  it('ignores clean base URLs', () => {
    expect(baseUrlEndpointPath('https://opencode.ai/zen/go/v1')).toBeNull();
    expect(baseUrlEndpointPath('http://localhost:11434/v1')).toBeNull();
    expect(baseUrlEndpointPath('')).toBeNull();
  });

  it('is insensitive to trailing slashes', () => {
    expect(baseUrlEndpointPath('https://x.example/v1/chat/completions/')).toBe(
      '/chat/completions',
    );
  });

  it('does not false-positive on paths merely containing the suffix', () => {
    // .../v1/my-models must not count as .../models
    expect(baseUrlEndpointPath('https://x.example/v1/my-models')).toBeNull();
  });
});

describe('suggestBaseUrl', () => {
  it('strips the appended endpoint path', () => {
    expect(
      suggestBaseUrl('https://opencode.ai/zen/go/v1/chat/completions'),
    ).toBe('https://opencode.ai/zen/go/v1');
  });

  it('leaves clean base URLs untouched', () => {
    expect(suggestBaseUrl('https://opencode.ai/zen/go/v1')).toBe(
      'https://opencode.ai/zen/go/v1',
    );
  });
});
