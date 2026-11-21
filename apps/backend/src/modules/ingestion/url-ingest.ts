/**
 * URL ingestion: YouTube transcripts and Readability-extracted articles,
 * normalized into a Markdown file that the normal indexing pipeline consumes.
 *
 * The fetched content is stored like any other upload (a Markdown document),
 * with `sourceUrl` and fetch metadata recorded for provenance and citations.
 * Nothing is re-fetched at indexing time, so the document is stable and the
 * network request happened once, behind the SSRF guard.
 */
import type { DocumentStructure } from '@nexus/shared-types';

import { readingMinutes } from './readability.js';
import { fetchArticle, type FetchOptions } from './url-fetch.js';
import { fetchYouTubeTranscript, isYouTubeUrl } from './youtube.js';

export interface UrlIngestResult {
  kind: 'article' | 'video';
  title: string;
  /** Markdown document body written to storage. */
  markdown: string;
  sourceUrl: string;
  wordCount: number;
  metadata: DocumentStructure;
  /** Suggested file name (without path separators). */
  fileName: string;
}

/** File-name-safe slug (never used as a path, only for the document title). */
export function slugifyTitle(title: string, fallback = 'ingested'): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || fallback;
}

export async function ingestUrlContent(
  rawUrl: string,
  options: FetchOptions = {},
): Promise<UrlIngestResult> {
  if (isYouTubeUrl(rawUrl)) {
    const transcript = await fetchYouTubeTranscript(rawUrl, options);
    const markdown = transcript.pages
      .map((page) => page.text)
      .join('\n\n')
      .trim();
    return {
      kind: 'video',
      title: transcript.title,
      markdown: `# ${transcript.title}\n\n${markdown}`,
      sourceUrl: transcript.sourceUrl,
      wordCount: transcript.wordCount,
      metadata: {
        format: 'youtube',
        kind: 'video',
        title: transcript.title,
        sourceUrl: transcript.sourceUrl,
        fetchedAt: new Date().toISOString(),
        transcript: true,
        durationSeconds: transcript.durationSeconds,
        pageCount: transcript.pages.length,
        wordCount: transcript.wordCount,
        readingMinutes: readingMinutes(transcript.wordCount),
        chapters: transcript.pages.map((page) => ({
          title: `Transcript ${page.page}`,
          page: page.page,
        })),
      },
      fileName: `${slugifyTitle(transcript.title, `youtube-${transcript.videoId}`)}.md`,
    };
  }

  const { article, finalUrl, fetchedAt } = await fetchArticle(rawUrl, options);
  return {
    kind: 'article',
    title: article.title,
    markdown: article.text,
    sourceUrl: finalUrl,
    wordCount: article.wordCount,
    metadata: {
      format: 'html',
      kind: 'web',
      title: article.title,
      author: article.byline,
      sourceUrl: finalUrl,
      fetchedAt,
      pageCount: 1,
      wordCount: article.wordCount,
      readingMinutes: article.readingMinutes,
    },
    fileName: `${slugifyTitle(article.title, 'article')}.md`,
  };
}
