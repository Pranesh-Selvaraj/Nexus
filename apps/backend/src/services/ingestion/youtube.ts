/**
 * YouTube transcript ingestion.
 *
 * No API key and no extra dependency: the watch page exposes the caption
 * track list, and each track has a timed-text URL that returns XML cues. The
 * fetch goes through the same SSRF-safe transport as article ingestion, with
 * a size cap and timeout, so a hostile redirect cannot reach the metadata
 * service. Videos without captions fail with an actionable message instead of
 * silently indexing an empty page.
 */
import type { SourcePage } from '../chunking.service.js';
import { decodeEntities } from './readability.js';
import {
  fetchTextResource,
  UnsafeUrlError,
  type FetchOptions,
} from './url-fetch.js';

export interface TranscriptCue {
  start: number;
  duration: number;
  text: string;
}

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind: string | null;
  name: string | null;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Extract the 11-character video id from any common YouTube URL shape. */
export function parseYouTubeVideoId(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, '').toLowerCase();
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0] ?? '';
    return VIDEO_ID.test(id) ? id : null;
  }
  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null;

  const v = url.searchParams.get('v');
  if (v && VIDEO_ID.test(v)) return v;

  const parts = url.pathname.split('/').filter(Boolean);
  const [prefix, id] = parts;
  if (
    (prefix === 'shorts' ||
      prefix === 'embed' ||
      prefix === 'live' ||
      prefix === 'v') &&
    id &&
    VIDEO_ID.test(id)
  ) {
    return id;
  }
  return null;
}

export function isYouTubeUrl(raw: string): boolean {
  return parseYouTubeVideoId(raw) !== null;
}

/**
 * Extract one JSON array that follows a marker, bracket-matched while
 * respecting strings/escapes. A non-greedy regex stops at the first `]`
 * inside a nested array (`name.runs`), which silently truncated the track
 * list.
 */
export function extractJsonArrayAfter(
  text: string,
  marker: string,
): string | null {
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) return null;
  const open = text.indexOf('[', markerIndex + marker.length);
  if (open === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '[') depth += 1;
    else if (char === ']') {
      depth -= 1;
      if (depth === 0) return text.slice(open, index + 1);
    }
  }
  return null;
}

/** Parse the captionTracks array out of a watch page. */
export function parseCaptionTracks(html: string): CaptionTrack[] {
  const array = extractJsonArrayAfter(html, '"captionTracks"');
  if (!array) return [];
  try {
    const parsed = JSON.parse(array) as Array<{
      baseUrl?: string;
      languageCode?: string;
      kind?: string;
      name?: { simpleText?: string; runs?: Array<{ text?: string }> };
    }>;
    return parsed
      .filter((track) => typeof track.baseUrl === 'string' && track.baseUrl)
      .map((track) => ({
        baseUrl: track.baseUrl as string,
        languageCode: track.languageCode ?? '',
        kind: track.kind ?? null,
        name:
          track.name?.simpleText ??
          track.name?.runs?.map((run) => run.text ?? '').join('') ??
          null,
      }));
  } catch {
    return [];
  }
}

/**
 * Prefer the human-authored English track, then any English track, then any
 * captions at all. Deterministic ordering keeps re-ingestion stable.
 */
export function pickCaptionTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  if (tracks.length === 0) return null;
  const english = tracks.filter((track) => track.languageCode.startsWith('en'));
  const manualEnglish = english.find((track) => track.kind !== 'asr');
  return manualEnglish ?? english[0] ?? tracks[0] ?? null;
}

/** Parse a timedtext XML response into cues. */
export function parseTimedTextXml(xml: string): TranscriptCue[] {
  const cues: TranscriptCue[] = [];
  const re = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
  for (const match of xml.matchAll(re)) {
    const attrs = match[1] ?? '';
    const start = Number(/\bstart="([\d.]+)"/.exec(attrs)?.[1] ?? 0);
    const duration = Number(/\bdur="([\d.]+)"/.exec(attrs)?.[1] ?? 0);
    const text = decodeEntities(match[2] ?? '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) {
      cues.push({
        start: Number.isFinite(start) ? start : 0,
        duration: Number.isFinite(duration) ? duration : 0,
        text,
      });
    }
  }
  return cues;
}

/** `mm:ss` / `h:mm:ss` timestamp for transcript lines. */
export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Group cues into page-sized transcript blocks. Page numbers are sequential
 * transcript sections so citations point at "the part of the video" rather
 * than a meaningless page 1.
 */
export function buildTranscriptPages(
  cues: TranscriptCue[],
  options: { maxChars?: number; heading?: string } = {},
): SourcePage[] {
  const maxChars = options.maxChars ?? 2000;
  const heading = options.heading ?? 'Transcript';
  const pages: SourcePage[] = [];
  let buffer: string[] = [];
  let length = 0;

  const flush = (): void => {
    if (buffer.length === 0) return;
    const index = pages.length + 1;
    pages.push({
      page: index,
      text: `## ${heading} ${index}\n\n${buffer.join('\n')}`,
    });
    buffer = [];
    length = 0;
  };

  for (const cue of cues) {
    const line = `[${formatTimestamp(cue.start)}] ${cue.text}`;
    if (length + line.length + 1 > maxChars) flush();
    buffer.push(line);
    length += line.length + 1;
  }
  flush();
  return pages;
}

export interface YouTubeTranscript {
  videoId: string;
  title: string;
  language: string | null;
  pages: SourcePage[];
  wordCount: number;
  durationSeconds: number;
  sourceUrl: string;
}

/** Fetch and parse the transcript of a YouTube video. */
export async function fetchYouTubeTranscript(
  rawUrl: string,
  options: FetchOptions = {},
): Promise<YouTubeTranscript> {
  const videoId = parseYouTubeVideoId(rawUrl);
  if (!videoId) {
    throw new UnsafeUrlError('Not a YouTube video URL');
  }
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}&hl=en`;
  const page = await fetchTextResource(watchUrl, options);
  const titleMatch =
    /<meta[^>]+name="title"[^>]+content="([^"]*)"/i.exec(page.body) ??
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(page.body);
  const title = decodeEntities(titleMatch?.[1] ?? '')
    .replace(/\s*-\s*YouTube\s*$/, '')
    .trim();

  const tracks = parseCaptionTracks(page.body);
  const track = pickCaptionTrack(tracks);
  if (!track) {
    throw new UnsafeUrlError(
      'This video has no captions/transcript available, so there is no text to ingest. Try a different video or upload the audio file instead.',
    );
  }

  const transcript = await fetchTextResource(track.baseUrl, options);
  const cues = parseTimedTextXml(transcript.body);
  if (cues.length === 0) {
    throw new UnsafeUrlError(
      'The caption track for this video was empty - nothing to ingest.',
    );
  }

  const pages = buildTranscriptPages(cues);
  const wordCount = pages.reduce(
    (sum, p) => sum + p.text.split(/\s+/).filter(Boolean).length,
    0,
  );
  const last = cues[cues.length - 1];
  const durationSeconds = last ? Math.round(last.start + last.duration) : 0;

  return {
    videoId,
    title: title || `YouTube video ${videoId}`,
    language: track.languageCode || null,
    pages,
    wordCount,
    durationSeconds,
    sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}
