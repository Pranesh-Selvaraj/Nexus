import { getSetting } from './settings.service.js';

/**
 * PostgreSQL text-search configurations the app accepts. Used both for the
 * `retrieval.language` setting and for populating `chunks.content_fts`, so
 * the indexed vectors and the queries always use the same config.
 */
export const FTS_LANGUAGES = new Set([
  'simple',
  'english',
  'danish',
  'dutch',
  'finnish',
  'french',
  'german',
  'hungarian',
  'italian',
  'norwegian',
  'portuguese',
  'romanian',
  'russian',
  'spanish',
  'swedish',
  'turkish',
  'arabic',
  'greek',
  'hindi',
  'indonesian',
  'irish',
  'japanese',
  'korean',
  'nepali',
  'tamil',
  'thai',
  'catalan',
  'lithuanian',
  'serbian',
]);

/**
 * Effective search language. The setting (or env override) is validated
 * against the whitelist so it is safe to interpolate as a regconfig literal.
 */
export async function safeFtsLanguage(): Promise<string> {
  const language = await getSetting('retrieval.language');
  return FTS_LANGUAGES.has(language) ? language : 'english';
}
