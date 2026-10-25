import type { DocumentStructure, FileFormat } from '@nexus/shared-types';

import type { SourcePage } from '../../chunking.service.js';
import { countWords, readingMinutes } from '../readability.js';

export interface ParsedDocument {
  pages: SourcePage[];
  title: string | null;
  metadata: DocumentStructure;
}

/**
 * Parser overrides. Settings normally decide whether OCR/vision run, but
 * tests (and callers that already resolved settings) can pin them explicitly
 * so a parser never needs a database round-trip to be exercised.
 */
export interface ParserOptions {
  ocr?: boolean;
  vision?: boolean;
  ocrLanguages?: string;
}

export interface ParseContext {
  buffer: Buffer;
  /** Absolute path of the stored upload (needed for PDF rasterization). */
  filePath: string;
  /** Original file name (title fallback and archive member labels). */
  fileName: string;
  format: FileFormat;
  /** Owner of the workspace, required by the STT pipeline for media files. */
  userId: string;
  workspaceId: string;
  documentId: string;
  options?: ParserOptions;
}

export type Parser = (ctx: ParseContext) => Promise<ParsedDocument>;

/** Word count + reading time for the extracted pages. */
export function textStats(pages: SourcePage[]): {
  wordCount: number;
  readingMinutes: number;
} {
  const words = countWords(pages.map((page) => page.text).join('\n'));
  return { wordCount: words, readingMinutes: readingMinutes(words) };
}

/** Build parser metadata with word counts and page numbers filled in. */
export function buildMetadata(
  pages: SourcePage[],
  metadata: DocumentStructure,
): DocumentStructure {
  const stats = textStats(pages);
  return {
    ...metadata,
    pageCount: metadata.pageCount ?? pages.length,
    wordCount: stats.wordCount,
    readingMinutes: stats.readingMinutes,
  };
}

/** Throw when a parser produced nothing (consistent, user-facing errors). */
export function assertHasText(pages: SourcePage[], label: string): void {
  if (pages.length === 0 || pages.every((page) => page.text.trim() === '')) {
    throw new Error(`${label} contains no extractable text`);
  }
}
