import path from 'node:path';

/**
 * Single source of truth for the uploads directory, resolved once from the
 * process environment. All other modules must import from here instead of
 * re-resolving `process.env.UPLOAD_DIR` (which drifted between relative and
 * absolute semantics).
 *
 * - `UPLOAD_DIR`      -> <root>/uploads (absolute)
 * - `UPLOAD_TMP_DIR`  -> <root>/uploads/.tmp, staging area for multipart
 *                        writes before validation/relocation
 */
export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR ?? './uploads');
export const UPLOAD_TMP_DIR = path.join(UPLOAD_DIR, '.tmp');
