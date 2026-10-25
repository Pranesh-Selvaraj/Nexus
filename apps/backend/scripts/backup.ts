#!/usr/bin/env node
/**
 * Manual database backup:
 *
 *   pnpm --filter @nexus/backend backup
 *
 * Env: DATABASE_URL, BACKUP_DIR (default ./backups),
 *      BACKUP_RETENTION_DAYS (default 7), PG_DUMP_BIN (default pg_dump).
 *
 * Restore with the documented drill in README.md (`pg_restore`).
 */
import '../src/utils/env.js';

import { runBackup } from '../src/services/backup.service.js';

try {
  const result = await runBackup();
  const mb = (result.bytes / 1024 / 1024).toFixed(2);
  console.log(`backup written: ${result.file} (${mb} MB)`);
  if (result.pruned > 0) {
    console.log(`pruned ${result.pruned} backup(s) past retention`);
  }
} catch (err) {
  console.error(
    `backup failed: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
}
