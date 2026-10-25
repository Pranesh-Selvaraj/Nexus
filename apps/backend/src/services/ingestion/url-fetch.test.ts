import { createServer, type Server } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import {
  fetchArticle,
  fetchResource,
  isBlockedAddress,
  parseSafeUrl,
  resolvePublicAddresses,
  UnsafeUrlError,
} from './url-fetch.js';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

async function serve(
  handler: (
    request: import('node:http').IncomingMessage,
    response: import('node:http').ServerResponse,
  ) => void,
): Promise<{ base: string; requests: () => number }> {
  let requests = 0;
  const server = createServer((request, response) => {
    requests += 1;
    handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { base: `http://127.0.0.1:${port}`, requests: () => requests };
}

const ARTICLE = `<html><head><title>Retrieval notes</title></head><body><article>
<h1>Retrieval notes</h1>
<p>Hybrid retrieval fuses vector similarity with keyword search so that
paraphrases and exact terminology both surface, and a reciprocal rank fusion
step rewards passages that both retrieval arms agree on.</p>
<p>Chunking, embeddings and a full-text index are the three ingredients a
grounded answer needs before the model is even called.</p>
</article></body></html>`;

describe('SSRF address classification', () => {
  it('blocks private, loopback, link-local and metadata IPv4 ranges', () => {
    for (const address of [
      '0.0.0.0',
      '10.1.2.3',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '192.0.2.10',
      '198.18.0.1',
      '198.51.100.1',
      '203.0.113.1',
      '224.0.0.1',
      '255.255.255.255',
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it('allows public IPv4 addresses', () => {
    for (const address of [
      '1.1.1.1',
      '8.8.8.8',
      '93.184.216.34',
      '172.32.0.1',
    ]) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });

  it('blocks IPv6 loopback, link-local, unique-local, multicast and mapped forms', () => {
    for (const address of [
      '::',
      '::1',
      'fe80::1',
      'fd00::1',
      'fc00::1',
      'ff02::1',
      '2001:db8::1',
      '::ffff:127.0.0.1',
      '::ffff:169.254.169.254',
      '64:ff9b::7f00:1',
      '64:ff9b::a9fe:a9fe',
      '2002:7f00:0001::1',
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it('allows public IPv6 addresses', () => {
    expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false);
    expect(isBlockedAddress('64:ff9b::5db8:d822')).toBe(false);
  });

  it('treats unparseable input as blocked', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true);
    expect(isBlockedAddress('')).toBe(true);
  });
});

describe('URL validation', () => {
  it('accepts http(s) URLs and rejects other schemes or credentials', () => {
    expect(parseSafeUrl('https://example.com/article').hostname).toBe(
      'example.com',
    );
    for (const bad of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'ftp://example.com/x',
      'https://user:pass@example.com/',
      'not a url',
    ]) {
      expect(() => parseSafeUrl(bad), bad).toThrow(UnsafeUrlError);
    }
  });

  it('rejects a private address literal before any request', async () => {
    await expect(resolvePublicAddresses('127.0.0.1')).rejects.toThrow(
      /private or link-local/,
    );
    await expect(resolvePublicAddresses('169.254.169.254')).rejects.toThrow(
      /private or link-local/,
    );
    const addresses = await resolvePublicAddresses('127.0.0.1', {
      allowPrivate: true,
    });
    expect(addresses[0]?.address).toBe('127.0.0.1');
  });
});

describe('fetching with guards', () => {
  it('refuses a loopback server without the explicit test override', async () => {
    const { base, requests } = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(ARTICLE);
    });
    await expect(fetchArticle(base)).rejects.toThrow(/private or link-local/);
    // The guard runs before the socket, so the server never sees a request.
    expect(requests()).toBe(0);
  });

  it('extracts an article from an allowed host and follows relative redirects', async () => {
    const { base } = await serve((request, response) => {
      if (request.url === '/start') {
        response.writeHead(302, { location: '/article' });
        response.end();
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(ARTICLE);
    });
    const result = await fetchArticle(`${base}/start`, { allowPrivate: true });
    expect(result.article.title).toBe('Retrieval notes');
    expect(result.article.text).toContain('reciprocal rank fusion');
    expect(result.finalUrl).toBe(`${base}/article`);
  });

  it('caps redirects', async () => {
    const { base } = await serve((_request, response) => {
      response.writeHead(302, { location: '/loop' });
      response.end();
    });
    await expect(
      fetchResource(`${base}/loop`, { allowPrivate: true, maxRedirects: 2 }),
    ).rejects.toThrow(/redirected more than 2 times/);
  });

  it('caps the response size while streaming', async () => {
    const { base } = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('x'.repeat(20_000));
    });
    await expect(
      fetchResource(base, { allowPrivate: true, maxBytes: 1024 }),
    ).rejects.toThrow(/larger than the/);
  });

  it('rejects non-HTML responses and empty pages', async () => {
    const binary = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.end(Buffer.from([0, 1, 2, 3]));
    });
    await expect(
      fetchArticle(binary.base, { allowPrivate: true }),
    ).rejects.toThrow(/not a web page/);

    const thin = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<html><body><p>tiny</p></body></html>');
    });
    await expect(
      fetchArticle(thin.base, { allowPrivate: true }),
    ).rejects.toThrow(/too little readable text/);
  });

  it('surfaces non-2xx responses and timeouts', async () => {
    const failing = await serve((_request, response) => {
      response.writeHead(500, { 'content-type': 'text/html' });
      response.end('<h1>oops</h1>');
    });
    await expect(
      fetchResource(failing.base, { allowPrivate: true }),
    ).rejects.toThrow(/HTTP 500/);

    const slow = await serve(() => {
      // Never respond: the abort signal must fire.
    });
    await expect(
      fetchResource(slow.base, { allowPrivate: true, timeoutMs: 150 }),
    ).rejects.toThrow(/Could not fetch the page/);
  });
});
