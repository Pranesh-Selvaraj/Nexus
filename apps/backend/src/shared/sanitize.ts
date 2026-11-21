/**
 * Strips control characters and caps length before anything user-influenced
 * reaches the log stream (CodeQL js/log-injection) or an error field returned
 * to the client.
 */
export function sanitizeForLog(value: unknown): string {
  /* eslint-disable no-control-regex -- control-char class IS the sanitizer */
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, 2000);
  /* eslint-enable no-control-regex */
}
