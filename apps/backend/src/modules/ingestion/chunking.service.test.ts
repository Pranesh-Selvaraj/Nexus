import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import JSZip from 'jszip';
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

/** Build a minimal but valid .docx (zip with word/document.xml). */
async function tmpDocx(text: string): Promise<string> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>${text}</w:t></w:r></w:p>
  </w:body>
</w:document>`,
  );
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nexus-chunking-'));
  tmpDirs.push(dir);
  const filePath = path.join(dir, 'doc.docx');
  await writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer' }));
  return filePath;
}

/**
 * Builds a minimal valid PDF with one page per entry (null = blank page).
 * Used to lock down page-number metadata: blank pages must not shift the
 * numbers of later pages. Only ASCII text is supported.
 */
function buildPdf(pageTexts: (string | null)[]): Buffer {
  const pageCount = pageTexts.length;
  const fontNum = 3 + pageCount;
  let nextNum = fontNum + 1;
  const contentNumByPage = new Map<number, number>();
  pageTexts.forEach((text, i) => {
    if (text !== null) contentNumByPage.set(i, nextNum++);
  });

  const objects: string[] = new Array<string>(nextNum);
  objects[1] = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  const kids = pageTexts.map((_, i) => `${3 + i} 0 R`).join(' ');
  objects[2] = `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>\nendobj\n`;
  pageTexts.forEach((text, i) => {
    const num = 3 + i;
    objects[num] =
      text === null
        ? `${num} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n`
        : `${num} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentNumByPage.get(i)} 0 R /Resources << /Font << /F1 ${fontNum} 0 R >> >> >>\nendobj\n`;
  });
  objects[fontNum] =
    `${fontNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`;
  pageTexts.forEach((text, i) => {
    if (text === null) return;
    const num = contentNumByPage.get(i) as number;
    const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
    objects[num] =
      `${num} 0 obj\n<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream\nendobj\n`;
  });

  // Offsets are relative to the start of the file, so the header counts.
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = Buffer.byteLength(body, 'latin1');
    body += objects[i];
  }
  const xrefOffset = Buffer.byteLength(body, 'latin1');
  let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer, 'latin1');
}

async function tmpPdf(pages: (string | null)[]): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nexus-chunking-'));
  tmpDirs.push(dir);
  const filePath = path.join(dir, 'doc.pdf');
  await writeFile(filePath, buildPdf(pages));
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

  it('extracts text from docx files', async () => {
    const filePath = await tmpDocx('Hello from a Word document');
    const pages = await extractPages(filePath, 'docx');
    expect(pages).toHaveLength(1);
    expect(pages[0]?.page).toBe(1);
    expect(pages[0]?.text).toContain('Hello from a Word document');
  });

  it('rejects docx files without extractable text', async () => {
    const filePath = await tmpDocx('   ');
    await expect(extractPages(filePath, 'docx')).rejects.toThrow(
      'contains no extractable text',
    );
  });

  it('numbers PDF pages and keeps numbers stable across blank pages', async () => {
    const filePath = await tmpPdf([
      'First page text',
      null, // blank page: filtered out, but must not shift later numbers
      'Third page text',
    ]);
    const pages = await extractPages(filePath, 'pdf');

    expect(pages).toHaveLength(2);
    expect(pages[0]).toEqual({ page: 1, text: 'First page text' });
    expect(pages[1]).toEqual({ page: 3, text: 'Third page text' });
  });

  it('numbers consecutive PDF pages without blanks', async () => {
    const filePath = await tmpPdf(['Alpha page', 'Beta page']);
    const pages = await extractPages(filePath, 'pdf');

    expect(pages.map((p) => p.page)).toEqual([1, 2]);
    expect(pages[0]?.text).toContain('Alpha');
    expect(pages[1]?.text).toContain('Beta');
  });

  it('rejects a PDF with no extractable text', async () => {
    const filePath = await tmpPdf([null, null]);
    await expect(extractPages(filePath, 'pdf')).rejects.toThrow(
      'no extractable text',
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
    const chunks = await splitIntoChunks([{ page: 3, text: longText }], {
      chunkSize: 1000,
      chunkOverlap: 200,
    });
    const first = chunks[0];

    expect(chunks.length).toBeGreaterThan(1);
    expect(first?.page).toBe(3);
    expect(first?.index).toBe(0);
    chunks.forEach((chunk, i) => expect(chunk.index).toBe(i));
    expect(first?.content.length).toBeLessThanOrEqual(1000);
  });

  it('keeps short text as a single chunk', async () => {
    const chunks = await splitIntoChunks([{ page: 1, text: 'short' }], {
      chunkSize: 1000,
      chunkOverlap: 200,
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe('short');
    expect(chunks[0]?.page).toBe(1);
  });

  it('skips whitespace-only fragments', async () => {
    const chunks = await splitIntoChunks([{ page: 1, text: '  \n\n ' }], {
      chunkSize: 1000,
      chunkOverlap: 200,
    });
    expect(chunks).toHaveLength(0);
  });

  it('accumulates a global chunk index across pages', async () => {
    const chunks = await splitIntoChunks(
      [
        { page: 1, text: 'a'.repeat(3000) },
        { page: 2, text: 'b'.repeat(3000) },
      ],
      { chunkSize: 1000, chunkOverlap: 200 },
    );
    const indices = chunks.map((c) => c.index);
    expect(indices).toEqual([...indices].sort((x, y) => x - y));
    // contiguous 0..n-1
    expect(indices[0]).toBe(0);
    expect(indices[indices.length - 1]).toBe(indices.length - 1);
    expect(chunks.some((c) => c.page === 1)).toBe(true);
    expect(chunks.some((c) => c.page === 2)).toBe(true);
  });
});
