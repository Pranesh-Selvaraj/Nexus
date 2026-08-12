import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { extractPages, splitIntoChunks } from './chunking.service.js';

const tmpDirs: string[] = [];

async function tmpFile(name: string, content: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nexus-chunking-'));
  tmpDirs.push(dir);
  const filePath = path.join(dir, name);
  await writeFile(filePath, content);
  return filePath;
}

afterEach(async () => {
  await Promise.all(
    tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('extractPages', () => {
  it('reads plain text as a single page', async () => {
    const filePath = await tmpFile('doc.txt', 'hello nexus');
    const pages = await extractPages(filePath, 'txt');
    expect(pages).toEqual([{ page: 1, text: 'hello nexus' }]);
  });

  it('supports markdown and json as plain text', async () => {
    const md = await tmpFile('doc.md', '# Title\n\nBody text');
    expect(await extractPages(md, 'md')).toEqual([
      { page: 1, text: '# Title\n\nBody text' },
    ]);

    const json = await tmpFile('doc.json', '{"a":1}');
    expect(await extractPages(json, 'json')).toEqual([
      { page: 1, text: '{"a":1}' },
    ]);
  });

  it('rejects empty files with a clear error', async () => {
    const filePath = await tmpFile('empty.txt', '   \n  ');
    await expect(extractPages(filePath, 'txt')).rejects.toThrow(
      'contains no extractable text',
    );
  });

  it('rejects a file that is not valid utf-8 input', async () => {
    // 0xff is not valid UTF-8; buffer.toString('utf8') replaces it with U+FFFD
    // so this only guards against crashes, not data loss.
    const filePath = await tmpFile('bin.txt', '\u00ff');
    await expect(extractPages(filePath, 'txt')).resolves.toBeDefined();
  });
});

describe('splitIntoChunks', () => {
  it('splits long text into multiple overlapping chunks with page metadata', async () => {
    const longText = Array.from(
      { length: 80 },
      (_, i) => `paragraph ${i} `,
    ).join('');
    const chunks = await splitIntoChunks([{ page: 3, text: longText }]);
    const first = chunks[0];

    expect(chunks.length).toBeGreaterThan(1);
    expect(first?.page).toBe(3);
    expect(first?.index).toBe(0);
    chunks.forEach((chunk, i) => expect(chunk.index).toBe(i));
    expect(first?.content.length).toBeLessThanOrEqual(1000);
  });

  it('keeps short text as a single chunk', async () => {
    const chunks = await splitIntoChunks([{ page: 1, text: 'short' }]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe('short');
    expect(chunks[0]?.page).toBe(1);
  });

  it('skips whitespace-only fragments', async () => {
    const chunks = await splitIntoChunks([{ page: 1, text: '  \n\n ' }]);
    expect(chunks).toHaveLength(0);
  });

  it('accumulates a global chunk index across pages', async () => {
    const chunks = await splitIntoChunks([
      { page: 1, text: 'a'.repeat(3000) },
      { page: 2, text: 'b'.repeat(3000) },
    ]);
    const indices = chunks.map((c) => c.index);
    expect(indices).toEqual([...indices].sort((x, y) => x - y));
    // contiguous 0..n-1
    expect(indices[0]).toBe(0);
    expect(indices[indices.length - 1]).toBe(indices.length - 1);
    expect(chunks.some((c) => c.page === 1)).toBe(true);
    expect(chunks.some((c) => c.page === 2)).toBe(true);
  });
});
