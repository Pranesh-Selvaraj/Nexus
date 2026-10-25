/**
 * Parser registry: one parser per detected format.
 *
 * The registry is the only place that maps a format to code, which keeps the
 * ingestion worker format-agnostic and makes "is this file supported?" a
 * single lookup. Every parser has a focused unit test with a fixture built in
 * the test itself (no binary blobs in the repo).
 */
import { readFile } from 'node:fs/promises';

import type { FileFormat } from '@nexus/shared-types';

import { ingestionLimits } from './limits.js';
import { parseArchive } from './parsers/archive.js';
import { parseDocx } from './parsers/docx.js';
import { parseEpub } from './parsers/epub.js';
import { parseHtml } from './parsers/html.js';
import { parseImage } from './parsers/image.js';
import { parseMedia } from './parsers/media.js';
import { parseOdt } from './parsers/odt.js';
import { parsePdf } from './parsers/pdf.js';
import { parsePptx } from './parsers/pptx.js';
import { parseRtf } from './parsers/rtf-parser-wrapper.js';
import { parseSubtitles } from './parsers/subtitles.js';
import { parseText } from './parsers/text.js';
import { parseXlsx } from './parsers/xlsx.js';
import {
  assertHasText,
  type ParseContext,
  type ParsedDocument,
  type Parser,
} from './parsers/types.js';

const PARSERS: Partial<Record<FileFormat, Parser>> = {
  pdf: parsePdf,
  docx: parseDocx,
  pptx: parsePptx,
  xlsx: parseXlsx,
  odt: parseOdt,
  rtf: parseRtf,
  epub: parseEpub,
  zip: parseArchive,
  html: parseHtml,
  txt: parseText,
  md: parseText,
  csv: parseText,
  json: parseText,
  srt: parseSubtitles,
  vtt: parseSubtitles,
  png: parseImage,
  jpeg: parseImage,
  webp: parseImage,
  gif: parseImage,
  tiff: parseImage,
  bmp: parseImage,
  mp3: parseMedia,
  wav: parseMedia,
  ogg: parseMedia,
  flac: parseMedia,
  m4a: parseMedia,
  aac: parseMedia,
  webm: parseMedia,
  mp4: parseMedia,
  mov: parseMedia,
};

/** Formats the ingestion pipeline can actually parse. */
export const SUPPORTED_FORMATS: FileFormat[] = Object.keys(
  PARSERS,
) as FileFormat[];

const SUPPORTED = new Set<string>(SUPPORTED_FORMATS);

/** Format aliases seen in older rows / file names. */
const FORMAT_ALIASES: Record<string, FileFormat> = {
  markdown: 'md',
  htm: 'html',
  xhtml: 'html',
  jpg: 'jpeg',
  tif: 'tiff',
  m4v: 'mp4',
  qt: 'mov',
  text: 'txt',
  log: 'txt',
  tsv: 'csv',
  webvtt: 'vtt',
};

/** Normalise a stored/legacy file type to a registry format (or null). */
export function normalizeFormat(
  value: string | null | undefined,
): FileFormat | null {
  if (!value) return null;
  const lower = value.toLowerCase().replace(/^\./, '');
  const aliased = FORMAT_ALIASES[lower] ?? lower;
  return SUPPORTED.has(aliased) ? (aliased as FileFormat) : null;
}

export function isSupportedFormat(value: string | null | undefined): boolean {
  return normalizeFormat(value) !== null;
}

/** Parser for a format, or null when unsupported. */
export function parserForFormat(
  format: string | null | undefined,
): Parser | null {
  const normalised = normalizeFormat(format);
  return normalised ? (PARSERS[normalised] ?? null) : null;
}

/** Formats handled as plain text (used to accept extension-only files). */
export const TEXT_FORMATS: FileFormat[] = [
  'txt',
  'md',
  'csv',
  'json',
  'srt',
  'vtt',
  'html',
];

/**
 * Run a parser with the wall-clock limit and the total-text cap applied.
 */
export async function parseDocument(
  ctx: ParseContext,
): Promise<ParsedDocument> {
  const parser = parserForFormat(ctx.format);
  if (!parser) {
    throw new Error(`Unsupported file format: ${ctx.format}`);
  }
  const limits = ingestionLimits();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `Parsing timed out after ${Math.round(limits.parserTimeoutMs / 1000)}s - try a smaller file or split it up`,
          ),
        ),
      limits.parserTimeoutMs,
    );
  });

  let parsed: ParsedDocument;
  try {
    parsed = await Promise.race([parser(ctx), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }

  assertHasText(parsed.pages, ctx.fileName);
  return capText(parsed, limits.maxTextChars);
}

/** Truncate absurdly large extracted text (protects embeddings and the DB). */
export function capText(
  parsed: ParsedDocument,
  maxChars: number,
): ParsedDocument {
  let remaining = maxChars;
  const pages = [];
  for (const page of parsed.pages) {
    if (remaining <= 0) break;
    const text =
      page.text.length > remaining ? page.text.slice(0, remaining) : page.text;
    remaining -= text.length;
    pages.push({ page: page.page, text });
  }
  return { ...parsed, pages: pages.length > 0 ? pages : parsed.pages };
}

export interface ParseFileInput {
  filePath: string;
  format: string;
  fileName: string;
  userId: string;
  workspaceId: string;
  documentId: string;
}

/** Read a stored upload and parse it with the registered parser. */
export async function parseStoredFile(
  input: ParseFileInput,
): Promise<ParsedDocument> {
  const format = normalizeFormat(input.format);
  if (!format) {
    throw new Error(
      `Unsupported file format "${input.format}" - supported: ${SUPPORTED_FORMATS.join(', ')}`,
    );
  }
  const buffer = await readFile(input.filePath);
  return parseDocument({
    buffer,
    filePath: input.filePath,
    fileName: input.fileName,
    format,
    userId: input.userId,
    workspaceId: input.workspaceId,
    documentId: input.documentId,
  });
}
