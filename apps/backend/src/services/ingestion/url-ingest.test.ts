import { createServer, type Server } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { ingestUrlContent, slugifyTitle } from './url-ingest.js';

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

async function serve(html: string): Promise<string> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return `http://127.0.0.1:${port}/articles/retrieval`;
}

describe('URL ingestion', () => {
  it('extracts an article into a Markdown document with provenance', async () => {
    const url = await serve(`<html><head><title>Hybrid Retrieval</title>
      <meta name="author" content="Ada" /></head><body><article>
      <h1>Hybrid Retrieval</h1>
      <p>Vector similarity finds paraphrases, keyword search finds exact terms,
      and reciprocal rank fusion combines the two ranked lists into one.</p>
      <p>Chunking and embeddings make the corpus searchable before generation.</p>
      </article></body></html>`);
    const result = await ingestUrlContent(url, { allowPrivate: true });
    expect(result.kind).toBe('article');
    expect(result.title).toBe('Hybrid Retrieval');
    expect(result.sourceUrl).toBe(url);
    expect(result.markdown).toContain('reciprocal rank fusion');
    expect(result.metadata.kind).toBe('web');
    expect(result.metadata.author).toBe('Ada');
    expect(result.metadata.fetchedAt).toBeTypeOf('string');
    expect(result.metadata.wordCount).toBeGreaterThan(10);
    expect(result.fileName).toMatch(/\.md$/);
  });

  it('slugifies titles safely for display names', () => {
    expect(slugifyTitle('Hybrid Retrieval: Explained!')).toBe(
      'hybrid-retrieval-explained',
    );
    expect(slugifyTitle('   ')).toBe('ingested');
    expect(slugifyTitle('日本語のテキスト')).toBe('日本語のテキスト');
    expect(slugifyTitle('a/b\\c')).toBe('a-b-c');
  });
});
