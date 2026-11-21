import { spawn } from 'node:child_process';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

/**
 * Logical database backups (P-6): a custom-format `pg_dump` written to
 * `BACKUP_DIR`, with simple retention pruning. Used by `pnpm backup` and, when
 * `BACKUP_ENABLED=true`, by the nightly maintenance job.
 *
 * The connection string is decomposed into PG* environment variables so the
 * password never appears in the process list or a log line.
 */
export interface BackupResult {
  file: string;
  bytes: number;
  pruned: number;
}

const BACKUP_PREFIX = 'nexus-';
const BACKUP_SUFFIX = '.dump';

function pgEnv(databaseUrl: string): NodeJS.ProcessEnv {
  const url = new URL(databaseUrl);
  const env: NodeJS.ProcessEnv = { ...process.env };
  env.PGHOST = decodeURIComponent(url.hostname);
  env.PGPORT = url.port || '5432';
  env.PGUSER = decodeURIComponent(url.username);
  env.PGPASSWORD = decodeURIComponent(url.password);
  env.PGDATABASE = url.pathname.replace(/^\//, '') || 'nexus';
  return env;
}

function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
    child.on('error', (err) =>
      reject(
        new Error(
          `Could not run ${command}: ${err.message}. Install the PostgreSQL client tools (postgresql-client) or set PG_DUMP_BIN.`,
        ),
      ),
    );
    child.on('close', (code) => {
      if (code === 0) resolve();
      else
        reject(new Error(`${command} exited with ${code}: ${stderr.trim()}`));
    });
  });
}

/** Remove backups older than the retention window. Returns how many. */
async function prune(
  directory: string,
  retentionDays: number,
  now: Date,
): Promise<number> {
  if (retentionDays <= 0) return 0;
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const entries = await readdir(directory).catch(() => [] as string[]);
  let pruned = 0;
  for (const entry of entries) {
    if (!entry.startsWith(BACKUP_PREFIX) || !entry.endsWith(BACKUP_SUFFIX)) {
      continue;
    }
    const file = path.join(directory, entry);
    const info = await stat(file).catch(() => null);
    if (info && info.mtimeMs < cutoff) {
      await unlink(file).catch(() => undefined);
      pruned++;
    }
  }
  return pruned;
}

/**
 * Dump the database. Throws on a missing pg_dump, a connection failure or an
 * empty dump file, so a scheduled backup failing is visible instead of
 * silently producing nothing.
 */
export async function runBackup(
  options: {
    databaseUrl?: string;
    directory?: string;
    retentionDays?: number;
    pgDumpBin?: string;
    now?: Date;
  } = {},
): Promise<BackupResult> {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL ?? '';
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set - refusing to back up nothing');
  }
  const directory = options.directory ?? process.env.BACKUP_DIR ?? './backups';
  const retentionDays = Number(
    options.retentionDays ?? process.env.BACKUP_RETENTION_DAYS ?? 7,
  );
  const pgDumpBin = options.pgDumpBin ?? process.env.PG_DUMP_BIN ?? 'pg_dump';
  const now = options.now ?? new Date();

  await mkdir(directory, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const file = path.join(directory, `${BACKUP_PREFIX}${stamp}${BACKUP_SUFFIX}`);

  await run(
    pgDumpBin,
    ['--format=custom', '--no-owner', '--no-privileges', `--file=${file}`],
    pgEnv(databaseUrl),
  );

  const info = await stat(file).catch(() => null);
  if (!info || info.size === 0) {
    throw new Error(`pg_dump produced no data at ${file}`);
  }

  const pruned = await prune(directory, retentionDays, now);
  return { file, bytes: info.size, pruned };
}
