import { describe, expect, it } from 'vitest';

import {
  audioCacheKey,
  guessExtension,
  parseRange,
  retentionExpiry,
  safeAudioMimeType,
  selectQuotaEvictions,
} from './audio.service.js';

describe('audioCacheKey', () => {
  const base = {
    owner: 'user-1',
    model: 'tts-1',
    voice: 'alloy',
    speed: 1,
    format: 'mp3',
    text: 'Hello world',
  };

  it('is deterministic for identical input', () => {
    expect(audioCacheKey(base)).toBe(audioCacheKey({ ...base }));
  });

  it('changes when owner, voice, speed, model, format or text changes', () => {
    const key = audioCacheKey(base);
    expect(audioCacheKey({ ...base, owner: 'user-2' })).not.toBe(key);
    expect(audioCacheKey({ ...base, voice: 'nova' })).not.toBe(key);
    expect(audioCacheKey({ ...base, speed: 1.25 })).not.toBe(key);
    expect(audioCacheKey({ ...base, model: 'tts-1-hd' })).not.toBe(key);
    expect(audioCacheKey({ ...base, format: 'wav' })).not.toBe(key);
    expect(audioCacheKey({ ...base, text: 'Hello world!' })).not.toBe(key);
  });

  it('does not collide when fields concatenated would be ambiguous', () => {
    // "ab"+"c" vs "a"+"bc" must differ thanks to the separator.
    const a = audioCacheKey({ ...base, voice: 'ab', text: 'c' });
    const b = audioCacheKey({ ...base, voice: 'a', text: 'bc' });
    expect(a).not.toBe(b);
  });
});

describe('retentionExpiry', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');

  it('returns null when retention is disabled', () => {
    expect(retentionExpiry(0, now)).toBeNull();
    expect(retentionExpiry(-1, now)).toBeNull();
  });

  it('adds the configured number of days', () => {
    expect(retentionExpiry(7, now)?.toISOString()).toBe(
      '2026-01-08T00:00:00.000Z',
    );
  });
});

describe('selectQuotaEvictions', () => {
  const rows = [
    { id: 'old', sizeBytes: 60, createdAt: new Date('2026-01-01') },
    { id: 'mid', sizeBytes: 60, createdAt: new Date('2026-01-02') },
    { id: 'new', sizeBytes: 60, createdAt: new Date('2026-01-03') },
  ];

  it('keeps everything under the cap', () => {
    expect(selectQuotaEvictions(rows, 1000)).toEqual([]);
  });

  it('evicts oldest first until the cap is met', () => {
    expect(selectQuotaEvictions(rows, 120)).toEqual(['old']);
  });

  it('never evicts the most recent asset', () => {
    expect(selectQuotaEvictions(rows, 0)).toEqual(['old', 'mid']);
  });
});

describe('parseRange', () => {
  it('returns null without a range header', () => {
    expect(parseRange(undefined, 100)).toBeNull();
  });

  it('parses a normal range', () => {
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
  });

  it('parses an open-ended range', () => {
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
  });

  it('parses a suffix range', () => {
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
  });

  it('clamps an end beyond the file size', () => {
    expect(parseRange('bytes=0-1000', 100)).toEqual({ start: 0, end: 99 });
  });

  it('rejects unsatisfiable or malformed ranges', () => {
    expect(parseRange('bytes=100-', 100)).toBeNull();
    expect(parseRange('bytes=20-10', 100)).toBeNull();
    expect(parseRange('items=0-5', 100)).toBeNull();
    expect(parseRange('bytes=abc', 100)).toBeNull();
  });
});

describe('guessExtension', () => {
  it('maps common audio MIME types', () => {
    expect(guessExtension('audio/mpeg')).toBe('mp3');
    expect(guessExtension('audio/wav')).toBe('wav');
    expect(guessExtension('audio/webm;codecs=opus')).toBe('webm');
    expect(guessExtension('application/octet-stream')).toBe('bin');
  });
});

describe('safeAudioMimeType', () => {
  it('derives the content type from the extension, not the client MIME', () => {
    expect(safeAudioMimeType('clip.webm')).toBe('audio/webm');
    expect(safeAudioMimeType('clip.MP3')).toBe('audio/mpeg');
    expect(safeAudioMimeType('clip.m4a')).toBe('audio/mp4');
  });

  it('falls back to octet-stream for unknown extensions', () => {
    expect(safeAudioMimeType('clip.html')).toBe('application/octet-stream');
    expect(safeAudioMimeType('clip')).toBe('application/octet-stream');
  });
});
