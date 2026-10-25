/**
 * Audio/video parser: speech-to-text through the existing STT pipeline.
 *
 * Uses the same provider/local-whisper fallback as dictation, so a lecture or
 * podcast becomes transcript chunks with no new infrastructure. Nothing is
 * retained on disk by ingestion (store: false); the original media file
 * remains the document's stored upload.
 */
import { mimeForFormat } from '../magic.js';
import { transcribeAudio } from '../../stt.service.js';
import {
  assertHasText,
  buildMetadata,
  type ParseContext,
  type ParsedDocument,
} from './types.js';

/** Split a long transcript into page-sized blocks at paragraph boundaries. */
export function splitTranscriptP(text: string, maxChars = 3000): string[] {
  const paragraphs = text.split(/\n{2,}/);
  const pages: string[] = [];
  let buffer = '';
  const flush = (): void => {
    if (buffer.trim()) pages.push(buffer.trim());
    buffer = '';
  };
  for (const paragraph of paragraphs) {
    const clean = paragraph.trim();
    if (!clean) continue;
    if (clean.length > maxChars) {
      flush();
      for (let i = 0; i < clean.length; i += maxChars) {
        pages.push(clean.slice(i, i + maxChars).trim());
      }
      continue;
    }
    if (buffer.length + clean.length + 2 > maxChars) flush();
    buffer = buffer ? `${buffer}\n\n${clean}` : clean;
  }
  flush();
  return pages;
}

export async function parseMedia(ctx: ParseContext): Promise<ParsedDocument> {
  const mime = mimeForFormat(ctx.format);
  const transcription = await transcribeAudio({
    buffer: ctx.buffer,
    filename: ctx.fileName,
    mimeType: mime,
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    store: false,
  });

  const parts = splitTranscriptP(transcription.text);
  const pages = parts.map((text, index) => ({
    page: index + 1,
    text: `## Transcript ${index + 1}\n\n${text}`,
  }));
  assertHasText(pages, ctx.fileName);

  const isVideo =
    ctx.format === 'mp4' || ctx.format === 'webm' || ctx.format === 'mov';
  return {
    pages,
    title: ctx.fileName,
    metadata: buildMetadata(pages, {
      format: ctx.format,
      kind: isVideo ? 'video' : 'audio',
      transcript: true,
      durationSeconds:
        transcription.durationMs !== null
          ? Math.round(transcription.durationMs / 1000)
          : null,
      pageCount: pages.length,
    }),
  };
}
