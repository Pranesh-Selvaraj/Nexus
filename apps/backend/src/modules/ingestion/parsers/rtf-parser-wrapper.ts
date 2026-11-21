import {
  assertHasText,
  buildMetadata,
  type ParseContext,
  type ParsedDocument,
} from './types.js';
import { rtfToText } from './rtf.js';

/** RTF document parser (the converter itself is unit tested separately). */
export async function parseRtf(ctx: ParseContext): Promise<ParsedDocument> {
  const raw = ctx.buffer.toString('latin1');
  const text = rtfToText(raw);
  const pages = [{ page: 1, text }];
  assertHasText(pages, 'RTF');
  return {
    pages,
    title: ctx.fileName,
    metadata: buildMetadata(pages, { format: 'rtf', kind: 'document' }),
  };
}
