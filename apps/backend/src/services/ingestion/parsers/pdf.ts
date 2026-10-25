/**
 * PDF parser: layout-preserving text extraction with an OCR fallback.
 *
 * Text PDFs are read page by page (shared with the retrieval chunker, which
 * owns the page-number correctness fix). Scanned PDFs - pages with almost no
 * embedded text - go through tesseract via the OCR module when the user has
 * OCR enabled. When OCR is unavailable the error explains what to install
 * instead of reporting an empty document.
 */
import {
  extractPages,
  extractPdfPagesFromBuffer,
  type SourcePage,
} from '../../chunking.service.js';
import { ocrPdfPages } from '../ocr.js';
import { getSettingBoolean } from '../../settings.service.js';
import {
  assertHasText,
  buildMetadata,
  type ParseContext,
  type ParsedDocument,
} from './types.js';

/** Average characters per page below which a PDF is treated as scanned. */
const SCANNED_TEXT_THRESHOLD = 40;

/** True when the extracted text looks like a scan (no/sparse text layer). */
export function looksScanned(pages: SourcePage[]): boolean {
  if (pages.length === 0) return true;
  const chars = pages.reduce((sum, page) => sum + page.text.trim().length, 0);
  return chars / pages.length < SCANNED_TEXT_THRESHOLD;
}

export async function parsePdf(ctx: ParseContext): Promise<ParsedDocument> {
  let pages: SourcePage[] = [];
  let textError: Error | null = null;
  try {
    // Members of an uploaded ZIP folder arrive as a buffer (no path).
    pages = ctx.filePath
      ? await extractPages(ctx.filePath, 'pdf')
      : await extractPdfPagesFromBuffer(ctx.buffer);
  } catch (error) {
    textError = error instanceof Error ? error : new Error(String(error));
  }

  const scanned = looksScanned(pages);
  let ocr = false;
  const ocrEnabled =
    ctx.options?.ocr ?? (await getSettingBoolean('vision.ocrEnabled'));
  // OCR rasterizes from disk; a PDF inside a ZIP folder has no path, so a
  // scanned member falls through to the "no extractable text" error instead.
  if (scanned && ocrEnabled && ctx.filePath) {
    try {
      const ocrPages = await ocrPdfPages(ctx.filePath, {
        languages: ctx.options?.ocrLanguages,
      });
      if (ocrPages.length > 0) {
        pages = ocrPages;
        ocr = true;
        textError = null;
      }
    } catch (error) {
      const ocrError =
        error instanceof Error
          ? error
          : new Error(String(error), { cause: error });
      if (pages.length === 0) {
        throw new Error(
          `PDF contains no extractable text. ${ocrError.message}`,
          { cause: error },
        );
      }
    }
  }

  if (pages.length === 0) {
    throw textError ?? new Error('PDF contains no extractable text');
  }
  assertHasText(pages, 'PDF');

  return {
    pages,
    title: ctx.fileName,
    metadata: buildMetadata(pages, {
      format: 'pdf',
      kind: 'document',
      ocr,
      pageCount: pages.length,
    }),
  };
}

/** OCR a scanned PDF regardless of the auto-detection (used by tests). */
export async function ocrScannedPdf(
  ctx: ParseContext,
): Promise<ParsedDocument> {
  const ocrPages = await ocrPdfPages(ctx.filePath);
  assertHasText(ocrPages, 'PDF');
  return {
    pages: ocrPages,
    title: ctx.fileName,
    metadata: buildMetadata(ocrPages, {
      format: 'pdf',
      kind: 'document',
      ocr: true,
      pageCount: ocrPages.length,
    }),
  };
}
