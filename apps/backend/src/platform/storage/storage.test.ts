import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalStorage } from './local.js';

let root: string;
let store: LocalStorage;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'nexus-storage-test-'));
  store = new LocalStorage(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('LocalStorage', () => {
  it('round-trips a buffer and a string under a key', async () => {
    await store.put('ws-1/file-a', Buffer.from('hello'));
    await store.put('ws-1/file-b', 'world');
    expect((await store.get('ws-1/file-a')).toString()).toBe('hello');
    expect((await store.get('ws-1/file-b')).toString()).toBe('world');
  });

  it('materialize returns a readable local path', async () => {
    await store.put('ws-1/file', Buffer.from('payload'));
    const filePath = await store.materialize('ws-1/file');
    expect(path.isAbsolute(filePath)).toBe(true);
    expect((await readFile(filePath)).toString()).toBe('payload');
  });

  it('deletes one key and whole prefixes', async () => {
    await store.put('ws-1/a', 'a');
    await store.put('ws-1/b', 'b');
    await store.put('ws-2/c', 'c');
    await store.delete('ws-1/a');
    await expect(store.get('ws-1/a')).rejects.toThrow();
    await store.deletePrefix('ws-1');
    await expect(store.get('ws-1/b')).rejects.toThrow();
    expect((await store.get('ws-2/c')).toString()).toBe('c');
  });

  it('rejects traversal, absolute and malformed keys', async () => {
    for (const key of [
      '../escape',
      '/absolute',
      'a/../../b',
      'a\\b',
      'a//b',
      '',
    ]) {
      await expect(store.put(key, 'x')).rejects.toThrow(/storage key/i);
    }
  });

  it('describes itself for logs', () => {
    expect(store.description).toContain(root);
  });
});
