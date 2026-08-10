import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import multer from 'multer';

export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR ?? './uploads');
export const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB ?? 25);

const ALLOWED_EXTENSIONS = new Set([
  'pdf',
  'txt',
  'md',
  'markdown',
  'csv',
  'json',
]);

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const workspaceId = String(req.body?.workspaceId ?? '');
    const dir = path.join(UPLOAD_DIR, workspaceId);
    mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomUUID()}${ext}`);
  },
});

export const upload = multer({
  storage,
  limits: {
    fileSize: MAX_UPLOAD_MB * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).slice(1).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      cb(new Error(`Unsupported file type: .${ext}`));
      return;
    }
    cb(null, true);
  },
});