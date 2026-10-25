/**
 * Saved HTML files and extracted web pages.
 */
import { extractArticle } from '../readability.js';
import {
  assertHasText,
  buildMetadata,
  type ParseContext,
  type ParsedDocument,
} from './types.js';

export async function parseHtml(ctx: ParseContext): Promise<ParsedDocument> {
  const article = extractArticle(ctx.buffer.toString('utf8'));
  const pages = [{ page: 1, text: article.text }];
  assertHasText(pages, ctx.fileName);
  return {
    pages,
    title: article.title || ctx.fileName,
    metadata: buildMetadata(pages, {
      format: 'html',
      kind: 'web',
      title: article.title,
      author: article.byline,
    }),
  };
}
