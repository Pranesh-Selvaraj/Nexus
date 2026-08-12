import path from 'node:path';

import multer from 'multer';

import { UPLOAD_DIR } from './paths';

export const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB ?? 25);

export const ALLOWED_EXTENSIONS = new Set([
  'pdf',
  'txt',
  'md',
  'markdown',
  'csv',
  'json',
]);

/**
 * Files are buffered in memory and written to disk by the route handler at a
 * path built exclusively from server-controlled components (validated UUID
 * workspace id + a fresh randomUUID). Deliberately NOT diskStorage: multer's
 * staged path/filename are modeled as user-controlled by static analysis
 * (CodeQL js/path-injection), and staging decoupled from validation buys
 * nothing once the handler owns the write.
 *
 * Memory usage is bounded by MAX_UPLOAD_MB (default 25 MB) + the multipart
 * overhead - acceptable for a single-user self-hosted app.
 */
const storage = multer.memoryStorage();

/**
 * Rejects files whose extension is not in ALLOWED_EXTENSIONS. The error
 * message is deliberately static: the real extension must not end up in log
 * output or error responses derived from it (log-injection hardening).
 */
export function fileFilter(
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
): void {
  const ext = path.extname(file.originalname).slice(1).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    cb(new Error('Unsupported file type'));
    return;
  }
  cb(null, true);
}

/**
 * Strips control characters and caps length before anything user-influenced
 * reaches the log stream (CodeQL js/log-injection).
 */
export function sanitizeForLog(value: unknown): string {
  /* eslint-disable no-control-regex -- control-char class IS the sanitizer */
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, 2000);
  /* eslint-enable no-control-regex */
}

export const upload = multer({
  storage,
  limits: {
    fileSize: MAX_UPLOAD_MB * 1024 * 1024,
    files: 1,
  },
  fileFilter,
});

// Re-exported for callers that need the resolved uploads directory.
export { UPLOAD_DIR };
