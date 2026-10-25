import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildDocx,
  buildEpub,
  buildOdt,
  buildPdf,
  buildPptx,
  buildXlsx,
  TINY_PNG,
  zipBuffer,
} from './fixtures.test-utils.js';
import { parseArchive } from './parsers/archive.js';
import { parseDocx } from './parsers/docx.js';
import { parseEpub } from './parsers/epub.js';
import { parseHtml } from './parsers/html.js';
import { parseImage } from './parsers/image.js';
import { parseOdt } from './parsers/odt.js';
import { parsePdf } from './parsers/pdf.js';
import { parsePptx } from './parsers/pptx.js';
import { parseRtf } from './parsers/rtf-parser-wrapper.js';
import { parseSubtitles } from './parsers/subtitles.js';
import { parseText } from './parsers/text.js';
import { parseXlsx } from './parsers/xlsx.js';
import type { ParseContext } from './parsers/types.js';
import { resetOcrAvailabilityCache } from './ocr.js';
import {
  capText,
  normalizeFormat,
  parserForFormat,
  parseStoredFile,
} from './registry.js';

const tmpDirs: string[] = [];
const originalTesseract = process.env.TESSERACT_BIN;
const originalRaster = process.env.PDF_RASTER_BIN;

async function tmpFile(
  name: string,
  content: Buffer | string,
): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nexus-parser-'));
  tmpDirs.push(dir);
  const filePath = path.join(dir, name);
  await writeFile(filePath, content);
  return filePath;
}

async function shim(script: string): Promise<string> {
  const file = await tmpFile('shim.sh', script);
  await chmod(file, 0o755);
  return file;
}

afterEach(async () => {
  await Promise.all(
    tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
  if (originalTesseract === undefined) delete process.env.TESSERACT_BIN;
  else process.env.TESSERACT_BIN = originalTesseract;
  if (originalRaster === undefined) delete process.env.PDF_RASTER_BIN;
  else process.env.PDF_RASTER_BIN = originalRaster;
  resetOcrAvailabilityCache();
});

function ctx(
  buffer: Buffer,
  overrides: Partial<ParseContext> = {},
): ParseContext {
  return {
    buffer,
    filePath: '/tmp/unused',
    fileName: 'document',
    format: 'txt',
    userId: '11111111-1111-4111-8111-111111111111',
    workspaceId: '22222222-2222-4222-8222-222222222222',
    documentId: '33333333-3333-4333-8333-333333333333',
    ...overrides,
  };
}

describe('EPUB parser', () => {
  it('turns spine items into chapters with TOC titles and metadata', async () => {
    const buffer = await buildEpub(
      [
        {
          title: 'Foundations',
          paragraphs: ['Retrieval begins with a corpus.'],
        },
        {
          title: 'Fusion',
          paragraphs: ['Reciprocal rank fusion merges lists.'],
        },
      ],
      { title: 'The Retrieval Book', author: 'Ada' },
    );
    const parsed = await parseEpub(ctx(buffer, { format: 'epub' }));
    expect(parsed.title).toBe('The Retrieval Book');
    expect(parsed.metadata.author).toBe('Ada');
    expect(parsed.metadata.kind).toBe('book');
    expect(parsed.pages).toHaveLength(2);
    expect(parsed.pages[0]?.text).toContain('# Foundations');
    expect(parsed.pages[1]?.text).toContain('Reciprocal rank fusion');
    expect(parsed.metadata.chapters).toEqual([
      { title: 'Foundations', page: 1 },
      { title: 'Fusion', page: 2 },
    ]);
  });

  it('rejects an EPUB without readable chapters', async () => {
    const buffer = await zipBuffer({
      mimetype: 'application/epub+zip',
      'META-INF/container.xml':
        '<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>',
      'content.opf': '<package><manifest></manifest><spine></spine></package>',
    });
    await expect(parseEpub(ctx(buffer, { format: 'epub' }))).rejects.toThrow(
      /no extractable text/,
    );
  });
});

describe('PPTX parser', () => {
  it('reads slides in numeric order with speaker notes', async () => {
    const buffer = await buildPptx([
      { body: ['Course overview', 'What retrieval is'], notes: 'Mention RRF.' },
      { body: ['Embeddings', 'Dimensions matter'] },
    ]);
    const parsed = await parsePptx(ctx(buffer, { format: 'pptx' }));
    expect(parsed.pages).toHaveLength(2);
    expect(parsed.pages[0]?.text).toContain('# Slide 1: Course overview');
    expect(parsed.pages[0]?.text).toContain('## Speaker notes');
    expect(parsed.pages[0]?.text).toContain('Mention RRF.');
    expect(parsed.pages[1]?.text).toContain('Embeddings');
    expect(parsed.metadata.kind).toBe('slides');
    expect(parsed.metadata.chapters?.map((chapter) => chapter.page)).toEqual([
      1, 2,
    ]);
  });
});

describe('XLSX parser', () => {
  it('resolves shared strings and keeps worksheet order', async () => {
    const buffer = await buildXlsx([
      {
        name: 'Scores',
        rows: [
          ['Topic', 'Score'],
          ['Retrieval', '90'],
        ],
      },
      { name: 'Notes', rows: [['Remember FSRS']] },
    ]);
    const parsed = await parseXlsx(ctx(buffer, { format: 'xlsx' }));
    expect(parsed.pages).toHaveLength(2);
    expect(parsed.pages[0]?.text).toContain('## Sheet: Scores');
    expect(parsed.pages[0]?.text).toContain('Topic | Score');
    expect(parsed.pages[0]?.text).toContain('Retrieval | 90');
    expect(parsed.pages[1]?.text).toContain('Remember FSRS');
    expect(parsed.metadata.kind).toBe('sheet');
  });
});

describe('ODT parser', () => {
  it('converts headings, paragraphs and lists to Markdown-ish text', async () => {
    const buffer = await buildOdt([
      { heading: 'Chapter one', level: 1 },
      { text: 'Some prose with &amp; an entity.' },
      { heading: 'Section', level: 2 },
      { text: 'More prose.' },
    ]);
    const parsed = await parseOdt(ctx(buffer, { format: 'odt' }));
    expect(parsed.pages[0]?.text).toContain('# Chapter one');
    expect(parsed.pages[0]?.text).toContain('## Section');
    expect(parsed.pages[0]?.text).toContain('Some prose with & an entity.');
    expect(parsed.metadata.chapters?.map((chapter) => chapter.title)).toEqual([
      'Chapter one',
      'Section',
    ]);
  });
});

describe('RTF parser', () => {
  it('drops destinations and decodes escapes', async () => {
    const rtf =
      "{\\rtf1\\ansi\\ansicpg1252{\\fonttbl{\\f0 Helvetica;}}\\f0 Hello\\par World \\endash\\'e9\\par}";
    const parsed = await parseRtf(
      ctx(Buffer.from(rtf, 'latin1'), { format: 'rtf' }),
    );
    expect(parsed.pages[0]?.text).toContain('Hello');
    expect(parsed.pages[0]?.text).toContain('World –é');
    expect(parsed.pages[0]?.text).not.toContain('Helvetica');
    expect(parsed.pages[0]?.text).not.toContain('fonttbl');
  });
});

describe('HTML parser', () => {
  it('extracts the article body', async () => {
    const html = `<html><head><title>Notes</title></head><body>
      <nav>menu</nav><article><h1>Notes</h1><p>${'Grounded answers need sources. '.repeat(20)}</p></article>
    </body></html>`;
    const parsed = await parseHtml(ctx(Buffer.from(html), { format: 'html' }));
    expect(parsed.title).toBe('Notes');
    expect(parsed.pages[0]?.text).toContain('Grounded answers need sources');
    expect(parsed.pages[0]?.text).not.toContain('menu');
    expect(parsed.metadata.kind).toBe('web');
  });
});

describe('subtitle parser', () => {
  it('parses SRT and WebVTT with timestamps', async () => {
    const srt = `1
00:00:01,000 --> 00:00:03,000
Hello there.

2
00:00:03,500 --> 00:00:05,000
Retrieval fuses two arms.`;
    const parsed = await parseSubtitles(
      ctx(Buffer.from(srt), { format: 'srt' }),
    );
    expect(parsed.pages[0]?.text).toContain('## Transcript 1');
    expect(parsed.pages[0]?.text).toContain('[00:00] Hello there.');
    expect(parsed.metadata.transcript).toBe(true);

    const vtt = `WEBVTT

00:01.000 --> 00:02.000
Second cue <b>bold</b>`;
    const parsedVtt = await parseSubtitles(
      ctx(Buffer.from(vtt), { format: 'vtt' }),
    );
    expect(parsedVtt.pages[0]?.text).toContain('[00:00] Second cue bold');
  });
});

describe('ZIP folder parser', () => {
  it('indexes every supported member as a chapter', async () => {
    const buffer = await zipBuffer({
      'notes/intro.txt': 'Introduction to retrieval.',
      'notes/reading.md': '# Reading\n\nA list of papers.',
      'notes/ignore.exe': 'binary',
      '__MACOSX/notes/.DS_Store': 'junk',
    });
    const parsed = await parseArchive(ctx(buffer, { format: 'zip' }));
    expect(parsed.pages).toHaveLength(2);
    expect(parsed.metadata.chapters?.map((chapter) => chapter.title)).toEqual([
      'notes/intro.txt',
      'notes/reading.md',
    ]);
    expect(parsed.pages[1]?.text).toContain('# Reading');
  });

  it('parses a PDF member from the archive without a file path', async () => {
    const buffer = await zipBuffer({
      'papers/paper.pdf': buildPdf(['Archive PDF page one']),
      'papers/notes.txt': 'Companion notes.',
    });
    const parsed = await parseArchive(
      ctx(buffer, { format: 'zip', options: { ocr: false } }),
    );
    const pdfChapter = parsed.metadata.chapters?.find(
      (chapter) => chapter.title === 'papers/paper.pdf',
    );
    expect(pdfChapter).toBeDefined();
    const pdfPage = parsed.pages.find((page) => page.page === pdfChapter?.page);
    expect(pdfPage?.text).toContain('Archive PDF page one');
  });

  it('fails with a helpful message when nothing is supported', async () => {
    const buffer = await zipBuffer({
      'image.exe': 'x',
      'data.bin': Buffer.from([0x00, 0x01, 0x02, 0x03, 0x00]),
    });
    await expect(parseArchive(ctx(buffer, { format: 'zip' }))).rejects.toThrow(
      /contains no .*documents/,
    );
  });
});

describe('PDF parser', () => {
  it('keeps page numbers and reports document metadata', async () => {
    const filePath = await tmpFile(
      'doc.pdf',
      buildPdf(['First page', 'Second page']),
    );
    const parsed = await parsePdf(
      ctx(Buffer.from(''), {
        filePath,
        format: 'pdf',
        options: { ocr: false },
      }),
    );
    expect(parsed.pages.map((page) => page.page)).toEqual([1, 2]);
    expect(parsed.metadata.kind).toBe('document');
    expect(parsed.metadata.ocr).toBe(false);
  });

  it('falls back to OCR for a scanned PDF when tesseract is available', async () => {
    const raster = await shim(
      // Answer the availability probe (`-v`) without touching the filesystem:
      // writing `${last}-01.png` there used to drop a stray `-v-01.png` in the
      // package directory on every run.
      '#!/bin/sh\nif [ "$1" = "-v" ]; then echo "pdftoppm version 23"; exit 0; fi\nfor last; do :; done\nprintf "FAKE PNG" > "${last}-01.png"\n',
    );
    const tesseract = await shim(
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "tesseract 5"; exit 0; fi\ncat\n',
    );
    process.env.PDF_RASTER_BIN = raster;
    process.env.TESSERACT_BIN = tesseract;
    resetOcrAvailabilityCache();

    const filePath = await tmpFile('scan.pdf', buildPdf([null]));
    const parsed = await parsePdf(
      ctx(Buffer.from(''), {
        filePath,
        format: 'pdf',
        options: { ocr: true },
      }),
    );
    expect(parsed.metadata.ocr).toBe(true);
    expect(parsed.pages[0]?.text).toBe('FAKE PNG');
  });

  it('explains why a scanned PDF could not be read when OCR is unavailable', async () => {
    const filePath = await tmpFile('scan.pdf', buildPdf([null]));
    process.env.TESSERACT_BIN = '/nonexistent/tesseract';
    resetOcrAvailabilityCache();
    await expect(
      parsePdf(
        ctx(Buffer.from(''), {
          filePath,
          format: 'pdf',
          options: { ocr: true },
        }),
      ),
    ).rejects.toThrow(/install tesseract/);
  });
});

describe('image parser', () => {
  it('indexes OCR text with the OCR flag', async () => {
    const tesseract = await shim(
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "tesseract 5"; exit 0; fi\nprintf "STOP SIGN 42"\n',
    );
    process.env.TESSERACT_BIN = tesseract;
    resetOcrAvailabilityCache();
    const parsed = await parseImage(
      ctx(TINY_PNG, {
        fileName: 'sign.png',
        format: 'png',
        options: { ocr: true, vision: false },
      }),
    );
    expect(parsed.pages[0]?.text).toContain('## Text in the image');
    expect(parsed.pages[0]?.text).toContain('STOP SIGN 42');
    expect(parsed.metadata.ocr).toBe(true);
    expect(parsed.metadata.vision).toBe(false);
    expect(parsed.metadata.kind).toBe('image');
  });

  it('fails with guidance when neither OCR nor vision is available', async () => {
    await expect(
      parseImage(
        ctx(TINY_PNG, {
          format: 'png',
          options: { ocr: false, vision: false },
        }),
      ),
    ).rejects.toThrow(/No text could be extracted/);
  });
});

describe('text parser and registry', () => {
  it('keeps plain text as a single page', async () => {
    const parsed = await parseText(
      ctx(Buffer.from('\uFEFFLine one\r\nLine two'), { format: 'md' }),
    );
    expect(parsed.pages).toEqual([{ page: 1, text: 'Line one\nLine two' }]);
    expect(parsed.metadata.format).toBe('md');
  });

  it('normalizes aliases and resolves parsers', () => {
    expect(normalizeFormat('markdown')).toBe('md');
    expect(normalizeFormat('.JPG')).toBe('jpeg');
    expect(normalizeFormat('tif')).toBe('tiff');
    expect(normalizeFormat('exe')).toBeNull();
    expect(parserForFormat('epub')).toBeTypeOf('function');
    expect(parserForFormat('nope')).toBeNull();
  });

  it('caps text at the configured maximum', () => {
    const capped = capText(
      {
        pages: [
          { page: 1, text: 'a'.repeat(50) },
          { page: 2, text: 'b'.repeat(50) },
        ],
        title: null,
        metadata: { format: 'txt' },
      },
      60,
    );
    expect(capped.pages).toHaveLength(2);
    expect(capped.pages[0]?.text).toHaveLength(50);
    expect(capped.pages[1]?.text).toHaveLength(10);
  });

  it('parses a stored file and rejects unsupported formats', async () => {
    const filePath = await tmpFile('notes.txt', 'Stored file contents');
    const parsed = await parseStoredFile({
      filePath,
      format: 'txt',
      fileName: 'notes.txt',
      userId: '11111111-1111-4111-8111-111111111111',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      documentId: '33333333-3333-4333-8333-333333333333',
    });
    expect(parsed.pages[0]?.text).toBe('Stored file contents');

    await expect(
      parseStoredFile({
        filePath,
        format: 'exe',
        fileName: 'x.exe',
        userId: '11111111-1111-4111-8111-111111111111',
        workspaceId: '22222222-2222-4222-8222-222222222222',
        documentId: '33333333-3333-4333-8333-333333333333',
      }),
    ).rejects.toThrow(/Unsupported file format/);
  });

  it('parses DOCX through the registry', async () => {
    const parsed = await parseDocx(
      ctx(await buildDocx('Registry docx text'), { format: 'docx' }),
    );
    expect(parsed.pages[0]?.text).toBe('Registry docx text');
  });
});
