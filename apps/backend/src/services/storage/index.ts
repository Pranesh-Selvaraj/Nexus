import { UPLOAD_DIR } from '../../utils/paths.js';
import type { StorageDriver } from './driver.js';
import { LocalStorage } from './local.js';
import { S3Storage } from './s3.js';

export type { StorageDriver } from './driver.js';

/**
 * The configured document storage backend. `STORAGE_DRIVER=s3` requires
 * `S3_BUCKET`; everything else falls back to local disk under `UPLOAD_DIR`.
 */
function createStorage(): StorageDriver {
  const driver = (process.env.STORAGE_DRIVER ?? 'local').toLowerCase();
  if (driver === 's3') {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) {
      throw new Error(
        'STORAGE_DRIVER=s3 requires S3_BUCKET (and usually S3_ENDPOINT for MinIO)',
      );
    }
    return new S3Storage({ bucket });
  }
  if (driver !== 'local') {
    throw new Error(
      `Unknown STORAGE_DRIVER "${driver}" (expected "local" or "s3")`,
    );
  }
  return new LocalStorage(UPLOAD_DIR);
}

export const storage: StorageDriver = createStorage();
