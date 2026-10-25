import { describe, expect, it, vi } from 'vitest';

// The STT service talks to settings + providers; the parser contract is only
// "transcribe, then split into pages", so it is mocked at the module boundary.
vi.mock('../stt.service.js', () => ({
  transcribeAudio: vi.fn(async () => ({
    text: 'First paragraph about retrieval.\n\nSecond paragraph about embeddings and how they are stored.',
    language: 'en',
    provider: 'stub',
    durationMs: 125_000,
    audioId: null,
  })),
}));

import { parseMedia, splitTranscriptP } from './parsers/media.js';
import type { ParseContext } from './parsers/types.js';

const baseContext: ParseContext = {
  buffer: Buffer.from('audio-bytes'),
  filePath: '/tmp/lecture.mp3',
  fileName: 'lecture.mp3',
  format: 'mp3',
  userId: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  documentId: '33333333-3333-4333-8333-333333333333',
};

describe('transcript splitting', () => {
  it('splits at paragraph boundaries and hard-splits long paragraphs', () => {
    expect(splitTranscriptP('one\n\ntwo', 6)).toEqual(['one', 'two']);
    expect(splitTranscriptP('one\n\ntwo', 100)).toEqual(['one\n\ntwo']);
    const long = 'x'.repeat(25);
    expect(splitTranscriptP(long, 10)).toHaveLength(3);
    expect(splitTranscriptP('   \n\n  ', 10)).toEqual([]);
  });
});

describe('media parser', () => {
  it('turns a transcription into transcript pages with duration metadata', async () => {
    const parsed = await parseMedia(baseContext);
    expect(parsed.pages).toHaveLength(1);
    expect(parsed.pages[0]?.text).toContain('## Transcript 1');
    expect(parsed.pages[0]?.text).toContain('Second paragraph');
    expect(parsed.metadata.kind).toBe('audio');
    expect(parsed.metadata.transcript).toBe(true);
    expect(parsed.metadata.durationSeconds).toBe(125);
  });

  it('labels video files as video', async () => {
    const parsed = await parseMedia({ ...baseContext, format: 'mp4' });
    expect(parsed.metadata.kind).toBe('video');
  });
});
