import { z } from 'zod';
export const documentStatusSchema = z.enum([
  'processing',
  'ready',
  'failed',
  'deleted',
]);
export type DocumentStatus = z.infer<typeof documentStatusSchema>;

/**
 * What an ingested file actually is, derived from its bytes (magic bytes for
 * containers and images, text heuristics for prose) rather than only from the
 * name the client sent. The parser registry keys off this value.
 */
export const fileFormatSchema = z.enum([
  'pdf',
  'docx',
  'pptx',
  'xlsx',
  'odt',
  'rtf',
  'epub',
  'zip',
  'html',
  'txt',
  'md',
  'csv',
  'json',
  'srt',
  'vtt',
  'png',
  'jpeg',
  'webp',
  'gif',
  'tiff',
  'bmp',
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
export type FileFormat = z.infer<typeof fileFormatSchema>;

export const fileCategorySchema = z.enum([
  'document',
  'image',
  'audio',
  'video',
  'archive',
]);
export type FileCategory = z.infer<typeof fileCategorySchema>;

export const IMAGE_FILE_TYPES: FileFormat[] = [
  'png',
  'jpeg',
  'webp',
  'gif',
  'tiff',
  'bmp',
];

export const MEDIA_FILE_TYPES: FileFormat[] = [
  'mp3',
  'wav',
  'ogg',
  'flac',
  'm4a',
  'aac',
  'webm',
  'mp4',
  'mov',
];

/** True for formats the UI can render as an <img> (vision-capable). */
export function isImageFileType(fileType: string | null | undefined): boolean {
  return (
    !!fileType &&
    (IMAGE_FILE_TYPES as string[]).includes(fileType.toLowerCase())
  );
}

/** True for audio/video formats transcribed through the STT pipeline. */
export function isMediaFileType(fileType: string | null | undefined): boolean {
  return (
    !!fileType &&
    (MEDIA_FILE_TYPES as string[]).includes(fileType.toLowerCase())
  );
}

/**
 * Structure the ingestion pipeline extracted from a document: the format it
 * detected, whether OCR/vision/transcription ran, and the table of contents.
 * Rendered as document cards in the library and used to label citations.
 */
export const documentStructureSchema = z.object({
  /** Parser that produced the text (usually the detected file format). */
  format: z.string(),
  /** Human-facing family: book, slides, sheet, web, image, transcript, ... */
  kind: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  /** Original URL for web/YouTube ingestion. */
  sourceUrl: z.string().nullable().optional(),
  /** ISO timestamp of the fetch that produced sourceUrl content. */
  fetchedAt: z.string().nullable().optional(),
  pageCount: z.number().int().nonnegative().nullable().optional(),
  wordCount: z.number().int().nonnegative().nullable().optional(),
  /** Estimated reading time in minutes (~200 words/min). */
  readingMinutes: z.number().int().nonnegative().nullable().optional(),
  /** True when OCR (tesseract) produced the text. */
  ocr: z.boolean().optional(),
  /** True when a vision model described the image. */
  vision: z.boolean().optional(),
  /** True when the text is a speech-to-text transcript. */
  transcript: z.boolean().optional(),
  /** Spoken duration for audio/video, in seconds. */
  durationSeconds: z.number().nonnegative().nullable().optional(),
  /** Table of contents (chapters, slides, sheets, archive members). */
  chapters: z
    .array(
      z.object({
        title: z.string(),
        page: z.number().int().nonnegative(),
      }),
    )
    .optional(),
});
export type DocumentStructure = z.infer<typeof documentStructureSchema>;

export const documentDTOSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  title: z.string(),
  fileType: z.string().nullable(),
  status: documentStatusSchema,
  chunkCount: z.number().int().nonnegative(),
  /** Sanitized reason the last indexing attempt failed, if any. */
  errorMessage: z.string().nullable(),
  /** Number of indexing attempts made so far. */
  attempts: z.number().int().nonnegative(),
  /** True when some chunks were embedded with a different/unknown model. */
  needsReindex: z.boolean(),
  /** Structure extracted at ingestion (format, TOC, OCR/vision flags). */
  metadata: documentStructureSchema.nullable().optional(),
  /** Canonical URL for URL/YouTube ingestion. */
  sourceUrl: z.string().nullable().optional(),
  /** sha256 of the uploaded bytes, used for duplicate detection. */
  contentHash: z.string().nullable().optional(),
  createdAt: z.string(),
  /** Bytes of the stored file (0 for documents uploaded before accounting). */
  sizeBytes: z.number().int().nonnegative().optional(),
  /** Set while the document sits in the trash. */
  deletedAt: z.string().nullable().optional(),
});

export const retrievalStatusSchema = z.object({
  currentModel: z.string(),
  currentDims: z.number().int(),
  totalDocuments: z.number().int().nonnegative(),
  documentsNeedingReindex: z.number().int().nonnegative(),
  documentsReindexing: z.number().int().nonnegative(),
});
export type RetrievalStatus = z.infer<typeof retrievalStatusSchema>;
export type DocumentDTO = z.infer<typeof documentDTOSchema>;

export const listDocumentsInputSchema = z.object({
  workspaceId: z.string().uuid(),
});

/** POST /api/ingest/url body: a web article or a YouTube link. */
export const ingestUrlInputSchema = z.object({
  workspaceId: z.string().uuid(),
  url: z.string().trim().min(8).max(2048),
});
export type IngestUrlInput = z.infer<typeof ingestUrlInputSchema>;

export const ingestUrlResultSchema = z.object({
  document: documentDTOSchema,
  /** 'article' for Readability-extracted pages, 'video' for transcripts. */
  kind: z.enum(['article', 'video']),
  sourceUrl: z.string(),
  title: z.string(),
  wordCount: z.number().int().nonnegative(),
});
export type IngestUrlResult = z.infer<typeof ingestUrlResultSchema>;

export const documentIdSchema = z.object({
  documentId: z.string().uuid(),
});
