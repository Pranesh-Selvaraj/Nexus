/**
 * Plain-text family parser: txt, md, csv, json, and saved HTML handled
 * separately. Keeps the original text (structure such as Markdown headings is
 * what the chunker uses to build section paths).
 */
import {
  assertHasText,
  buildMetadata,
  type ParseContext,
  type ParsedDocument,
} from './types.js';

/** Decode UTF-8 (with BOM removal) and normalise line endings. */
export function decodeTextFile(buffer: Buffer): string {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  return text.replace(/\r\n?/g, '\n').trim();
}

export async function parseText(ctx: ParseContext): Promise<ParsedDocument> {
  const text = decodeTextFile(ctx.buffer);
  const pages = [{ page: 1, text }];
  assertHasText(pages, ctx.fileName);
  return {
    pages,
    title: ctx.fileName,
    metadata: buildMetadata(pages, {
      format: ctx.format,
      kind: ctx.format === 'csv' ? 'sheet' : 'document',
    }),
  };
}
