/**
 * ODT (OpenDocument Text) parser.
 *
 * content.xml is a flat XML document where structure lives in `text:` tags:
 * headings carry an outline level, lists carry items, tables carry rows.
 * Converting those to Markdown headings/lists/rows preserves the structure
 * the chunker uses for section paths.
 */
import { decodeEntities } from '../readability.js';
import { ingestionLimits } from '../limits.js';
import { openArchive, readEntryText } from '../zip.js';
import {
  assertHasText,
  buildMetadata,
  type ParseContext,
  type ParsedDocument,
} from './types.js';

/** Convert OpenDocument content.xml to Markdown-ish text. */
export function odtContentToText(xml: string): {
  text: string;
  chapters: Array<{ title: string; page: number }>;
} {
  let out = xml
    .replace(/<text:line-break\b[^>]*\/?>/gi, '\n')
    .replace(/<text:s\b[^>]*\/?>/gi, ' ')
    .replace(/<text:tab\b[^>]*\/?>/gi, '\t')
    .replace(
      /<text:h\b[^>]*text:outline-level="(\d)"[^>]*>/gi,
      (_m, level: string) =>
        `\n\n${'#'.repeat(Math.min(6, Number(level) || 1))} `,
    )
    .replace(/<\/text:h>/gi, '\n\n')
    .replace(/<text:list-item\b[^>]*>/gi, '\n- ')
    .replace(/<\/text:list-item>/gi, '\n')
    .replace(/<text:p\b[^>]*>/gi, '\n')
    .replace(/<\/text:p>/gi, '\n')
    .replace(/<table:table-row\b[^>]*>/gi, '\n')
    .replace(/<table:table-cell\b[^>]*>/gi, ' | ')
    .replace(/<\/table:table>/gi, '\n\n')
    .replace(/<text:soft-page-break\b[^>]*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '');

  out = decodeEntities(out)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const chapters: Array<{ title: string; page: number }> = [];
  for (const match of out.matchAll(/^#{1,6} (.+)$/gm)) {
    const title = (match[1] ?? '').trim();
    if (title) chapters.push({ title, page: 1 });
  }
  return { text: out, chapters };
}

export async function parseOdt(ctx: ParseContext): Promise<ParsedDocument> {
  const limits = ingestionLimits();
  const archive = await openArchive(ctx.buffer, { limits });
  const budget = { remaining: limits.maxUncompressedBytes };
  const xml = await readEntryText(archive, 'content.xml', budget);
  const { text, chapters } = odtContentToText(xml);
  const pages = [{ page: 1, text }];
  assertHasText(pages, 'ODT');
  return {
    pages,
    title: ctx.fileName,
    metadata: buildMetadata(pages, {
      format: 'odt',
      kind: 'document',
      chapters,
    }),
  };
}
