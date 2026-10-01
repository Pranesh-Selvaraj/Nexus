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
 */
export interface ChunkOptions {
  chunkSize?: number;
  chunkOverlap?: number;
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
    const parts = await splitter.splitText(text);
    for (const part of parts) {
      const content = part.trim();
      if (content.length === 0) continue;
      chunks.push({ content, index, page });
      index += 1;
    }
  }

  return chunks;
}
