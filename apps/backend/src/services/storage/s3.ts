import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import type { StorageDriver } from './driver.js';
import { assertSafeKey, resolveKeyPath } from './driver.js';

export interface S3StorageOptions {
  bucket: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
  /** Directory for parser downloads; defaults to a temp cache. */
  cacheDir?: string;
}

/**
 * S3-compatible object storage. Objects are written under the same relative
 * keys the database already stores, optionally under a deployment prefix, and
 * are downloaded into `cacheDir` when a parser needs a local file.
 */
export class S3Storage implements StorageDriver {
  readonly description: string;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly cacheDir: string;
  private readonly prefix: string;

  constructor(options: S3StorageOptions) {
    this.bucket = options.bucket;
    this.prefix = (process.env.S3_KEY_PREFIX ?? '').replace(/^\/+|\/+$/g, '');
    this.cacheDir = path.resolve(
      options.cacheDir ??
        process.env.S3_CACHE_DIR ??
        path.join(os.tmpdir(), 'nexus-s3-cache'),
    );
    const accessKeyId = options.accessKeyId ?? process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey =
      options.secretAccessKey ?? process.env.S3_SECRET_ACCESS_KEY;
    this.client = new S3Client({
      region: options.region ?? process.env.S3_REGION ?? 'us-east-1',
      endpoint: options.endpoint ?? process.env.S3_ENDPOINT,
      forcePathStyle:
        options.forcePathStyle ??
        (process.env.S3_FORCE_PATH_STYLE
          ? process.env.S3_FORCE_PATH_STYLE === 'true'
          : Boolean(options.endpoint ?? process.env.S3_ENDPOINT)),
      credentials:
        accessKeyId && secretAccessKey
          ? { accessKeyId, secretAccessKey }
          : undefined,
    });
    this.description = `s3 (${this.bucket}${this.prefix ? `/${this.prefix}` : ''})`;
  }

  private objectKey(key: string): string {
    assertSafeKey(key);
    return this.prefix ? `${this.prefix}/${key}` : key;
  }

  async put(key: string, data: Buffer | string): Promise<void> {
    const body = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key),
        Body: body,
        ContentLength: body.length,
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key),
      }),
    );
    if (!result.Body) throw new Error('Object body is empty');
    return Buffer.from(await result.Body.transformToByteArray());
  }

  async materialize(key: string): Promise<string> {
    const filePath = resolveKeyPath(this.cacheDir, key);
    const existing = await readFile(filePath).catch(() => null);
    if (existing) return filePath;
    const data = await this.get(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, data);
    return filePath;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key),
      }),
    );
    await rm(resolveKeyPath(this.cacheDir, key), { force: true }).catch(
      () => undefined,
    );
  }

  async deletePrefix(prefix: string): Promise<void> {
    assertSafeKey(prefix);
    const base = this.objectKey(prefix);
    let continuationToken: string | undefined;
    do {
      const listed = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: `${base}/`,
          ContinuationToken: continuationToken,
        }),
      );
      const keys = (listed.Contents ?? [])
        .map((object) => object.Key)
        .filter((key): key is string => Boolean(key));
      if (keys.length > 0) {
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: keys.map((key) => ({ Key: key })) },
          }),
        );
      }
      continuationToken = listed.IsTruncated
        ? listed.NextContinuationToken
        : undefined;
    } while (continuationToken);

    await rm(resolveKeyPath(this.cacheDir, prefix), {
      recursive: true,
      force: true,
    }).catch(() => undefined);
  }
}
