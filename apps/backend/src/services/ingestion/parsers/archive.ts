/**
 * ZIP folder parser: every supported member becomes a section.
 *
 * Nested containers (a zip inside a zip, an EPUB inside a folder) are not
 * descended into: one level of expansion is enough for "upload my notes
 * folder" and keeps decompression work bounded. Member names become the
 * chapter titles so citations say which file a passage came from.
 */
import { detectFile, EXECUTABLE_EXTENSIONS } from '../magic.js';
import { ingestionLimits } from '../limits.js';
import { openArchive, readEntryBuffer, sortedEntries } from '../zip.js';
import { parseDocx } from './docx.js';
import { parseHtml } from './html.js';
import { parsePdf } from './pdf.js';
import { parseRtf } from './rtf-parser-wrapper.js';
import { parseSubtitles } from './subtitles.js';
import { parseText } from './text.js';
import {
  type ParseContext,
  type ParsedDocument,
  type Parser,
  buildMetadata,
} from './types.js';

/** Member formats a folder import understands (no nested containers). */
const MEMBER_PARSERS: Record<string, Parser> = {
  pdf: parsePdf,
  docx: parseDocx,
  html: parseHtml,
  txt: parseText,
  md: parseText,
  csv: parseText,
  json: parseText,
  rtf: parseRtf,
  srt: parseSubtitles,
  vtt: parseSubtitles,
};

function skipMember(name: string): boolean {
  const base = name.split('/').pop() ?? name;
  if (!base || base.startsWith('.')) return true;
  if (name.startsWith('__MACOSX/')) return true;
  if (name.includes('/.')) return true;
  if (/^(thumbs\.db|desktop\.ini)$/i.test(base)) return true;
  const extension = /\.([a-z0-9]+)$/i.exec(base)?.[1]?.toLowerCase() ?? '';
  return EXECUTABLE_EXTENSIONS.has(extension);
}

export async function parseArchive(ctx: ParseContext): Promise<ParsedDocument> {
  const limits = ingestionLimits();
  const archive = await openArchive(ctx.buffer, { limits });
  const budget = { remaining: limits.maxUncompressedBytes };

  const pages: Array<{ page: number; text: string }> = [];
  const chapters: Array<{ title: string; page: number }> = [];
  const skipped: string[] = [];
  let totalChars = 0;

  for (const entry of sortedEntries(archive)) {
    if (pages.length >= limits.maxZipEntries) break;
    if (skipMember(entry.name)) continue;
    if (totalChars >= limits.maxTextChars) break;

    const buffer = await readEntryBuffer(archive, entry.name, budget);
    const detected = await detectFile(buffer, entry.name);
    const parser = detected ? MEMBER_PARSERS[detected.format] : undefined;
    if (!detected || !parser) {
      skipped.push(entry.name);
      continue;
    }

    try {
      const memberCtx: ParseContext = {
        ...ctx,
        buffer,
        fileName: entry.name,
        format: detected.format,
        filePath: '',
      };
      const parsed = await parser(memberCtx);
      const page = pages.length + 1;
      const body = parsed.pages
        .map((memberPage) => memberPage.text)
        .join('\n\n')
        .trim();
      if (!body) continue;
      pages.push({ page, text: `# ${entry.name}\n\n${body}` });
      chapters.push({ title: entry.name, page });
      totalChars += body.length;
    } catch {
      // A single unreadable member must not fail the whole folder import.
      skipped.push(entry.name);
    }
  }

  if (pages.length === 0) {
    throw new Error(
      skipped.length > 0
        ? 'The archive contains no supported documents (PDF, DOCX, HTML, text, Markdown, CSV, JSON, RTF, SRT, VTT)'
        : 'The archive contains no readable documents',
    );
  }

  return {
    pages,
    title: ctx.fileName,
    metadata: buildMetadata(pages, {
      format: 'zip',
      kind: 'archive',
      chapters,
      pageCount: pages.length,
    }),
  };
}
