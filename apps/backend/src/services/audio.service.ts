import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { and, asc, eq, isNotNull, lt, sql } from 'drizzle-orm';

import type { AudioAssetDTO, AudioKind } from '@nexus/shared-types';

import { db } from '../db/index.js';
import { audioAssets } from '../db/schema.js';
import { getSettingNumber } from './settings.service.js';
import { UPLOAD_DIR } from '../utils/paths.js';

// ---------------------------------------------------------------------------
// Audio storage layout
//
// All generated/retained audio lives under <UPLOAD_DIR>/audio. The DB row is
// the source of truth for metadata, ownership and retention; the file name is
// always a server-generated hash or uuid, never user input.
// ---------------------------------------------------------------------------

export const AUDIO_DIR = path.join(UPLOAD_DIR, 'audio');

export interface AudioCacheKeyInput {
  /** Owner: cached speech is private to the requesting user. */
  owner: string;
  /** Synthesis model (part of the identity of the bytes). */
  model: string;
  voice: string;
  speed: number;
  format: string;
  text: string;
}

/**
 * Content address for cached speech. Two requests from the same user with
 * the same text, voice, speed, format and model can never legitimately return
 * different audio, so the hash is a safe cache identity. The owner is part of
 * the key because playback is owner-scoped: a shared key would hand one user
 * another user's asset id, which the audio endpoint would then refuse.
 */
export function audioCacheKey(input: AudioCacheKeyInput): string {
  const canonical = [
    input.owner,
    input.model,
    input.voice,
    String(input.speed),
    input.format,
    input.text,
  ].join('\u0000');
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Retention deadline for a newly stored asset. 0 days means "keep until the
 * quota evicts it", matching the settings description.
 */
export function retentionExpiry(
  retentionDays: number,
  now: Date = new Date(),
): Date | null {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return null;
  return new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000);
}

export interface QuotaRow {
  id: string;
  sizeBytes: number;
  createdAt: Date;
}

/**
 * Oldest-first list of asset ids to delete so the user's total audio bytes
 * fit under `maxBytes`. Pure so the eviction policy is unit-testable without
 * a database. Never returns the most recent asset, so a single oversized
 * asset cannot make the quota unreachable.
 */
export function selectQuotaEvictions(
  rows: QuotaRow[],
  maxBytes: number,
): string[] {
  const total = rows.reduce((sum, row) => sum + row.sizeBytes, 0);
  if (total <= maxBytes) return [];
  const ordered = [...rows].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  const evictions: string[] = [];
  let remaining = total;
  for (let i = 0; i < ordered.length - 1 && remaining > maxBytes; i++) {
    const row = ordered[i];
    if (!row) continue;
    evictions.push(row.id);
    remaining -= row.sizeBytes;
  }
  return evictions;
}

export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Parse an HTTP Range header (bytes=start-end) for a file of `size` bytes.
 * Returns null when the header is absent or not a single satisfiable range,
 * in which case the caller should serve the whole file with 200.
 */
export function parseRange(
  header: string | undefined,
  size: number,
): ByteRange | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  let start: number;
  let end: number;
  if (rawStart === '') {
    // Suffix range: last N bytes.
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Number(rawEnd);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

export function guessExtension(mimeType: string): string {
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a';
  return 'bin';
}

const AUDIO_MIME_BY_EXTENSION: Record<string, string> = {
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  mp3: 'audio/mpeg',
  mp4: 'audio/mp4',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  flac: 'audio/flac',
  aac: 'audio/aac',
};

/**
 * Content type derived from the (allowlisted) file extension rather than the
 * client-declared MIME. Recording uploads are stored and later served back, so
 * a spoofed `text/html` content type must never round-trip (same-origin HTML).
 */
export function safeAudioMimeType(filename: string): string {
  const ext = path.extname(filename).slice(1).toLowerCase();
  return AUDIO_MIME_BY_EXTENSION[ext] ?? 'application/octet-stream';
}

/** Absolute, validated path for a stored asset. */
export function audioFilePath(relativePath: string): string {
  const resolved = path.resolve(UPLOAD_DIR, relativePath);
  const root = path.resolve(AUDIO_DIR);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Refusing to serve audio outside the audio directory');
  }
  return resolved;
}

export function toAudioDTO(
  row: typeof audioAssets.$inferSelect,
): AudioAssetDTO {
  return {
    id: row.id,
    kind: row.kind as AudioKind,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    durationMs: row.durationMs,
    createdAt: new Date(row.createdAt).toISOString(),
    expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
  };
}

export interface StoreAudioInput {
  userId: string;
  workspaceId?: string | null;
  kind: AudioKind;
  cacheKey?: string | null;
  voice?: string | null;
  speed?: number | null;
  mimeType: string;
  buffer: Buffer;
  durationMs?: number | null;
  retentionDays?: number | null;
}

/** Look up a cached TTS asset by its content address. */
export async function getCachedAudio(
  cacheKey: string,
): Promise<typeof audioAssets.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(audioAssets)
    .where(eq(audioAssets.cacheKey, cacheKey))
    .limit(1);
  if (!row) return null;
  try {
    await stat(audioFilePath(row.filePath));
  } catch {
    // Row survived but the file is gone (volume reset): drop the stale row.
    await db.delete(audioAssets).where(eq(audioAssets.id, row.id));
    return null;
  }
  return row;
}

/** Persist an audio buffer and its metadata, then enforce the quota. */
export async function storeAudio(
  input: StoreAudioInput,
): Promise<typeof audioAssets.$inferSelect> {
  await mkdir(AUDIO_DIR, { recursive: true });
  const extension = guessExtension(input.mimeType);
  // The file name is always a fresh UUID: never derive it from the cache key,
  // or two concurrent identical requests would write the same path and the
  // losing insert could delete the file the winning row points at.
  const fileName = `${randomUUID()}.${extension}`;
  const absolutePath = path.join(AUDIO_DIR, fileName);
  const relativePath = path.join('audio', fileName).split(path.sep).join('/');
  await writeFile(absolutePath, input.buffer);

  let row: typeof audioAssets.$inferSelect | undefined;
  try {
    [row] = await db
      .insert(audioAssets)
      .values({
        userId: input.userId,
        workspaceId: input.workspaceId ?? null,
        kind: input.kind,
        cacheKey: input.cacheKey ?? null,
        voice: input.voice ?? null,
        speed: input.speed ?? null,
        mimeType: input.mimeType,
        format: extension,
        sizeBytes: input.buffer.byteLength,
        durationMs: input.durationMs ?? null,
        filePath: relativePath,
        expiresAt: retentionExpiry(input.retentionDays ?? 0),
      })
      // A hot cache race can insert the same key twice; keep the first row
      // and return the existing one instead of failing the user's playback.
      .onConflictDoNothing({ target: audioAssets.cacheKey })
      .returning();
  } catch (error) {
    // The row never committed: remove our file so it does not linger.
    await rm(absolutePath, { force: true }).catch(() => undefined);
    throw error;
  }

  if (!row) {
    // Our insert lost the race; drop only our own (unreferenced) file.
    await rm(absolutePath, { force: true }).catch(() => undefined);
    const existing = input.cacheKey
      ? await getCachedAudio(input.cacheKey)
      : null;
    if (existing) return existing;
    throw new Error('Failed to store audio');
  }

  await enforceAudioQuota(input.userId);
  return row;
}

/** Total audio bytes kept for one user. */
export async function audioUsage(userId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`COALESCE(SUM(size_bytes), 0)::bigint` })
    .from(audioAssets)
    .where(eq(audioAssets.userId, userId));
  return Number(row?.total ?? 0);
}

/** Evict the oldest assets when the user's audio exceeds the configured cap. */
export async function enforceAudioQuota(
  userId: string,
  maxBytes?: number,
): Promise<string[]> {
  const limit =
    maxBytes ??
    (Number(await getSettingNumber('voice.maxStorageMb')) || 200) * 1024 * 1024;
  const rows = await db
    .select({
      id: audioAssets.id,
      sizeBytes: audioAssets.sizeBytes,
      createdAt: audioAssets.createdAt,
    })
    .from(audioAssets)
    .where(eq(audioAssets.userId, userId))
    .orderBy(asc(audioAssets.createdAt));
  const evictions = selectQuotaEvictions(rows, limit);
  for (const id of evictions) {
    await deleteAudioAsset(id);
  }
  return evictions;
}

/** Remove an asset row and its file (best effort on the filesystem). */
export async function deleteAudioAsset(id: string): Promise<boolean> {
  const [row] = await db
    .select()
    .from(audioAssets)
    .where(eq(audioAssets.id, id))
    .limit(1);
  if (!row) return false;
  await db.delete(audioAssets).where(eq(audioAssets.id, id));
  await rm(audioFilePath(row.filePath), { force: true }).catch(() => undefined);
  return true;
}

/**
 * Delete assets whose retention deadline passed. Called from the daily
 * maintenance job; returns the number of files removed.
 */
export async function purgeExpiredAudio(
  now: Date = new Date(),
): Promise<number> {
  const rows = await db
    .select({ id: audioAssets.id, filePath: audioAssets.filePath })
    .from(audioAssets)
    .where(
      and(isNotNull(audioAssets.expiresAt), lt(audioAssets.expiresAt, now)),
    );
  for (const row of rows) {
    await db.delete(audioAssets).where(eq(audioAssets.id, row.id));
    try {
      await rm(audioFilePath(row.filePath), { force: true });
    } catch {
      // A malformed path row must not abort the whole maintenance sweep.
    }
  }
  return rows.length;
}

/** Ownership guard shared by the audio streaming endpoint and routers. */
export async function getOwnedAudio(
  userId: string,
  audioId: string,
): Promise<typeof audioAssets.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(audioAssets)
    .where(and(eq(audioAssets.id, audioId), eq(audioAssets.userId, userId)))
    .limit(1);
  return row ?? null;
}
