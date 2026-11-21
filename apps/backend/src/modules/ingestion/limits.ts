/**
 * Resource limits for ingestion paths.
 *
 * Every parser that reads an untrusted container (zip/epub/pptx/xlsx/odt), a
 * remote URL, or a binary image gets explicit ceilings. Values are read from
 * the environment once per call so tests can exercise tight limits without
 * mutating process-wide state.
 */

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export interface IngestionLimits {
  /** Maximum entries in a zip-style container. */
  maxZipEntries: number;
  /** Maximum uncompressed bytes across all entries. */
  maxUncompressedBytes: number;
  /** Maximum uncompressed size of a single entry. */
  maxEntryBytes: number;
  /** Maximum uncompressed:compressed ratio (zip-bomb detection). */
  maxCompressionRatio: number;
  /** Maximum nested depth when a container holds other containers. */
  maxNestedDepth: number;
  /** Wall-clock limit for one parser (ms). */
  parserTimeoutMs: number;
  /** Maximum bytes downloaded for article/transcript ingestion. */
  maxUrlBytes: number;
  /** Maximum redirects followed for URL ingestion. */
  maxRedirects: number;
  /** Total time budget for one URL ingestion, including redirects (ms). */
  urlTimeoutMs: number;
  /** Maximum number of PDF pages rasterized for OCR. */
  maxOcrPages: number;
  /** Wall-clock limit for one OCR invocation (ms). */
  ocrTimeoutMs: number;
  /** Maximum characters of extracted text kept per document. */
  maxTextChars: number;
}

const MB = 1024 * 1024;

/** Read the effective limits (env overrides, documented defaults). */
export function ingestionLimits(
  overrides: Partial<IngestionLimits> = {},
): IngestionLimits {
  const base: IngestionLimits = {
    maxZipEntries: envNumber('MAX_ZIP_ENTRIES', 500),
    maxUncompressedBytes: envNumber('MAX_UNCOMPRESSED_MB', 200) * MB,
    maxEntryBytes: envNumber('MAX_ZIP_ENTRY_MB', 50) * MB,
    maxCompressionRatio: envNumber('MAX_ZIP_RATIO', 100),
    maxNestedDepth: envNumber('MAX_ZIP_DEPTH', 1),
    parserTimeoutMs: envNumber('PARSER_TIMEOUT_MS', 60_000),
    maxUrlBytes: envNumber('INGEST_MAX_BYTES', 5) * MB,
    maxRedirects: envNumber('INGEST_MAX_REDIRECTS', 3),
    urlTimeoutMs: envNumber('INGEST_TIMEOUT_MS', 20_000),
    maxOcrPages: envNumber('OCR_MAX_PAGES', 30),
    ocrTimeoutMs: envNumber('OCR_TIMEOUT_MS', 60_000),
    maxTextChars: envNumber('MAX_TEXT_CHARS', 4_000_000),
  };
  return { ...base, ...overrides };
}
