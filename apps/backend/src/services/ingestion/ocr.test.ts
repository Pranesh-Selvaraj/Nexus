import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ocrAvailable,
  ocrImage,
  ocrPdfPages,
  pdfRasterAvailable,
  resetOcrAvailabilityCache,
  tesseractBinary,
} from './ocr.js';

const tmpDirs: string[] = [];
const originalTesseract = process.env.TESSERACT_BIN;
const originalRaster = process.env.PDF_RASTER_BIN;

async function shim(script: string, name = 'tesseract'): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nexus-ocr-test-'));
  tmpDirs.push(dir);
  const file = path.join(dir, name);
  await writeFile(file, script, 'utf8');
  await chmod(file, 0o755);
  return file;
}

beforeEach(() => {
  resetOcrAvailabilityCache();
});

afterEach(async () => {
  await Promise.all(
    tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
  if (originalTesseract === undefined) delete process.env.TESSERACT_BIN;
  else process.env.TESSERACT_BIN = originalTesseract;
  if (originalRaster === undefined) delete process.env.PDF_RASTER_BIN;
  else process.env.PDF_RASTER_BIN = originalRaster;
  resetOcrAvailabilityCache();
});

describe('OCR', () => {
  it('uses TESSERACT_BIN and echoes text through stdin', async () => {
    const bin = await shim(
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "tesseract 5.3.0"; exit 0; fi\ncat\n',
    );
    process.env.TESSERACT_BIN = bin;
    expect(tesseractBinary()).toBe(bin);
    expect(await ocrAvailable()).toBe(true);
    const text = await ocrImage(Buffer.from('VISIBLE LABEL'), {
      languages: 'eng',
      timeoutMs: 5_000,
    });
    expect(text).toBe('VISIBLE LABEL');
  });

  it('reports a missing binary with actionable instructions', async () => {
    process.env.TESSERACT_BIN = '/nonexistent/tesseract-binary';
    expect(await ocrAvailable()).toBe(false);
    await expect(
      ocrImage(Buffer.from('x'), { timeoutMs: 2_000 }),
    ).rejects.toThrow(/not installed/);
  });

  it('kills a hung OCR process at the timeout', async () => {
    const bin = await shim(
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "tesseract 5"; exit 0; fi\nsleep 30\n',
    );
    process.env.TESSERACT_BIN = bin;
    await expect(
      ocrImage(Buffer.from('x'), { timeoutMs: 200 }),
    ).rejects.toThrow(/timed out/);
  });

  it('requires a PDF rasterizer for scanned PDFs', async () => {
    const bin = await shim(
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "tesseract 5"; exit 0; fi\ncat\n',
    );
    process.env.TESSERACT_BIN = bin;
    process.env.PDF_RASTER_BIN = '/nonexistent/pdftoppm';
    expect(await pdfRasterAvailable()).toBe(false);
    await expect(ocrPdfPages('/tmp/whatever.pdf')).rejects.toThrow(
      /rasterization is not available/,
    );
  });
});
