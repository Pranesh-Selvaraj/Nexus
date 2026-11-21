import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { StorageDriver } from './driver.js';
import { resolveKeyPath } from './driver.js';

/** Local disk storage (the default): keys are paths under `root`. */
export class LocalStorage implements StorageDriver {
  readonly description: string;
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
    this.description = `local disk (${this.root})`;
  }

  async put(key: string, data: Buffer | string): Promise<void> {
    const filePath = resolveKeyPath(this.root, key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, data);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(resolveKeyPath(this.root, key));
  }

  async materialize(key: string): Promise<string> {
    return resolveKeyPath(this.root, key);
  }

  async delete(key: string): Promise<void> {
    await rm(resolveKeyPath(this.root, key), { force: true });
  }

  async deletePrefix(prefix: string): Promise<void> {
    await rm(resolveKeyPath(this.root, prefix), {
      recursive: true,
      force: true,
    });
  }
}
