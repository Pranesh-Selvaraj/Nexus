import { afterEach, describe, expect, it } from 'vitest';

import {
  buildOdt,
  buildPdf,
  TINY_PNG,
  zipBuffer,
} from './fixtures.test-utils.js';
import { UploadRejectedError, validateUpload } from './validate.js';

const originalMaxEntries = process.env.MAX_ZIP_ENTRIES;

afterEach(() => {
  if (originalMaxEntries === undefined) delete process.env.MAX_ZIP_ENTRIES;
  else process.env.MAX_ZIP_ENTRIES = originalMaxEntries;
});

describe('upload admission', () => {
  it('rejects empty files', async () => {
    await expect(
      validateUpload(Buffer.alloc(0), 'a.txt', { maxImageMb: 5 }),
    ).rejects.toThrow(UploadRejectedError);
  });

  it('rejects executable and script extensions even when the bytes are text', async () => {
    for (const name of ['run.exe', 'deploy.sh', 'tool.py', 'bundle.js']) {
      await expect(
        validateUpload(Buffer.from('plain text'), name, { maxImageMb: 5 }),
      ).rejects.toThrow(/Executable and script files/);
    }
  });

  it('trusts the bytes over a misleading extension', async () => {
    const result = await validateUpload(buildPdf(['text']), 'report.txt', {
      maxImageMb: 5,
    });
    expect(result.detected.format).toBe('pdf');
    expect(result.contentHash).toHaveLength(64);
  });

  it('accepts an ODT container and hashes the content', async () => {
    const buffer = await buildOdt([{ text: 'hello' }]);
    const result = await validateUpload(buffer, 'notes.odt', { maxImageMb: 5 });
    expect(result.detected.format).toBe('odt');
    expect(result.mime).toBe('application/vnd.oasis.opendocument.text');
  });

  it('rejects legacy Office files with an actionable message', async () => {
    const legacy = Buffer.from([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
    ]);
    await expect(
      validateUpload(legacy, 'old.doc', { maxImageMb: 5 }),
    ).rejects.toThrow(/save as .docx/);
  });

  it('rejects unrecognised binary content', async () => {
    await expect(
      validateUpload(Buffer.from([0x00, 0x01, 0x02, 0x03]), 'blob.dat', {
        maxImageMb: 5,
      }),
    ).rejects.toThrow(/Unrecognised file content/);
  });

  it('enforces the image size cap', async () => {
    await expect(
      validateUpload(TINY_PNG, 'diagram.png', { maxImageMb: 0.000001 }),
    ).rejects.toThrow(/vision limit/);
    const ok = await validateUpload(TINY_PNG, 'diagram.png', { maxImageMb: 5 });
    expect(ok.detected.format).toBe('png');
  });

  it('rejects zip bombs at admission', async () => {
    process.env.MAX_ZIP_ENTRIES = '2';
    const buffer = await zipBuffer({
      'a.txt': 'a',
      'b.txt': 'b',
      'c.txt': 'c',
    });
    await expect(
      validateUpload(buffer, 'folder.zip', { maxImageMb: 5 }),
    ).rejects.toThrow(/more than the 2 allowed/);
  });
});
