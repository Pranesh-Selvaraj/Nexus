import path from 'node:path';

/**
 * Where document bytes live (P-6). Local disk is the default; S3-compatible
 * object storage (MinIO, AWS, R2, ...) is selected with `STORAGE_DRIVER=s3`.
 *
 * Keys are the relative paths already stored in `documents.file_path`
 * (`<workspaceId>/<uuid>`). Parsers still need a local file, so the interface
 * exposes `materialize`: the local driver returns the path, the S3 driver
 * downloads the object into a cache directory on first use.
 */
export interface StorageDriver {
  /** Human-readable backend description for logs and /healthz. */
  readonly description: string;
  put(key: string, data: Buffer | string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** A local absolute path parsers/streamers can open. */
  materialize(key: string): Promise<string>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
}

/**
 * Reject keys that could escape the storage root: absolute paths, `..`
 * segments, backslashes and empty segments are never valid document keys.
 */
export function assertSafeKey(key: string): void {
  if (!key || key.length > 512) {
    throw new Error('Invalid storage key');
  }
  if (key.startsWith('/') || key.includes('\\') || key.includes('\0')) {
    throw new Error('Invalid storage key');
  }
  for (const segment of key.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new Error('Invalid storage key');
    }
  }
}

export function resolveKeyPath(root: string, key: string): string {
  assertSafeKey(key);
  const resolved = path.resolve(root, key);
  const base = path.resolve(root);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error('Invalid storage key');
  }
  return resolved;
}
