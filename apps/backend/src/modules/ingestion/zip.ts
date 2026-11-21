/**
 * Zip container access with decompression limits.
 *
 * Every OOXML/EPUB/ODT file and every .zip upload goes through this module.
 * JSZip reports the uncompressed size in the central directory, which is
 * attacker-controlled: a 1 KB archive can claim to expand to gigabytes (zip
 * bomb) or to have a million entries. Both the declared sizes and the actual
 * bytes read are checked here before any parser sees the content.
 */
import JSZip from 'jszip';

import { ingestionLimits, type IngestionLimits } from './limits.js';

export class ZipLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipLimitError';
  }
}

export interface ZipEntryInfo {
  name: string;
  declaredSize: number;
  compressedSize: number;
}

export interface OpenedArchive {
  zip: JSZip;
  entries: ZipEntryInfo[];
  /** Compressed bytes of the whole archive. */
  archiveBytes: number;
  limits: IngestionLimits;
}

/** Path traversal / absolute paths / control characters in entry names. */
export function isUnsafeEntryName(name: string): boolean {
  if (name.includes('\0')) return true;
  if (name.startsWith('/') || name.startsWith('\\')) return true;
  if (/^[a-z]:[\\/]/i.test(name)) return true;
  return name.split(/[\\/]/).some((part) => part === '..');
}

/**
 * Validate an archive's entry table against the configured limits and return
 * an opened JSZip instance. Throws ZipLimitError with a user-facing message.
 */
export async function openArchive(
  buffer: Buffer,
  options: { limits?: Partial<IngestionLimits> } = {},
): Promise<OpenedArchive> {
  const limits = ingestionLimits(options.limits);
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer, {
      checkCRC32: false,
      createFolders: false,
    });
  } catch {
    throw new ZipLimitError('The archive is invalid or corrupt');
  }

  const files = Object.values(zip.files).filter((entry) => !entry.dir);
  if (files.length === 0) {
    throw new ZipLimitError('The archive contains no files');
  }
  if (files.length > limits.maxZipEntries) {
    throw new ZipLimitError(
      `The archive has ${files.length} entries, more than the ${limits.maxZipEntries} allowed`,
    );
  }

  let total = 0;
  const entries: ZipEntryInfo[] = [];
  for (const entry of files) {
    if (isUnsafeEntryName(entry.name)) {
      throw new ZipLimitError('The archive contains an unsafe file path');
    }
    // JSZip exposes the declared uncompressed size via the private _data
    // descriptor; the public API yields it when reading. Read the central
    // directory numbers defensively without trusting them for budgeting.
    const declared = declaredUncompressedSize(entry);
    const compressed = declaredCompressedSize(entry);
    if (declared > limits.maxEntryBytes) {
      throw new ZipLimitError(
        `Archive entry "${entry.name}" expands to more than the ${Math.round(limits.maxEntryBytes / 1024 / 1024)} MB entry limit`,
      );
    }
    if (declared > 0 && compressed > 0) {
      const ratio = declared / compressed;
      if (ratio > limits.maxCompressionRatio) {
        throw new ZipLimitError(
          `Archive entry "${entry.name}" has a compression ratio of ${Math.round(ratio)}:1, above the ${limits.maxCompressionRatio}:1 limit`,
        );
      }
    }
    total += declared;
    if (total > limits.maxUncompressedBytes) {
      throw new ZipLimitError(
        `The archive expands to more than the ${Math.round(limits.maxUncompressedBytes / 1024 / 1024)} MB total limit`,
      );
    }
    entries.push({
      name: entry.name,
      declaredSize: declared,
      compressedSize: compressed,
    });
  }

  return { zip, entries, archiveBytes: buffer.length, limits };
}

/** Best-effort declared uncompressed size from JSZip's entry descriptor. */
function declaredUncompressedSize(entry: JSZip.JSZipObject): number {
  const data = (entry as unknown as { _data?: { uncompressedSize?: number } })
    ._data;
  return Number(data?.uncompressedSize ?? 0);
}

function declaredCompressedSize(entry: JSZip.JSZipObject): number {
  const data = (entry as unknown as { _data?: { compressedSize?: number } })
    ._data;
  return Number(data?.compressedSize ?? 0);
}

/**
 * Read one entry as UTF-8 text, enforcing the per-entry and total budgets
 * against the *actual* bytes returned (a lying central directory cannot
 * smuggle a huge string past this check).
 */
export async function readEntryText(
  archive: OpenedArchive,
  name: string,
  budget: { remaining: number },
): Promise<string> {
  const buffer = await readEntryBuffer(archive, name, budget);
  return buffer.toString('utf8');
}

/**
 * Read one entry as a Buffer with the same budget accounting.
 *
 * Decompression is consumed chunk by chunk with a hard byte ceiling, so an
 * entry whose central-directory sizes lie about its real expansion still
 * cannot allocate more than the remaining budget before being rejected.
 */
export async function readEntryBuffer(
  archive: OpenedArchive,
  name: string,
  budget: { remaining: number },
): Promise<Buffer> {
  const entry = archive.zip.files[name];
  if (!entry) throw new ZipLimitError(`Missing archive entry "${name}"`);

  const ceiling = Math.min(
    archive.limits.maxEntryBytes,
    Math.max(0, budget.remaining),
  );
  const chunks: Buffer[] = [];
  let total = 0;
  await new Promise<void>((resolve, reject) => {
    // JSZip ships `internalStream` on the object but not in its typings;
    // it is the only API that decompresses chunk by chunk.
    const stream = (
      entry as unknown as {
        internalStream: (type: 'nodebuffer') => {
          on: (event: string, handler: (value: never) => void) => void;
          pause: () => void;
          resume: () => void;
        };
      }
    ).internalStream('nodebuffer');
    let settled = false;
    stream.on('data', (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > ceiling) {
        settled = true;
        stream.pause();
        reject(
          ceiling >= archive.limits.maxEntryBytes
            ? new ZipLimitError(
                `Archive entry "${name}" is larger than the ${Math.round(archive.limits.maxEntryBytes / 1024 / 1024)} MB entry limit`,
              )
            : new ZipLimitError(
                `The archive expands to more than the ${Math.round(archive.limits.maxUncompressedBytes / 1024 / 1024)} MB total limit`,
              ),
        );
        return;
      }
      chunks.push(chunk);
    });
    stream.on('error', (error: Error) => {
      if (settled) return;
      settled = true;
      reject(
        error instanceof ZipLimitError
          ? error
          : new ZipLimitError(`Could not read archive entry "${name}"`),
      );
    });
    stream.on('end', () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    // JSZip's StreamHelper stays paused until resumed explicitly.
    stream.resume();
  });

  const buffer = Buffer.concat(chunks, total);
  budget.remaining -= buffer.byteLength;
  if (budget.remaining < 0) {
    throw new ZipLimitError(
      `The archive expands to more than the ${Math.round(archive.limits.maxUncompressedBytes / 1024 / 1024)} MB total limit`,
    );
  }
  return buffer;
}

/** Sorted, case-insensitively ordered file entries (stable output). */
export function sortedEntries(archive: OpenedArchive): ZipEntryInfo[] {
  return [...archive.entries].sort((a, b) =>
    a.name.localeCompare(b.name, 'en', { numeric: true }),
  );
}
