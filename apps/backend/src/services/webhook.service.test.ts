import { afterEach, describe, expect, it, vi } from 'vitest';

import { assertWebhookTarget } from './webhook.service.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('assertWebhookTarget', () => {
  it('accepts a public https URL', async () => {
    const url = await assertWebhookTarget('https://example.com/hooks/nexus');
    expect(url.hostname).toBe('example.com');
  });

  it('rejects non-http protocols', async () => {
    await expect(assertWebhookTarget('file:///etc/passwd')).rejects.toThrow(
      /http/i,
    );
    await expect(assertWebhookTarget('ftp://example.com/hook')).rejects.toThrow(
      /http/i,
    );
  });

  it('rejects URLs with embedded credentials', async () => {
    await expect(
      assertWebhookTarget('https://user:pass@example.com/hook'),
    ).rejects.toThrow(/credentials/i);
  });

  it('refuses loopback and private targets by default', async () => {
    await expect(
      assertWebhookTarget('http://127.0.0.1:9999/hook'),
    ).rejects.toThrow(/private|link-local/i);
    await expect(assertWebhookTarget('http://10.0.0.5/hook')).rejects.toThrow(
      /private|link-local/i,
    );
    await expect(
      assertWebhookTarget('http://169.254.169.254/latest/meta-data'),
    ).rejects.toThrow(/private|link-local/i);
  });

  it('honours the local-testing override', async () => {
    vi.stubEnv('WEBHOOK_ALLOW_PRIVATE_HOSTS', 'true');
    const url = await assertWebhookTarget('http://127.0.0.1:9999/hook');
    expect(url.port).toBe('9999');
  });
});
