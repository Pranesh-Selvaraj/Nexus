import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';

import { zipBuffer } from './fixtures.test-utils.js';
import {
  isUnsafeEntryName,
  openArchive,
  readEntryBuffer,
  readEntryText,
  ZipLimitError,
} from './zip.js';

async function deflatedZip(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

describe('zip limits', () => {
  it('opens a normal archive and reports entry metadata', async () => {
    const archive = await openArchive(
      await zipBuffer({ 'a.txt': 'A', 'b.txt': 'B' }),
    );
    expect(archive.entries.map((entry) => entry.name).sort()).toEqual([
      'a.txt',
      'b.txt',
    ]);
    const budget = { remaining: 1024 };
    expect(await readEntryText(archive, 'a.txt', budget)).toBe('A');
  });

  it('rejects archives with too many entries', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 6; i += 1) files[`f${i}.txt`] = 'x';
    await expect(
      openArchive(await zipBuffer(files), { limits: { maxZipEntries: 3 } }),
    ).rejects.toBeInstanceOf(ZipLimitError);
  });

  it('rejects an entry above the per-entry limit', async () => {
    await expect(
      openArchive(await zipBuffer({ 'big.txt': 'x'.repeat(5000) }), {
        limits: { maxEntryBytes: 1000 },
      }),
    ).rejects.toThrow(/entry limit/);
  });

  it('rejects a compression-ratio bomb', async () => {
    await expect(
      openArchive(await deflatedZip({ 'bomb.txt': 'A'.repeat(200_000) }), {
        limits: { maxCompressionRatio: 10, maxEntryBytes: 1024 * 1024 },
      }),
    ).rejects.toThrow(/compression ratio/);
  });

  it('rejects archives that expand beyond the total budget', async () => {
    await expect(
      openArchive(
        await zipBuffer({ 'a.txt': 'x'.repeat(800), 'b.txt': 'y'.repeat(800) }),
        { limits: { maxUncompressedBytes: 1000 } },
      ),
    ).rejects.toThrow(/total limit/);
  });

  it('enforces the budget against actual bytes read', async () => {
    const archive = await openArchive(
      await zipBuffer({ 'a.txt': 'x'.repeat(100) }),
    );
    const budget = { remaining: 10 };
    await expect(readEntryText(archive, 'a.txt', budget)).rejects.toThrow(
      /total limit/,
    );
    const bufferBudget = { remaining: 10 };
    await expect(
      readEntryBuffer(archive, 'a.txt', bufferBudget),
    ).rejects.toThrow(/total limit/);
  });

  it('stops decompressing at the remaining budget for a large entry', async () => {
    // 1 MB of zeros compresses to a few KB: the read must abort as soon as a
    // chunk would exceed the tiny remaining budget instead of materialising
    // the whole entry first.
    const archive = await openArchive(
      await deflatedZip({ 'big.txt': 'x'.repeat(1024 * 1024) }),
      {
        limits: {
          maxEntryBytes: 8 * 1024 * 1024,
          // Ratio checking is openArchive's job; this test targets the read.
          maxCompressionRatio: 1_000_000,
        },
      },
    );
    const budget = { remaining: 10 * 1024 };
    await expect(readEntryText(archive, 'big.txt', budget)).rejects.toThrow(
      /total limit/,
    );
    // Nothing was charged against the budget by the aborted read.
    expect(budget.remaining).toBeGreaterThan(0);
  });

  it('rejects corrupt and empty archives with a clear message', async () => {
    await expect(openArchive(Buffer.from('PK\x03\x04garbage'))).rejects.toThrow(
      /invalid or corrupt/,
    );
    await expect(openArchive(await zipBuffer({}))).rejects.toThrow(
      /contains no files/,
    );
  });

  it('flags path-traversal entry names', () => {
    expect(isUnsafeEntryName('../etc/passwd')).toBe(true);
    expect(isUnsafeEntryName('a/../../x')).toBe(true);
    expect(isUnsafeEntryName('/absolute')).toBe(true);
    expect(isUnsafeEntryName('C:\\windows\\x')).toBe(true);
    expect(isUnsafeEntryName('folder/notes.txt')).toBe(false);
  });
});
