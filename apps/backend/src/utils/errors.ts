const MAX_MESSAGE_LENGTH = 300;

/**
 * Provider error messages can embed whole HTML error pages (e.g. a 404
 * page when the base URL points at the wrong path). Strip markup and cap
 * the length so settings-panel and chat error messages stay readable.
 */
export function friendlyErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const hadMarkup = /<\s*(!doctype|html|body|div)\b/i.test(raw);
  let message = raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (message.length === 0) {
    message = hadMarkup
      ? 'the provider returned an HTML page instead of an API response (check the base URL)'
      : 'Unknown error';
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    message = `${message.slice(0, MAX_MESSAGE_LENGTH)}…`;
  }
  return message;
}
