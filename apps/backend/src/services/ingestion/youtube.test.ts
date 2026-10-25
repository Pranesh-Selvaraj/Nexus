import { describe, expect, it } from 'vitest';

import {
  buildTranscriptPages,
  formatTimestamp,
  isYouTubeUrl,
  parseCaptionTracks,
  parseTimedTextXml,
  parseYouTubeVideoId,
  pickCaptionTrack,
} from './youtube.js';

describe('YouTube URL parsing', () => {
  it('extracts the video id from every common URL shape', () => {
    const id = 'dQw4w9WgXcQ';
    for (const url of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtube.com/watch?v=${id}&t=42s`,
      `https://m.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube.com/live/${id}`,
    ]) {
      expect(parseYouTubeVideoId(url), url).toBe(id);
    }
  });

  it('rejects non-YouTube hosts and malformed ids', () => {
    expect(
      parseYouTubeVideoId('https://example.com/watch?v=dQw4w9WgXcQ'),
    ).toBeNull();
    expect(
      parseYouTubeVideoId('https://www.youtube.com/watch?v=short'),
    ).toBeNull();
    expect(parseYouTubeVideoId('not a url')).toBeNull();
    expect(isYouTubeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
    expect(isYouTubeUrl('https://vimeo.com/12345')).toBe(false);
  });
});

describe('caption tracks', () => {
  const page = `<html><script>var ytInitialPlayerResponse = {
    "captions": { "playerCaptionsTracklistRenderer": { "captionTracks": [
      {"baseUrl":"https://www.youtube.com/api/timedtext?v=abc&lang=de","languageCode":"de","name":{"simpleText":"Deutsch"}},
      {"baseUrl":"https://www.youtube.com/api/timedtext?v=abc&lang=en&kind=asr","languageCode":"en","kind":"asr","name":{"runs":[{"text":"English "},{"text":"(auto)"}]}},
      {"baseUrl":"https://www.youtube.com/api/timedtext?v=abc&lang=en","languageCode":"en","name":{"simpleText":"English"}}
    ] } } };</script></html>`;

  it('parses caption track metadata', () => {
    const tracks = parseCaptionTracks(page);
    expect(tracks).toHaveLength(3);
    expect(tracks[1]?.name).toBe('English (auto)');
    expect(tracks[1]?.kind).toBe('asr');
  });

  it('prefers a human English track, then auto English, then anything', () => {
    const tracks = parseCaptionTracks(page);
    expect(pickCaptionTrack(tracks)?.baseUrl).toContain('lang=en');
    expect(pickCaptionTrack(tracks)?.kind).toBeNull();
    expect(
      pickCaptionTrack([
        { baseUrl: 'a', languageCode: 'de', kind: null, name: null },
        { baseUrl: 'b', languageCode: 'en', kind: 'asr', name: null },
      ])?.baseUrl,
    ).toBe('b');
    expect(
      pickCaptionTrack([
        { baseUrl: 'a', languageCode: 'de', kind: null, name: null },
      ])?.baseUrl,
    ).toBe('a');
    expect(pickCaptionTrack([])).toBeNull();
  });
});

describe('timed text parsing', () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<transcript>
  <text start="0" dur="2.5">Hello &amp; welcome</text>
  <text start="2.5" dur="3">to the <b>lecture</b></text>
  <text start="65.2" dur="1.1">on retrieval</text>
  <text start="70" dur="1"></text>
</transcript>`;

  it('parses cues, decodes entities and drops empty ones', () => {
    const cues = parseTimedTextXml(xml);
    expect(cues).toHaveLength(3);
    expect(cues[0]).toEqual({
      start: 0,
      duration: 2.5,
      text: 'Hello & welcome',
    });
    expect(cues[1]?.text).toBe('to the lecture');
    expect(cues[2]?.start).toBeCloseTo(65.2);
  });

  it('formats timestamps with and without hours', () => {
    expect(formatTimestamp(0)).toBe('00:00');
    expect(formatTimestamp(65)).toBe('01:05');
    expect(formatTimestamp(3661)).toBe('1:01:01');
  });

  it('groups cues into transcript pages with [mm:ss] markers', () => {
    const cues = parseTimedTextXml(xml);
    const pages = buildTranscriptPages(cues, { maxChars: 60 });
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]?.page).toBe(1);
    expect(pages[0]?.text).toContain('## Transcript 1');
    expect(pages[0]?.text).toContain('[00:00] Hello & welcome');
    // Every page is numbered and self-describing.
    pages.forEach((page, index) => {
      expect(page.page).toBe(index + 1);
      expect(page.text.startsWith('## Transcript')).toBe(true);
    });
  });
});
