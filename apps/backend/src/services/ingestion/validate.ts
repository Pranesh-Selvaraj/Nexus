/**
 * Upload admission: the single gate every stored file passes through.
 *
 * Validation is content-addressed (bytes decide the parser), with two extra
 * guards layered on top for this deployment:
 *  - executable/script extensions are refused outright so the uploads volume
 *    never holds something a future feature might be tempted to run;
 *  - zip-based containers are opened and checked against the zip-bomb limits
 *    before a document row is created (a 400 instead of a failed job later).
 */
import { createHash } from 'node:crypto';

import type { FileFormat } from '@nexus/shared-types';

import {
  detectFile,
  EXECUTABLE_EXTENSIONS,
  isImageFormat,
  looksLikeLegacyOffice,
  mimeForFormat,
  type DetectedFile,
} from './magic.js';
import { SUPPORTED_IMAGE_MIME } from './vision.service.js';
import { openArchive, ZipLimitError } from './zip.js';

export class UploadRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadRejectedError';
  }
}

export { EXECUTABLE_EXTENSIONS };

/** Containers that must pass the zip-bomb limits before being accepted. */
export const ZIP_FORMATS = new Set<FileFormat>([
  'docx',
  'pptx',
  'xlsx',
  'odt',
  'epub',
  'zip',
]);

export interface ValidatedUpload {
  detected: DetectedFile;
  contentHash: string;
  mime: string;
}

function extensionOf(fileName: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return match?.[1]?.toLowerCase() ?? '';
}

/**
 * Validate one uploaded buffer.
 *
 * @throws UploadRejectedError with a user-facing message (mapped to HTTP 400).
 */
export async function validateUpload(
  buffer: Buffer,
  fileName: string,
  options: { maxImageMb: number },
): Promise<ValidatedUpload> {
  if (buffer.byteLength === 0) {
    throw new UploadRejectedError('The file is empty');
  }
  const extension = extensionOf(fileName);
  if (EXECUTABLE_EXTENSIONS.has(extension)) {
    throw new UploadRejectedError(
      'Executable and script files cannot be uploaded - archive or export the content as a document instead',
    );
  }

  const detected = await detectFile(buffer, fileName);
  if (!detected) {
    throw new UploadRejectedError(
      looksLikeLegacyOffice(buffer)
        ? 'Legacy Office files (.doc/.xls/.ppt) are not supported - save as .docx/.xlsx/.pptx and upload again'
        : 'Unrecognised file content. Supported: PDF, EPUB, DOCX, PPTX, XLSX, ODT, RTF, HTML, ZIP, text/Markdown/CSV/JSON, SRT/VTT, audio/video, and images.',
    );
  }

  if (ZIP_FORMATS.has(detected.format)) {
    try {
      await openArchive(buffer);
    } catch (error) {
      if (error instanceof ZipLimitError) {
        throw new UploadRejectedError(error.message);
      }
      throw error;
    }
  }

  if (isImageFormat(detected.format)) {
    const mime = mimeForFormat(detected.format);
    if (!SUPPORTED_IMAGE_MIME.has(mime)) {
      throw new UploadRejectedError(
        'Image format not supported for ingestion (use PNG, JPEG, WebP or GIF)',
      );
    }
    const maxBytes = options.maxImageMb * 1024 * 1024;
    if (buffer.byteLength > maxBytes) {
      throw new UploadRejectedError(
        `Image exceeds the ${options.maxImageMb} MB vision limit`,
      );
    }
  }

  return {
    detected,
    mime: mimeForFormat(detected.format),
    contentHash: createHash('sha256').update(buffer).digest('hex'),
  };
}
