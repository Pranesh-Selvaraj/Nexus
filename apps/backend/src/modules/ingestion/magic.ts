/**
 * Content-addressed file type detection.
 *
 * The client-supplied extension is metadata, never a parser selector: a file
 * named `notes.pdf` that is actually a zip would otherwise be handed to
 * pdf.js, and an extension allowlist alone cannot tell a real DOCX from a
 * renamed executable. Detection reads the leading bytes (magic numbers), and
 * for zip-based OOXML/EPUB/ODT containers it inspects the entry names.
 */
import JSZip from 'jszip';

import type { FileCategory, FileFormat } from '@nexus/shared-types';

import { ingestionLimits } from './limits.js';

export interface DetectedFile {
  format: FileFormat;
  /** Safe MIME type for the detected format (never client input). */
  mime: string;
  category: FileCategory;
  /**
   * Container the format lives in ('zip'), when applicable. Used for error
   * messages ("this is a zip, but not a DOCX").
   */
  container?: string;
  /** Number of bytes inspected (used only for diagnostics). */
  inspectedBytes: number;
}

/**
 * Extensions that are never ingested, whatever their bytes look like. The
 * upload admission check (and archive member filter) refuses them so the
 * storage volume never holds something a future feature might execute.
 */
export const EXECUTABLE_EXTENSIONS = new Set([
  'exe',
  'dll',
  'msi',
  'com',
  'scr',
  'bat',
  'cmd',
  'ps1',
  'sh',
  'bash',
  'zsh',
  'app',
  'apk',
  'jar',
  'bin',
  'so',
  'dylib',
  'vbs',
  'js',
  'mjs',
  'cjs',
  'php',
  'py',
  'rb',
  'pl',
]);

/** Extension → format, used only to disambiguate plain-text flavours. */
const TEXT_EXTENSIONS: Record<string, FileFormat> = {
  txt: 'txt',
  text: 'txt',
  log: 'txt',
  md: 'md',
  markdown: 'md',
  mdx: 'md',
  csv: 'csv',
  tsv: 'csv',
  json: 'json',
  srt: 'srt',
  vtt: 'vtt',
  webvtt: 'vtt',
  htm: 'html',
  html: 'html',
  xhtml: 'html',
};

/** Every format that can be ingested, with the MIME the UI serves it as. */
export const FORMAT_MIME: Record<FileFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  odt: 'application/vnd.oasis.opendocument.text',
  rtf: 'application/rtf',
  epub: 'application/epub+zip',
  zip: 'application/zip',
  html: 'text/html',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  srt: 'text/plain',
  vtt: 'text/vtt',
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  tiff: 'image/tiff',
  bmp: 'image/bmp',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  webm: 'video/webm',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
};

const IMAGE_FORMATS = new Set<FileFormat>([
  'png',
  'jpeg',
  'webp',
  'gif',
  'tiff',
  'bmp',
]);

const MEDIA_FORMATS = new Set<FileFormat>([
  'mp3',
  'wav',
  'ogg',
  'flac',
  'm4a',
  'aac',
  'webm',
  'mp4',
  'mov',
]);

/** MIME type for a detected format; octet-stream for unknown strings. */
export function mimeForFormat(format: string | null | undefined): string {
  if (!format) return 'application/octet-stream';
  return FORMAT_MIME[format as FileFormat] ?? 'application/octet-stream';
}

export function isImageFormat(format: string | null | undefined): boolean {
  return !!format && IMAGE_FORMATS.has(format as FileFormat);
}

export function isMediaFormat(format: string | null | undefined): boolean {
  return !!format && MEDIA_FORMATS.has(format as FileFormat);
}

function categoryFor(format: FileFormat): FileCategory {
  if (IMAGE_FORMATS.has(format)) return 'image';
  if (MEDIA_FORMATS.has(format)) {
    return format === 'webm'
      ? 'video'
      : ['mp4', 'mov'].includes(format)
        ? 'video'
        : 'audio';
  }
  if (format === 'zip') return 'archive';
  return 'document';
}

function startsWith(buffer: Buffer, bytes: number[]): boolean {
  if (buffer.length < bytes.length) return false;
  return bytes.every((byte, index) => buffer[index] === byte);
}

function ascii(buffer: Buffer, offset: number, length: number): string {
  return buffer
    .subarray(offset, offset + length)
    .toString('latin1')
    .toLowerCase();
}

/** True when the buffer begins like a zip archive (spanned/empty variants too). */
export function looksLikeZip(buffer: Buffer): boolean {
  return (
    startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(buffer, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(buffer, [0x50, 0x4b, 0x07, 0x08])
  );
}

/**
 * OLE2/CFB signature used by legacy .doc/.xls/.ppt. Detected only to give the
 * user an actionable message ("save as .docx") instead of feeding binary
 * garbage to a text parser.
 */
export function looksLikeLegacyOffice(buffer: Buffer): boolean {
  return startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
}

/**
 * Heuristic for "this is human-readable text". Rejects NUL bytes (binary),
 * and requires a high share of printable/whitespace characters. UTF-8
 * multi-byte sequences are accepted because the decoded string is checked.
 */
export function looksLikeText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8192);
  if (sample.length === 0) return false;
  if (sample.includes(0)) return false;
  const text = sample.toString('utf8');
  if (text.includes('\uFFFD')) return false;
  let printable = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (
      code === 9 ||
      code === 10 ||
      code === 13 ||
      (code >= 32 && code !== 127)
    ) {
      printable += 1;
    }
  }
  return printable / [...text].length >= 0.95;
}

/**
 * Detect the format from the bytes alone. Zip containers are refined
 * asynchronously (see detectFile) because the entry list lives in the
 * central directory.
 */
export function sniffBinaryFormat(buffer: Buffer): FileFormat | null {
  if (buffer.length < 4) return null;
  if (startsWith(buffer, [0x25, 0x50, 0x44, 0x46])) return 'pdf'; // %PDF
  if (looksLikeZip(buffer)) return 'zip';
  if (looksLikeLegacyOffice(buffer)) return null;

  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'png';
  }
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (ascii(buffer, 0, 6) === 'gif87a' || ascii(buffer, 0, 6) === 'gif89a') {
    return 'gif';
  }
  if (ascii(buffer, 0, 4) === 'riff') {
    const kind = ascii(buffer, 8, 4);
    if (kind === 'webp') return 'webp';
    if (kind === 'wave') return 'wav';
  }
  if (startsWith(buffer, [0x49, 0x49, 0x2a, 0x00])) return 'tiff';
  if (startsWith(buffer, [0x4d, 0x4d, 0x00, 0x2a])) return 'tiff';
  if (ascii(buffer, 0, 2) === 'bm') return 'bmp';

  if (ascii(buffer, 0, 3) === 'id3') return 'mp3';
  if (buffer.length > 2 && buffer[0] === 0xff && (buffer[1] ?? 0) >= 0xf0) {
    return 'aac';
  }
  if (ascii(buffer, 0, 4) === 'oggs') return 'ogg';
  if (ascii(buffer, 0, 4) === 'flac') return 'flac';
  if (ascii(buffer, 4, 4) === 'ftyp') {
    const brand = ascii(buffer, 8, 4);
    if (brand.startsWith('qt')) return 'mov';
    if (brand.startsWith('m4a') || brand.startsWith('m4b')) return 'm4a';
    return 'mp4';
  }
  if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) return 'webm';

  if (ascii(buffer, 0, 5) === '{\\rtf') return 'rtf';
  if (ascii(buffer, 0, 4) === '%!ps') return null;

  const textHead = buffer
    .subarray(0, 512)
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart()
    .toLowerCase();
  if (textHead.startsWith('<!doctype html') || textHead.startsWith('<html')) {
    return 'html';
  }
  if (textHead.startsWith('webvtt')) return 'vtt';
  if (looksLikeText(buffer)) return 'txt';
  return null;
}

interface ZipKind {
  format: FileFormat;
  container: 'zip';
}

/**
 * Identify which zip-based format a container is by its entry names.
 * OOXML and OpenDocument both ship `mimetype`/manifest files that make the
 * distinction unambiguous; anything else is treated as a plain archive.
 */
export async function refineZipFormat(buffer: Buffer): Promise<ZipKind> {
  const limits = ingestionLimits();
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer, {
      checkCRC32: false,
      createFolders: false,
    });
  } catch {
    // A corrupt zip still has the magic bytes; let the parser surface a
    // precise "invalid or corrupt archive" message.
    return { format: 'zip', container: 'zip' };
  }

  const entries = Object.values(zip.files);
  if (entries.length > limits.maxZipEntries) {
    // Do not enumerate further: the caller rejects the archive with limits.
    return { format: 'zip', container: 'zip' };
  }
  const names = new Set(entries.map((entry) => entry.name));

  if (names.has('word/document.xml')) {
    return { format: 'docx', container: 'zip' };
  }
  if (names.has('ppt/presentation.xml')) {
    return { format: 'pptx', container: 'zip' };
  }
  if (names.has('xl/workbook.xml')) {
    return { format: 'xlsx', container: 'zip' };
  }
  if (names.has('META-INF/container.xml') && names.has('mimetype')) {
    const mimetype = await zip.files.mimetype?.async('string').catch(() => '');
    if (mimetype?.trim() === 'application/epub+zip') {
      return { format: 'epub', container: 'zip' };
    }
  }
  if (names.has('content.xml') && names.has('META-INF/manifest.xml')) {
    const mimetype = await zip.files.mimetype?.async('string').catch(() => '');
    if (
      !mimetype ||
      mimetype.trim().startsWith('application/vnd.oasis.opendocument.text')
    ) {
      return { format: 'odt', container: 'zip' };
    }
  }
  if (names.has('mimetype')) {
    const mimetype = await zip.files.mimetype?.async('string').catch(() => '');
    if (mimetype?.trim() === 'application/epub+zip') {
      return { format: 'epub', container: 'zip' };
    }
    if (
      mimetype?.trim().startsWith('application/vnd.oasis.opendocument.text')
    ) {
      return { format: 'odt', container: 'zip' };
    }
  }
  return { format: 'zip', container: 'zip' };
}

function extensionOf(fileName: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return match?.[1]?.toLowerCase() ?? '';
}

/**
 * Resolve the authoritative format for an uploaded file.
 *
 * Order of truth: magic bytes > plain-text flavour from the extension. A
 * mismatch between the extension and the content is not an error by itself
 * (browsers mislabel files constantly) - the content wins, which is exactly
 * what makes the validation content-addressed.
 */
export async function detectFile(
  buffer: Buffer,
  fileName: string,
): Promise<DetectedFile | null> {
  const sniffed = sniffBinaryFormat(buffer);
  if (sniffed === 'txt') {
    // Plain text carries no format marker: the extension decides whether it
    // is Markdown, CSV, JSON, subtitles, HTML, or plain text.
    const extension = extensionOf(fileName);
    const format = TEXT_EXTENSIONS[extension] ?? 'txt';
    return {
      format,
      mime: mimeForFormat(format),
      category: categoryFor(format),
      inspectedBytes: buffer.length,
    };
  }
  if (sniffed === 'zip') {
    const refined = await refineZipFormat(buffer);
    return {
      format: refined.format,
      mime: mimeForFormat(refined.format),
      category: categoryFor(refined.format),
      container: refined.container,
      inspectedBytes: buffer.length,
    };
  }
  if (sniffed) {
    return {
      format: sniffed,
      mime: mimeForFormat(sniffed),
      category: categoryFor(sniffed),
      inspectedBytes: buffer.length,
    };
  }
  if (looksLikeLegacyOffice(buffer)) return null;
  if (!looksLikeText(buffer)) return null;

  const extension = extensionOf(fileName);
  const format = TEXT_EXTENSIONS[extension] ?? 'txt';
  return {
    format,
    mime: mimeForFormat(format),
    category: categoryFor(format),
    inspectedBytes: buffer.length,
  };
}
