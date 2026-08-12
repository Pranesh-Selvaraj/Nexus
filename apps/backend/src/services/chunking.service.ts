import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import fs from 'node:fs/promises';
import pdfParse from 'pdf-parse';

export interface SourcePage {
  page: number;
  text: string;
}

export interface TextChunk {
  content: string;
  index: number;
  page: number | null;
}

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 200,
});

/**
 * Extract per-page text from an uploaded file.
 * PDF page boundaries are detected via form-feed characters (\f), which
 * pdf-parse inserts between pages.
 */
export async function extractPages(
  filePath: string,
  fileType: string,
): Promise<SourcePage[]> {
  const buffer = await fs.readFile(filePath);

  if (fileType === 'pdf') {
    const data = await pdfParse(buffer);
    const pages = data.text
      .split('\f')
      .map((text) => text.trim())
      .filter((text) => text.length > 0);
    if (pages.length === 0) {
      throw new Error('PDF contains no extractable text');
    }
    return pages.map((text, i) => ({ page: i + 1, text }));
  }

  // Plain text formats (txt, md, csv, json, ...)
  const text = buffer.toString('utf8').trim();
  if (!text) throw new Error('File contains no extractable text');
  return [{ page: 1, text }];
}

/**
 * Split page texts into overlapping chunks for embedding.
 */
export async function splitIntoChunks(
  pages: SourcePage[],
): Promise<TextChunk[]> {
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
