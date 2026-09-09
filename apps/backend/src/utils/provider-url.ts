/**
 * Endpoint paths that OpenAI-compatible APIs serve *under* a base URL.
 * Nexus (like the OpenAI SDK) appends these itself, so a base URL that
 * already ends in one of them is almost always the full endpoint URL
 * pasted by mistake (e.g. copying `/chat/completions` from a provider
 * dashboard instead of the base URL).
 */
export const PROVIDER_ENDPOINT_PATHS = [
  '/chat/completions',
  '/embeddings',
  '/models',
  '/responses',
  '/messages',
] as const;

/** Trailing slashes are semantically meaningless on a base URL. */
const TRAILING_SLASH_RE = /\/+$/;

/** The known endpoint path a base URL ends with, if any. */
export function baseUrlEndpointPath(baseUrl: string): string | null {
  const normalized = baseUrl.trim().replace(TRAILING_SLASH_RE, '');
  for (const path of PROVIDER_ENDPOINT_PATHS) {
    if (normalized.endsWith(path)) return path;
  }
  return null;
}

/** Strip a mistakenly appended endpoint path: full URL -> base URL. */
export function suggestBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(TRAILING_SLASH_RE, '');
  const path = baseUrlEndpointPath(normalized);
  return path ? normalized.slice(0, -path.length) : normalized;
}
