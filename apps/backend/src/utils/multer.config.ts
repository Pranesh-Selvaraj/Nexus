import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import multer from 'multer';

import { UPLOAD_TMP_DIR } from './paths';

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
 * Files are staged in a flat `.tmp` directory with a server-generated name.
 * The route handler validates the workspace id and then relocates the file
 * into `<uploads>/<workspaceId>/`. Staging decouples multer's field-parsing
 * order from the destination directory (the frontend sends the file part
 * before the workspaceId part) and keeps unvalidated input away from any
 * path construction.
 */
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
    cb(null, UPLOAD_TMP_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomUUID()}${ext}`);
  },
});

export function fileFilter(
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
): void {
  const ext = path.extname(file.originalname).slice(1).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    cb(new Error(`Unsupported file type: .${ext}`));
    return;
  }
  cb(null, true);
}

export const upload = multer({
  storage,
  limits: {
    fileSize: MAX_UPLOAD_MB * 1024 * 1024,
    files: 1,
  },
  fileFilter,
});
