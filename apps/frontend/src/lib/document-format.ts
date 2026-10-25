/**
 * Presentation helpers for ingested documents.
 *
 * The server stores what the bytes actually are (`fileType`) plus the
 * structure the parser extracted (`metadata`). These helpers turn that into
 * the short labels the library cards show, so the format badge, reading time
 * and provenance chips stay consistent everywhere.
 */
import type { DocumentDTO, DocumentStructure } from '@nexus/shared-types';
import { isImageFileType, isMediaFileType } from '@nexus/shared-types';

const FORMAT_LABELS: Record<string, string> = {
  pdf: 'PDF',
  docx: 'DOCX',
  pptx: 'PPTX',
  xlsx: 'XLSX',
  odt: 'ODT',
  rtf: 'RTF',
  epub: 'EPUB',
  zip: 'ZIP',
  html: 'HTML',
  txt: 'TXT',
  md: 'MD',
  csv: 'CSV',
  json: 'JSON',
  srt: 'SRT',
  vtt: 'VTT',
  png: 'PNG',
  jpeg: 'JPEG',
  webp: 'WebP',
  gif: 'GIF',
  tiff: 'TIFF',
  bmp: 'BMP',
  mp3: 'MP3',
  wav: 'WAV',
  ogg: 'OGG',
  flac: 'FLAC',
  m4a: 'M4A',
  aac: 'AAC',
  webm: 'WebM',
  mp4: 'MP4',
  mov: 'MOV',
};

/** Short uppercase badge for a format ("EPUB", "JPEG"); null when unknown. */
export function formatLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value.toLowerCase().replace(/^\./, '');
  return FORMAT_LABELS[key] ?? key.toUpperCase().slice(0, 8);
}

export function isImageDocument(doc: { fileType?: string | null }): boolean {
  return isImageFileType(doc.fileType);
}

export function isMediaDocument(doc: { fileType?: string | null }): boolean {
  return isMediaFileType(doc.fileType);
}

/** Server-rendered image bytes (ownership enforced server-side). */
export function documentImageUrl(documentId: string): string {
  return `/api/images/${documentId}`;
}

export interface DocumentChip {
  label: string;
  tone: 'default' | 'accent' | 'warn';
  title: string;
}

/**
 * Provenance chips: how the text was obtained. A user looking at a card
 * should see at a glance whether a PDF was OCR'd and whether an image was
 * described by a vision model.
 */
export function documentChips(
  metadata: DocumentStructure | null | undefined,
): DocumentChip[] {
  if (!metadata) return [];
  const chips: DocumentChip[] = [];
  if (metadata.ocr) {
    chips.push({
      label: 'OCR',
      tone: 'warn',
      title: 'Text was read from page images with OCR',
    });
  }
  if (metadata.vision) {
    chips.push({
      label: 'Vision',
      tone: 'accent',
      title: 'A vision model described this image for search',
    });
  }
  if (metadata.transcript) {
    chips.push({
      label: 'Transcript',
      tone: 'accent',
      title: 'Text is a speech-to-text transcript',
    });
  }
  return chips;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "about 40 min read" from the stored reading time. */
export function readingTimeLabel(
  minutes: number | null | undefined,
): string | null {
  if (minutes == null || minutes <= 0) return null;
  if (minutes < 60) return `${minutes} min read`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0
    ? `${plural(hours, 'hour')} read`
    : `${hours}h ${rest}m read`;
}

/** "12 min audio" from a duration in seconds. */
export function durationLabel(
  seconds: number | null | undefined,
): string | null {
  if (seconds == null || seconds <= 0) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/**
 * The one-line summary under a document title: what it is, how big it is and
 * how long it takes to read. Empty parts are skipped, never rendered as "—".
 */
export function structureSummary(
  metadata: DocumentStructure | null | undefined,
  fallback?: { wordCount?: number | null },
): string[] {
  if (!metadata) return [];
  // An image's "word count" is the description/OCR length, not reading
  // effort: the card shows the format badge and the provenance chips instead.
  if (metadata.kind === 'image') return ['Image'];
  const parts: string[] = [];
  // 'document' is the fallback kind for plain text files: it adds no
  // information, so the line starts with the useful numbers instead.
  if (metadata.kind && metadata.kind !== 'document') {
    parts.push(metadata.kind.charAt(0).toUpperCase() + metadata.kind.slice(1));
  }
  if (metadata.author) parts.push(metadata.author);
  if (metadata.pageCount != null && metadata.pageCount > 1) {
    parts.push(plural(metadata.pageCount, 'page'));
  }
  if (metadata.chapters && metadata.chapters.length > 0) {
    parts.push(plural(metadata.chapters.length, 'section'));
  }
  const wordCount = metadata.wordCount ?? fallback?.wordCount ?? null;
  if (wordCount != null && wordCount > 0) {
    parts.push(`${wordCount.toLocaleString()} words`);
  }
  const reading = readingTimeLabel(metadata.readingMinutes);
  if (reading) parts.push(reading);
  const duration = durationLabel(metadata.durationSeconds);
  if (duration) parts.push(duration);
  return parts;
}

/** True when the document came from a URL (article or video). */
export function isRemoteDocument(
  doc: Pick<DocumentDTO, 'sourceUrl' | 'metadata'>,
): boolean {
  return Boolean(doc.sourceUrl ?? doc.metadata?.sourceUrl);
}

/** The source URL for a remote document, if any. */
export function documentSourceUrl(
  doc: Pick<DocumentDTO, 'sourceUrl' | 'metadata'>,
): string | null {
  return doc.sourceUrl ?? doc.metadata?.sourceUrl ?? null;
}
