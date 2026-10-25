#!/usr/bin/env node
/**
 * Storage backend self-test: round-trips one object through the configured
 * driver (local disk or S3/MinIO), verifies materialization and deletion, and
 * prints the driver description. Use it to validate S3 credentials before
 * switching a deployment:
 *
 *   STORAGE_DRIVER=s3 S3_BUCKET=nexus S3_ENDPOINT=http://localhost:9000 \
 *   S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... \
 *     pnpm --filter @nexus/backend storage:selftest
 */
import '../src/utils/env.js';

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { storage } from '../src/services/storage/index.js';

const key = `selftest/${randomUUID()}`;
const payload = `nexus storage selftest ${new Date().toISOString()}\n`;

try {
  console.log(`driver: ${storage.description}`);
  await storage.put(key, payload);
  const fetched = (await storage.get(key)).toString();
  if (fetched !== payload) throw new Error('get() returned different bytes');

  const localPath = await storage.materialize(key);
  const materialized = await readFile(localPath, 'utf8');
  if (materialized !== payload) {
    throw new Error('materialize() returned different bytes');
  }

  await storage.delete(key);
  let deleted = false;
  try {
    await storage.get(key);
  } catch {
    deleted = true;
  }
  if (!deleted) throw new Error('delete() did not remove the object');

  console.log('storage selftest passed');
} catch (err) {
  console.error(
    `storage selftest failed: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
}
