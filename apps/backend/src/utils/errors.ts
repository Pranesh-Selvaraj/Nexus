const MAX_MESSAGE_LENGTH = 300;

/**
 * Provider error messages can embed whole HTML error pages (e.g. a 404
 * page when the base URL points at the wrong path). Strip markup and cap
 * the length so settings-panel and chat error messages stay readable.
 *
 * Network-level failures (DNS, TCP reset, timeout) surface as a generic
 * "Connection error." from the OpenAI SDK - append the underlying error
 * code (ECONNRESET, ENOTFOUND, ETIMEDOUT, ...) so they are diagnosable.
 */
export function friendlyErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const hadMarkup = /<\s*(!doctype|html|body|div)\b/i.test(raw);

  const cause = (err as { cause?: { code?: string } } | undefined)?.cause;
  const causeCode = cause?.code
    ? typeof cause.code === 'string'
      ? cause.code
      : String(cause.code)
    : null;

  let message = raw
    // Consume script/style bodies through their end tag (any whitespace
    // before '>', per HTML), or to the end of the string if unterminated.
    .replace(/<script[\s\S]*?(?:<\/script[^>]*>|$)/gi, ' ')
    .replace(/<style[\s\S]*?(?:<\/style[^>]*>|$)/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (message.length === 0) {
    message = hadMarkup
      ? 'the provider returned an HTML page instead of an API response (check the base URL)'
      : 'Unknown error';
  }
  // Turn the SDK's bare "Connection error." into "Connection error (ECONNRESET)."
  if (causeCode && !message.includes(causeCode)) {
    message = `${message} (${causeCode})`;
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    message = `${message.slice(0, MAX_MESSAGE_LENGTH)}…`;
  }
  return message;
}
