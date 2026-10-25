/**
 * EPUB parser: spine-ordered chapters with their table of contents.
 *
 * An EPUB is a zip containing an OPF package (manifest + spine) and XHTML
 * chapters. Only the spine is turned into pages: navigation documents and
 * covers are skipped, and each spine item becomes one page titled with its
 * chapter (from the EPUB nav/NCX when present, else the chapter's own <h1>).
 * The zip limits module rejects bombs before any chapter is read.
 */
import {
  extractHtmlTitle,
  toMarkdown,
  selectContentRoot,
} from '../readability.js';
import { openArchive, readEntryText, type OpenedArchive } from '../zip.js';
import { ingestionLimits } from '../limits.js';
import {
  assertHasText,
  buildMetadata,
  type ParseContext,
  type ParsedDocument,
} from './types.js';

interface OpfItem {
  id: string;
  href: string;
  mediaType: string;
}

function stripFragment(href: string): string {
  const index = href.indexOf('#');
  return index === -1 ? href : href.slice(0, index);
}

function resolveHref(baseDir: string, href: string): string {
  const decoded = decodeURIComponent(stripFragment(href));
  if (!baseDir) return decoded;
  const parts = `${baseDir}/${decoded}`.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) {
    result[match[1] as string] = match[2] as string;
  }
  return result;
}

export interface EpubPackage {
  opfPath: string;
  baseDir: string;
  title: string | null;
  author: string | null;
  spine: OpfItem[];
  /** TOC title by spine href. */
  tocTitles: Map<string, string>;
}

function parsePackage(opfPath: string, opf: string): EpubPackage {
  const baseDir = opfPath.includes('/')
    ? opfPath.slice(0, opfPath.lastIndexOf('/'))
    : '';
  const manifest = new Map<string, OpfItem>();
  for (const match of opf.matchAll(/<item\b[^>]*\/?>/g)) {
    const attrs = attributes(match[0]);
    if (!attrs.id || !attrs.href) continue;
    manifest.set(attrs.id, {
      id: attrs.id,
      href: attrs.href,
      mediaType: attrs['media-type'] ?? '',
    });
  }

  const spine: OpfItem[] = [];
  for (const match of opf.matchAll(/<itemref\b[^>]*\/?>/g)) {
    const attrs = attributes(match[0]);
    const item = attrs.idref ? manifest.get(attrs.idref) : undefined;
    if (item) spine.push(item);
  }

  const title = /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opf)?.[1]?.trim();
  const author = /<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i
    .exec(opf)?.[1]
    ?.trim();

  return {
    opfPath,
    baseDir,
    title: title ?? null,
    author: author ?? null,
    spine,
    tocTitles: new Map(),
  };
}

/** NCX navigation map: <navPoint><navLabel><text>..</text></navLabel><content src="..."/>. */
function parseNcxTitles(ncx: string): Map<string, string> {
  const titles = new Map<string, string>();
  for (const match of ncx.matchAll(/<navPoint\b[\s\S]*?<\/navPoint>/gi)) {
    const block = match[0];
    const label = /<text[^>]*>([\s\S]*?)<\/text>/i.exec(block)?.[1];
    const src = /<content\b[^>]*src="([^"]+)"/i.exec(block)?.[1];
    if (label && src) titles.set(stripFragment(src), cleanXml(label));
  }
  return titles;
}

/** EPUB3 nav document: <nav epub:type="toc"><ol><li><a href>TITLE</a>. */
function parseNavTitles(nav: string): Map<string, string> {
  const titles = new Map<string, string>();
  for (const match of nav.matchAll(
    /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const href = match[1];
    const label = match[2];
    if (href && label && !href.startsWith('http')) {
      titles.set(stripFragment(href), cleanXml(label));
    }
  }
  return titles;
}

function cleanXml(input: string): string {
  return input
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Read the OPF package (container.xml -> rootfile). */
export async function readEpubPackage(
  archive: OpenedArchive,
  budget: { remaining: number },
): Promise<EpubPackage> {
  const container = await readEntryText(
    archive,
    'META-INF/container.xml',
    budget,
  );
  const opfPath = /<rootfile\b[^>]*full-path="([^"]+)"/i.exec(container)?.[1];
  if (!opfPath) throw new Error('EPUB is missing its package document');
  const opf = await readEntryText(archive, opfPath, budget);
  const pkg = parsePackage(opfPath, opf);

  // Prefer the EPUB3 nav document, fall back to the NCX.
  const navItem = [...opf.matchAll(/<item\b[^>]*\/?>/g)]
    .map((match) => attributes(match[0]))
    .find((attrs) => attrs.properties?.split(/\s+/).includes('nav'));
  const ncxItem = [...opf.matchAll(/<item\b[^>]*\/?>/g)]
    .map((match) => attributes(match[0]))
    .find((attrs) => attrs['media-type'] === 'application/x-dtbncx+xml');

  const navPath = navItem?.href ? resolveHref(pkg.baseDir, navItem.href) : null;
  const ncxPath = ncxItem?.href ? resolveHref(pkg.baseDir, ncxItem.href) : null;
  for (const candidate of [navPath, ncxPath]) {
    if (!candidate || !archive.zip.files[candidate]) continue;
    const xml = await readEntryText(archive, candidate, budget);
    const titles = candidate.endsWith('.ncx')
      ? parseNcxTitles(xml)
      : parseNavTitles(xml);
    for (const [href, title] of titles) {
      pkg.tocTitles.set(href, title);
    }
  }
  return pkg;
}

export async function parseEpub(ctx: ParseContext): Promise<ParsedDocument> {
  const limits = ingestionLimits();
  const archive = await openArchive(ctx.buffer, { limits });
  const budget = { remaining: limits.maxUncompressedBytes };
  const pkg = await readEpubPackage(archive, budget);

  const pages: Array<{ page: number; text: string }> = [];
  const chapters: Array<{ title: string; page: number }> = [];

  for (const item of pkg.spine) {
    if (item.mediaType && !/xhtml|xml|html/.test(item.mediaType)) continue;
    const entryPath = resolveHref(pkg.baseDir, item.href);
    if (!archive.zip.files[entryPath]) continue;
    const html = await readEntryText(archive, entryPath, budget);
    const body = toMarkdown(selectContentRoot(html));
    const tocTitle =
      pkg.tocTitles.get(stripFragment(item.href)) ??
      pkg.tocTitles.get(stripFragment(entryPath)) ??
      extractHtmlTitle(html) ??
      null;
    if (!body.trim()) continue;
    const page = pages.length + 1;
    const heading = tocTitle ?? `Chapter ${page}`;
    pages.push({ page, text: `# ${heading}\n\n${body}` });
    chapters.push({ title: heading, page });
  }

  assertHasText(pages, 'EPUB');
  return {
    pages,
    title: pkg.title ?? ctx.fileName,
    metadata: buildMetadata(pages, {
      format: 'epub',
      kind: 'book',
      title: pkg.title,
      author: pkg.author,
      chapters,
      pageCount: pages.length,
    }),
  };
}
