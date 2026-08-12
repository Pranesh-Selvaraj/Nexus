import { describe, expect, it } from 'vitest';

import { ALLOWED_EXTENSIONS, fileFilter } from './multer.config.js';

function mockFile(name: string): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: name,
    encoding: '7bit',
    mimetype: 'application/octet-stream',
    size: 1,
    destination: '',
    filename: '',
    path: '',
    buffer: Buffer.alloc(0),
  } as Express.Multer.File;
}

function filter(name: string): Promise<Error | true> {
  return new Promise((resolve) => {
    fileFilter({} as Express.Request, mockFile(name), (err) =>
      resolve(err ?? true),
    );
  });
}

describe('multer fileFilter', () => {
  it('allows every extension in ALLOWED_EXTENSIONS', async () => {
    for (const ext of ALLOWED_EXTENSIONS) {
      await expect(filter(`report.${ext}`)).resolves.toBe(true);
    }
    // uppercase extensions are normalized
    await expect(filter('REPORT.PDF')).resolves.toBe(true);
  });

  it('rejects disallowed extensions', async () => {
    for (const name of [
      'evil.exe',
      'script.sh',
      'doc.docx',
      'photo.png',
      'noext',
    ]) {
      const result = await filter(name);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain('Unsupported file type');
    }
  });

  it('rejects nested/dotted names based on the final extension', async () => {
    const result = await filter('archive.tar.gz');
    expect(result).toBeInstanceOf(Error);
  });
});
