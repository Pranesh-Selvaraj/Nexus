import path from 'node:path';

import multer from 'multer';

import { sanitizeForLog } from './sanitize.js';
import { UPLOAD_DIR } from './paths.js';

// Re-exported so existing callers keep importing from this module.
export { sanitizeForLog };

export const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB ?? 25);

/** Hard cap for workspace archive imports (multipart JSON file). */
export const MAX_IMPORT_MB = Number(process.env.MAX_IMPORT_MB ?? 100);

/** Hard cap for spoken-audio uploads (dictation, pronunciation). */
export const MAX_AUDIO_MB = Number(process.env.MAX_AUDIO_MB ?? 25);

/** Container formats browsers actually record and providers accept. */
export const ALLOWED_AUDIO_EXTENSIONS = new Set([
  'webm',
  'ogg',
  'oga',
  'mp3',
  'mp4',
  'm4a',
  'wav',
  'flac',
  'aac',
]);

// Kept for compatibility with callers that still read the env value; the
// effective limit now comes from the `server.maxUploadMb` setting.
export const ALLOWED_EXTENSIONS = new Set([
  'pdf',
  'docx',
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
 * Multer hard cap. The effective per-request limit is enforced from the
 * `server.maxUploadMb` setting in index.ts; this is only a backstop so a
 * malicious oversized body cannot exhaust memory before validation runs.
 */
const MAX_UPLOAD_HARD_CAP_MB = 100;

export const upload = multer({
  storage,
  limits: {
    fileSize: MAX_UPLOAD_HARD_CAP_MB * 1024 * 1024,
    files: 1,
  },
  fileFilter,
});

/**
 * Workspace archive imports: a single JSON file, streamed as multipart so
 * the archive never hits the (small) tRPC JSON body limit. The service also
 * validates the decoded payload against row/size limits.
 */
export const archiveUpload = multer({
  storage,
  limits: {
    fileSize: MAX_IMPORT_MB * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).slice(1).toLowerCase();
    if (ext !== 'json') {
      cb(new Error('Workspace archive must be a .json file'));
      return;
    }
    cb(null, true);
  },
});

// Re-exported for callers that need the resolved uploads directory.
export { UPLOAD_DIR };

/**
 * Spoken-audio uploads (dictation and pronunciation recordings). Same
 * memoryStorage + server-controlled-path model as document uploads: the route
 * handler never builds a path from the uploaded name (S-2). The extension and
 * declared MIME type are both checked; the error message stays static so a
 * crafted extension never reaches logs or the response.
 */
export const audioUpload = multer({
  storage,
  limits: {
    fileSize: MAX_AUDIO_MB * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).slice(1).toLowerCase();
    const mimeOk =
      file.mimetype === '' ||
      file.mimetype.startsWith('audio/') ||
      file.mimetype === 'video/webm' ||
      file.mimetype === 'video/mp4' ||
      file.mimetype === 'application/octet-stream';
    // Both the extension and the declared MIME type must be plausible; an
    // allowlisted extension with, say, `text/html` must not be echoed back as
    // the stored content type (the route re-derives a safe type anyway).
    if (!ALLOWED_AUDIO_EXTENSIONS.has(ext) || !mimeOk) {
      cb(new Error('Unsupported audio type'));
      return;
    }
    cb(null, true);
  },
});
