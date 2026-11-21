/**
 * PPTX parser: slides in order, with speaker notes appended.
 *
 * Speaker notes usually carry the explanation the slides omit, which is
 * exactly what a learner wants to retrieve, so they are indexed as part of
 * the slide (under a "Speaker notes" heading) rather than dropped.
 */
import { decodeEntities } from '../readability.js';
import { ingestionLimits } from '../limits.js';
import { openArchive, readEntryText, sortedEntries } from '../zip.js';
import {
  assertHasText,
  buildMetadata,
  type ParseContext,
  type ParsedDocument,
} from './types.js';

/** Text runs of one DrawingML document, one line per paragraph. */
export function extractDrawingText(xml: string): string {
  const lines: string[] = [];
  for (const match of xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/gi)) {
    const inner = match[1] ?? '';
    const runs = [...inner.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi)].map(
      (run) => decodeEntities(run[1] ?? ''),
    );
    const text = runs.join('').replace(/\s+/g, ' ').trim();
    if (text) lines.push(text);
  }
  return lines.join('\n').trim();
}

function slideNumber(name: string): number {
  return Number(/slide(\d+)\.xml$/i.exec(name)?.[1] ?? 0);
}

export async function parsePptx(ctx: ParseContext): Promise<ParsedDocument> {
  const limits = ingestionLimits();
  const archive = await openArchive(ctx.buffer, { limits });
  const budget = { remaining: limits.maxUncompressedBytes };

  const slidePaths = sortedEntries(archive)
    .map((entry) => entry.name)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
  if (slidePaths.length === 0) {
    throw new Error('PPTX contains no slides');
  }

  const pages: Array<{ page: number; text: string }> = [];
  const chapters: Array<{ title: string; page: number }> = [];

  for (const [index, slidePath] of slidePaths.entries()) {
    const xml = await readEntryText(archive, slidePath, budget);
    const body = extractDrawingText(xml);
    const number = slideNumber(slidePath) || index + 1;

    const notesPath = `ppt/notesSlides/notesSlide${number}.xml`;
    let notes = '';
    if (archive.zip.files[notesPath]) {
      notes = extractDrawingText(
        await readEntryText(archive, notesPath, budget),
      );
    }

    if (!body && !notes) continue;
    const title = body.split('\n')[0]?.slice(0, 120) ?? `Slide ${number}`;
    const text = [
      `# Slide ${number}${title && title !== body ? `: ${title}` : ''}`,
      body,
      notes ? `## Speaker notes\n\n${notes}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const page = pages.length + 1;
    pages.push({ page, text });
    chapters.push({
      title: `Slide ${number}${title ? ` - ${title}` : ''}`,
      page,
    });
  }

  assertHasText(pages, 'PPTX');
  return {
    pages,
    title: ctx.fileName,
    metadata: buildMetadata(pages, {
      format: 'pptx',
      kind: 'slides',
      chapters,
      pageCount: pages.length,
    }),
  };
}
