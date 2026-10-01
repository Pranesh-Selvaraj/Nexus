import { createHash } from 'node:crypto';

import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import fs from 'node:fs/promises';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';

import { getSettingNumber } from './settings.service.js';

export interface SourcePage {
  page: number;
  text: string;
}

export interface TextChunk {
  content: string;
  index: number;
  page: number | null;
  pageEnd: number | null;
  /** Markdown heading trail, e.g. ['Chapter 3', '3.2 Photosynthesis']. */
  headingPath: string[];
  /** Cheap token estimate (~4 chars/token) used for context budgeting. */
  tokenCount: number;
  /** sha256 of the chunk content, for dedupe/change detection. */
  contentHash: string;
}

/** Text used for embedding: heading context + content, so section meaning is searchable. */
export function buildEmbeddingText(chunk: TextChunk): string {
  return chunk.headingPath.length > 0
    ? `${chunk.headingPath.join(' > ')}\n${chunk.content}`
    : chunk.content;
}

interface PdfPageData {
  getTextContent(options: {
    normalizeWhitespace: boolean;
    disableCombineTextItems: boolean;
  }): Promise<{
    items: Array<{ str: string; transform: number[] }>;
  }>;
}

/**
 * Renders one pdf.js page and appends a form-feed page marker. Mirrors
 * pdf-parse's default renderer (same line-joining heuristic) but preserves
 * page boundaries: pdf-parse's default joins every page with a blank line,
 * which made every PDF chunk report page 1.
 */
async function renderPdfPage(pageData: PdfPageData): Promise<string> {
  const textContent = await pageData.getTextContent({
    normalizeWhitespace: false,
    disableCombineTextItems: false,
  });
  let lastY: number | undefined;
  let text = '';
  for (const item of textContent.items) {
    if (lastY === undefined || lastY === item.transform[5]) {
      text += item.str;
    } else {
      text += `\n${item.str}`;
    }
    lastY = item.transform[5];
  }
  return `${text}\f`;
}

/**
 * Extract per-page text from an uploaded file.
 *
 * PDF pages are delimited by a form-feed appended by the custom renderer,
 * and page numbers are assigned *before* empty pages are filtered out so a
 * blank/image-only page cannot shift every later citation by one.
 */
export async function extractPages(
  filePath: string,
  fileType: string,
): Promise<SourcePage[]> {
  const buffer = await fs.readFile(filePath);

  if (fileType === 'pdf') {
    // pdf.js (bundled with pdf-parse v1) mishandles some Node Buffers
    // (bad XRef entry) while parsing the same bytes as a Uint8Array fine.
    const data = await pdfParse(new Uint8Array(buffer) as unknown as Buffer, {
      pagerender: renderPdfPage,
    });
    const pages = data.text
      .split('\f')
      .map((text, i) => ({ page: i + 1, text: text.trim() }))
      .filter((page) => page.text.length > 0);
    if (pages.length === 0) {
      throw new Error('PDF contains no extractable text');
    }
    return pages;
  }

  if (fileType === 'docx') {
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value.trim();
    if (!text) throw new Error('DOCX contains no extractable text');
    return [{ page: 1, text }];
  }

  // Plain text formats (txt, md, csv, json, ...)
  const text = buffer.toString('utf8').trim();
  if (!text) throw new Error('File contains no extractable text');
  return [{ page: 1, text }];
}

/**
 * Split page texts into overlapping chunks for embedding.
 *
 * Markdown-style headings split the text into sections first; every chunk in
 * a section carries its heading trail, which is prepended before embedding
 * (see buildEmbeddingText) and shown in the UI. Pages without headings keep
 * the previous per-page splitting.
 */
export interface ChunkOptions {
  chunkSize?: number;
  chunkOverlap?: number;
}

interface Section {
  headingPath: string[];
  text: string;
  page: number;
  pageEnd: number;
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;

/** Split one page into heading-delimited sections (or one section if none). */
function splitPageIntoSections(page: number, text: string): Section[] {
  const lines = text.split('\n');
  if (!lines.some((line) => HEADING_RE.test(line))) {
    return [{ headingPath: [], text, page, pageEnd: page }];
  }

  const sections: Section[] = [];
  const stack: string[] = [];
  let buffer: string[] = [];
  let bufferStart = page;

  const flush = (): void => {
    const body = buffer.join('\n').trim();
    if (body.length > 0) {
      sections.push({
        headingPath: stack.filter(Boolean),
        text: body,
        page: bufferStart,
        pageEnd: page,
      });
    }
    buffer = [];
    bufferStart = page;
  };

  for (const line of lines) {
    const heading = HEADING_RE.exec(line);
    if (heading) {
      flush();
      const level = heading[1]?.length ?? 1;
      stack.length = Math.max(0, level - 1);
      stack[level - 1] = heading[2]?.trim() ?? '';
      bufferStart = page;
    }
    buffer.push(line);
  }
  flush();
  return sections;
}

export async function splitIntoChunks(
  pages: SourcePage[],
  options: ChunkOptions = {},
): Promise<TextChunk[]> {
  const [chunkSize, chunkOverlap] = await Promise.all([
    options.chunkSize ?? getSettingNumber('rag.chunkSize'),
    options.chunkOverlap ?? getSettingNumber('rag.chunkOverlap'),
  ]);
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
  });

  const chunks: TextChunk[] = [];
  let index = 0;

  for (const { page, text } of pages) {
    for (const section of splitPageIntoSections(page, text)) {
      const parts = await splitter.splitText(section.text);
      for (const part of parts) {
        const content = part.trim();
        if (content.length === 0) continue;
        chunks.push({
          content,
          index,
          page: section.page,
          pageEnd: section.pageEnd,
          headingPath: section.headingPath,
          tokenCount: Math.max(1, Math.ceil(content.length / 4)),
          contentHash: createHash('sha256').update(content).digest('hex'),
        });
        index += 1;
      }
    }
  }

  return chunks;
}
