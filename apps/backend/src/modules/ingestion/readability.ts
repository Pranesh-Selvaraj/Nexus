/**
 * Readability-style article extraction.
 *
 * Nexus ingests untrusted HTML (web pages, saved files, EPUB chapters), so it
 * never renders source markup: it scores candidate content blocks, strips
 * chrome, converts structure (headings, lists, tables, code) to Markdown, and
 * keeps only the text. Links become plain text on purpose - a citation should
 * never ship an active `javascript:` URL into the chat UI.
 *
 * This is a deliberately dependency-free implementation of the Readability
 * approach (Mozilla's library needs jsdom, a ~5 MB DOM emulation, for the same
 * output): block scoring, article/main preference, then structural cleanup.
 */

export interface ExtractedArticle {
  title: string;
  text: string;
  byline: string | null;
  siteName: string | null;
  excerpt: string;
  wordCount: number;
  readingMinutes: number;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  middot: '·',
  bull: '•',
  times: '×',
  divide: '÷',
  minus: '−',
  plusmn: '±',
  frac12: '½',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  ccedil: 'ç',
  uuml: 'ü',
  ouml: 'ö',
  auml: 'ä',
  szlig: 'ß',
  ntilde: 'ñ',
  aacute: 'á',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  euro: '€',
  pound: '£',
  yen: '¥',
  rarr: '→',
  larr: '←',
  harr: '↔',
  le: '≤',
  ge: '≥',
  ne: '≠',
  infin: '∞',
  sum: '∑',
  pi: 'π',
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  theta: 'θ',
  lambda: 'λ',
  mu: 'μ',
  sigma: 'σ',
  omega: 'ω',
};

/** Decode HTML entities (named subset + decimal/hex numeric references). */
export function decodeEntities(input: string): string {
  return input.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g,
    (match, entity: string) => {
      if (entity.startsWith('#x') || entity.startsWith('#X')) {
        const code = Number.parseInt(entity.slice(2), 16);
        return safeFromCodePoint(code, match);
      }
      if (entity.startsWith('#')) {
        const code = Number.parseInt(entity.slice(1), 10);
        return safeFromCodePoint(code, match);
      }
      return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
    },
  );
}

function safeFromCodePoint(code: number, fallback: string): string {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return fallback;
  // Never turn an entity into a control character.
  if (code < 32 && code !== 9 && code !== 10 && code !== 13) return fallback;
  // Lone surrogates are not valid scalar values and poison the text column.
  if (code >= 0xd800 && code <= 0xdfff) return fallback;
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
}

const NON_CONTENT_ELEMENTS = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'nav',
  'footer',
  'aside',
  'header',
  'dialog',
];

/** Remove elements that can never contain article text. */
export function stripNonContent(html: string): string {
  let out = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ' ')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ');
  for (const tag of NON_CONTENT_ELEMENTS) {
    out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, 'gi'), ' ');
    // Void/self-closing and unclosed variants.
    out = out.replace(new RegExp(`<${tag}\\b[^>]*/?>`, 'gi'), ' ');
  }
  return out;
}

function firstMatch(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    const value = match?.[1]?.trim();
    if (value)
      return decodeEntities(stripTags(value)).replace(/\s+/g, ' ').trim();
  }
  return null;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ');
}

/** Plain text length of a fragment (used for block scoring). */
export function textLength(html: string): number {
  return decodeEntities(stripTags(html)).replace(/\s+/g, ' ').trim().length;
}

interface Candidate {
  html: string;
  score: number;
}

/** Paragraph text length inside a block, the strongest Readability signal. */
function blockScore(html: string): number {
  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)];
  const paragraphChars = paragraphs.reduce(
    (sum, match) => sum + textLength(match[1] ?? ''),
    0,
  );
  const commas = (html.match(/,/g) ?? []).length;
  const listItems = (html.match(/<li\b/gi) ?? []).length;
  return paragraphChars + commas * 12 + listItems * 8;
}

/**
 * Choose the content root: an explicit <article>, then <main>, then the
 * highest-scoring block among <section>/<div>/<body>. Falls back to the whole
 * document when nothing scores.
 */
export function selectContentRoot(html: string): string {
  const cleaned = stripNonContent(html);
  const articles = [
    ...cleaned.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi),
  ]
    .map((match) => match[1] ?? '')
    .sort((a, b) => blockScore(b) - blockScore(a));
  if (articles[0] && blockScore(articles[0]) > 0) return articles[0];

  const mains = [...cleaned.matchAll(/<main\b[^>]*>([\s\S]*?)<\/main>/gi)]
    .map((match) => match[1] ?? '')
    .sort((a, b) => blockScore(b) - blockScore(a));
  if (mains[0] && blockScore(mains[0]) > 0) return mains[0];

  const candidates: Candidate[] = [];
  for (const match of cleaned.matchAll(
    /<(section|div)\b[^>]*>([\s\S]*?)<\/\1>/gi,
  )) {
    const inner = match[2] ?? '';
    candidates.push({ html: inner, score: blockScore(inner) });
  }
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(cleaned)?.[1] ?? cleaned;
  candidates.push({ html: body, score: blockScore(body) });

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best || best.score === 0) return cleaned;
  return best.html;
}

/** Convert the content root to Markdown-ish plain text. */
export function toMarkdown(html: string): string {
  let out = stripNonContent(html);

  // Preserve code blocks verbatim before the generic tag strip.
  out = out.replace(
    /<pre\b[^>]*>([\s\S]*?)<\/pre>/gi,
    (_match, inner: string) => {
      const code = decodeEntities(stripTags(inner))
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      return code ? `\n\n\`\`\`\n${code}\n\`\`\`\n\n` : '\n\n';
    },
  );

  out = out
    .replace(/<br\b[^>]*\/?>/gi, '\n')
    .replace(/<hr\b[^>]*\/?>/gi, '\n\n')
    .replace(
      /<h([1-6])\b[^>]*>/gi,
      (_m, level: string) => `\n\n${'#'.repeat(Number(level))} `,
    )
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<blockquote\b[^>]*>/gi, '\n\n> ')
    .replace(/<\/blockquote>/gi, '\n\n')
    .replace(/<t[dh]\b[^>]*>/gi, ' | ')
    .replace(/<tr\b[^>]*>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<table\b[^>]*>/gi, '\n\n')
    .replace(/<\/table>/gi, '\n\n')
    .replace(
      /<\/?(p|div|section|article|main|ul|ol|dl|dd|dt|figure|figcaption|span|a|strong|em|b|i|u|mark|small|li)\b[^>]*>/gi,
      (_m, tag: string) => {
        // Inline tags must not introduce whitespace between words.
        if (
          [
            'span',
            'a',
            'strong',
            'em',
            'b',
            'i',
            'u',
            'mark',
            'small',
          ].includes(tag)
        ) {
          return '';
        }
        return '\n';
      },
    )
    .replace(/<[^>]*>/g, '');

  out = decodeEntities(out)
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return out;
}

/** Word count that does not choke on CJK text (no spaces between words). */
export function countWords(text: string): number {
  const cjk = (
    text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/g) ?? []
  ).length;
  const latin = text
    .replace(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/g, ' ')
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
  return cjk + latin;
}

export function readingMinutes(wordCount: number): number {
  return Math.max(1, Math.round(wordCount / 200));
}

/**
 * Extract the readable article from an HTML document.
 *
 * @param html    Raw HTML (already size-capped by the caller).
 * @param baseUrl Optional canonical URL, returned untouched for citations.
 */
export function extractArticle(html: string): ExtractedArticle {
  const title =
    firstMatch(html, [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
      /<title[^>]*>([\s\S]*?)<\/title>/i,
      /<h1[^>]*>([\s\S]*?)<\/h1>/i,
    ]) ?? '';
  const byline = firstMatch(html, [
    /<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']author["']/i,
    /<meta[^>]+property=["']article:author["'][^>]+content=["']([^"']+)["']/i,
  ]);
  const siteName = firstMatch(html, [
    /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i,
  ]);
  const description = firstMatch(html, [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
  ]);

  let body = toMarkdown(selectContentRoot(html));
  // Keep the page title as a top heading so chunking inherits it and the
  // reader shows where the text came from.
  if (title && !body.startsWith('# ')) {
    body = `# ${title}\n\n${body}`;
  }
  body = body.replace(/[ \t]+\n/g, '\n').trim();

  const words = countWords(body);
  const excerpt = (description ?? body.replace(/[#>*`|_-]/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);

  return {
    title: title || 'Untitled page',
    text: body,
    byline,
    siteName,
    excerpt,
    wordCount: words,
    readingMinutes: readingMinutes(words),
  };
}

/** Extract the title of an HTML document (used by the EPUB/HTML parsers). */
export function extractHtmlTitle(html: string): string | null {
  return firstMatch(html, [
    /<title[^>]*>([\s\S]*?)<\/title>/i,
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
  ]);
}
