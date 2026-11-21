/**
 * Subtitle parsers (SRT, WebVTT).
 *
 * Subtitles are already timestamped transcripts, so they go through the same
 * transcript page builder as YouTube: chunks carry `[mm:ss]` markers and a
 * Transcript heading instead of pretending to be page 1 of a document.
 */
import {
  buildTranscriptPages,
  formatTimestamp,
  type TranscriptCue,
} from '../youtube.js';
import {
  assertHasText,
  buildMetadata,
  type ParseContext,
  type ParsedDocument,
} from './types.js';

function parseTimestamp(value: string): number | null {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(
    value.trim(),
  );
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  const millis = Number((match[4] ?? '0').padEnd(3, '0'));
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

/** Parse SRT (comma decimals) and WebVTT (dot decimals, optional cue ids). */
export function parseSubtitleCues(input: string): TranscriptCue[] {
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const blocks = text.split(/\n{2,}/);
  const cues: TranscriptCue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trimEnd());
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex === -1) continue;
    const timing = lines[timingIndex] ?? '';
    const [rawStart, rawEnd] = timing.split('-->');
    const start = parseTimestamp((rawStart ?? '').trim());
    const end = parseTimestamp((rawEnd ?? '').trim().split(/\s+/)[0] ?? '');
    if (start === null) continue;
    const body = lines
      .slice(timingIndex + 1)
      .join(' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!body) continue;
    cues.push({
      start,
      duration: end === null ? 0 : Math.max(0, end - start),
      text: body,
    });
  }
  return cues;
}

/** Shift cues so the transcript starts at 0 (VTT allows a large offset). */
export function normaliseCueStart(cues: TranscriptCue[]): TranscriptCue[] {
  if (cues.length === 0) return cues;
  const first = cues[0]?.start ?? 0;
  if (first <= 0) return cues;
  return cues.map((cue) => ({ ...cue, start: Math.max(0, cue.start - first) }));
}

export async function parseSubtitles(
  ctx: ParseContext,
): Promise<ParsedDocument> {
  const input = ctx.buffer.toString('utf8');
  const cues = normaliseCueStart(parseSubtitleCues(input));
  const pages = buildTranscriptPages(cues);
  assertHasText(pages, ctx.fileName);
  const last = cues[cues.length - 1];
  return {
    pages,
    title: ctx.fileName,
    metadata: buildMetadata(pages, {
      format: ctx.format,
      kind: 'subtitles',
      transcript: true,
      durationSeconds: last ? Math.round(last.start + last.duration) : 0,
      chapters: [
        {
          title: cues[0]
            ? `from ${formatTimestamp(cues[0].start)}`
            : 'Transcript',
          page: 1,
        },
      ],
    }),
  };
}
