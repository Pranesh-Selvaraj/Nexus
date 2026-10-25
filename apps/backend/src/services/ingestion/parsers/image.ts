/**
 * Image parser: OCR text plus a vision-model description, both searchable.
 *
 * Neither source is mandatory. With OCR only, the visible text is indexed;
 * with vision only, the description is indexed; with both, the description
 * leads and the OCR text follows so labels/equations stay exact and
 * retrievable. When neither is available the error says why, which is more
 * useful than silently creating an empty document.
 */
import { mimeForFormat, isImageFormat } from '../magic.js';
import { ocrAvailable, ocrImage } from '../ocr.js';
import { describeImageForIndex, imageMetadata } from '../vision.service.js';
import { getSetting, getSettingBoolean } from '../../settings.service.js';
import {
  assertHasText,
  buildMetadata,
  type ParseContext,
  type ParsedDocument,
} from './types.js';

export async function parseImage(ctx: ParseContext): Promise<ParsedDocument> {
  const mime = mimeForFormat(ctx.format);
  if (!isImageFormat(ctx.format)) {
    throw new Error(`${ctx.format} is not an image format`);
  }

  const ocrEnabled =
    ctx.options?.ocr ?? (await getSettingBoolean('vision.ocrEnabled'));
  const ocrPresent = await ocrAvailable();

  let ocrText = '';
  let ocrError: Error | null = null;
  if (ocrEnabled) {
    if (!ocrPresent) {
      ocrError = new Error(
        'OCR is not installed (install tesseract-ocr or set TESSERACT_BIN)',
      );
    } else {
      try {
        // Only consult the settings row when the caller did not pin OCR
        // explicitly (tests and callers that pre-resolved settings).
        const languages =
          ctx.options?.ocrLanguages ??
          (ctx.options?.ocr === undefined
            ? (await getSetting('vision.ocrLanguages')) || 'eng'
            : undefined);
        ocrText = await ocrImage(ctx.buffer, { languages });
      } catch (error) {
        ocrError = error instanceof Error ? error : new Error(String(error));
      }
    }
  }

  let description: string | null = null;
  let visionUsed = false;
  const visionEnabled =
    ctx.options?.vision ?? (await getSettingBoolean('vision.enabled'));
  try {
    const result = visionEnabled
      ? await describeImageForIndex(ctx.buffer, mime, ctx.fileName)
      : null;
    if (result) {
      description = result.description;
      visionUsed = true;
    }
  } catch (error) {
    // A vision provider failure must not lose the OCR text; surface it only
    // when OCR produced nothing (below).
    if (!ocrText) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  if (!description && !ocrText) {
    throw new Error(
      `No text could be extracted from this image. ${
        ocrError?.message ??
        'Enable OCR or configure a vision provider in Settings to index images.'
      }`,
    );
  }

  const sections = [`# Image: ${ctx.fileName}`];
  if (description) sections.push(`## Description\n\n${description}`);
  if (ocrText) sections.push(`## Text in the image\n\n${ocrText}`);
  const pages = [{ page: 1, text: sections.join('\n\n') }];
  assertHasText(pages, ctx.fileName);

  return {
    pages,
    title: ctx.fileName,
    metadata: buildMetadata(pages, {
      ...imageMetadata({
        format: ctx.format,
        ocr: Boolean(ocrText),
        vision: visionUsed,
      }),
      title: ctx.fileName,
    }),
  };
}
