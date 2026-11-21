/**
 * DOCX parser (mammoth's raw-text extraction).
 */
import mammoth from 'mammoth';

import {
  assertHasText,
  buildMetadata,
  type ParseContext,
  type ParsedDocument,
} from './types.js';

export async function parseDocx(ctx: ParseContext): Promise<ParsedDocument> {
  const result = await mammoth.extractRawText({ buffer: ctx.buffer });
  const text = result.value.trim();
  const pages = [{ page: 1, text }];
  assertHasText(pages, 'DOCX');
  return {
    pages,
    title: ctx.fileName,
    metadata: buildMetadata(pages, { format: 'docx', kind: 'document' }),
  };
}
