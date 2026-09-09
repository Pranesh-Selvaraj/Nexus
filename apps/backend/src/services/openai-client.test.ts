import { describe, expect, it } from 'vitest';

import { resolveProviderConfig } from './openai-client.js';

const main = { apiKey: 'sk-main', baseUrl: 'https://main.example/v1' };
const embedding = {
  apiKey: 'sk-embedding',
  baseUrl: 'https://embedding.example/v1',
};

describe('resolveProviderConfig', () => {
  it('chat always uses the main provider config', () => {
    expect(resolveProviderConfig('chat', main, embedding)).toEqual(main);
  });

  it('embedding prefers dedicated embedding settings', () => {
    expect(resolveProviderConfig('embedding', main, embedding)).toEqual({
      apiKey: 'sk-embedding',
      baseUrl: 'https://embedding.example/v1',
    });
  });

  it('embedding falls back to the main provider when unset', () => {
    expect(
      resolveProviderConfig('embedding', main, {
        apiKey: '',
        baseUrl: '',
      }),
    ).toEqual(main);
  });

  it('empty-string embedding values never shadow the main provider', () => {
    // e.g. main = OpenCode Zen (chat-only), embedding key set but no URL
    const zenMain = { apiKey: 'sk-zen', baseUrl: 'https://opencode.ai/zen/v1' };
    expect(
      resolveProviderConfig('embedding', zenMain, {
        apiKey: 'sk-openai',
        baseUrl: '',
      }),
    ).toEqual({
      apiKey: 'sk-openai',
      baseUrl: 'https://opencode.ai/zen/v1',
    });
  });

  it('partial fallbacks mix per-field (key from one, URL from the other)', () => {
    expect(
      resolveProviderConfig('embedding', main, {
        apiKey: '',
        baseUrl: 'https://embedding.example/v1',
      }),
    ).toEqual({
      apiKey: 'sk-main',
      baseUrl: 'https://embedding.example/v1',
    });
  });
});
