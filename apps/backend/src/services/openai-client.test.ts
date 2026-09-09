import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  clearOpenAIClientCache,
  getOpenAIClient,
  resolveProviderConfig,
} from './openai-client.js';

vi.mock('./settings.service.js', () => ({
  getSetting: vi.fn(async (key: string) =>
    key === 'openai.apiKey' ? 'sk-test' : '',
  ),
}));

const openaiCtor = vi.hoisted(() => vi.fn());
vi.mock('openai', () => ({ default: openaiCtor }));

const main = { apiKey: 'sk-main', baseUrl: 'https://main.example/v1' };
const embedding = {
  apiKey: 'sk-embedding',
  baseUrl: 'https://embedding.example/v1',
};

describe('getOpenAIClient identity headers', () => {
  beforeEach(() => {
    openaiCtor.mockClear();
    clearOpenAIClientCache();
  });

  it('identifies Nexus with its own user agent and a stable session id', async () => {
    await getOpenAIClient('chat');

    expect(openaiCtor).toHaveBeenCalledTimes(1);
    const options = openaiCtor.mock.calls[0]?.[0] as {
      defaultHeaders: Record<string, string>;
    };
    expect(options.defaultHeaders['User-Agent']).toMatch(/^nexus\//);
    expect(options.defaultHeaders['x-opencode-session']).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });

  it('reuses the cached client (one construction, stable session id)', async () => {
    await getOpenAIClient('chat');
    await getOpenAIClient('chat');

    expect(openaiCtor).toHaveBeenCalledTimes(1);
  });
});

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
