import path from 'node:path';

/**
 * Single source of truth for the uploads directory, resolved once from the
 * process environment. All other modules must import from here instead of
 * re-resolving `process.env.UPLOAD_DIR` (which drifted between relative and
 * absolute semantics).
 */
export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR ?? './uploads');
