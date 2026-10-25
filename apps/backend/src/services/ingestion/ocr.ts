/**
 * OCR for scanned PDFs and images.
 *
 * Deliberately built on the system `tesseract` binary rather than a bundled
 * WASM build: tesseract.js downloads ~15 MB of language data at first use,
 * which breaks air-gapped self-hosting and adds a network dependency to an
 * ingestion path. The binary is optional - when it (or poppler's
 * `pdftoppm` for PDF pages) is missing, ingestion reports an actionable
 * error instead of failing mysteriously, and the rest of the pipeline keeps
 * working. `TESSERACT_BIN` / `PDF_RASTER_BIN` make both injectable for tests
 * and for unusual deployments.
 *
 * Every invocation is timeout-bounded and output-capped: OCR is the most
 * expensive thing an uploaded file can trigger.
 */
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { ingestionLimits } from './limits.js';

const execFileAsync = promisify(execFile);

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const availabilityCache = new Map<string, boolean>();

export function tesseractBinary(): string {
  return process.env.TESSERACT_BIN?.trim() || 'tesseract';
}

export function pdfRasterBinary(): string {
  return process.env.PDF_RASTER_BIN?.trim() || 'pdftoppm';
}

function languagesSetting(): string {
  const raw = process.env.OCR_LANGUAGES?.trim();
  return raw || 'eng';
}

/** Run a process with stdin input, a timeout, and an output cap. */
function runProcess(
  binary: string,
  args: string[],
  options: { input?: Buffer; timeoutMs: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    let total = 0;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(
        new Error(
          `OCR timed out after ${Math.round(options.timeoutMs / 1000)}s`,
        ),
      );
    }, options.timeoutMs);

    const finish = (error: Error | null, value?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value ?? '');
    };

    child.stdout.on('data', (chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > MAX_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        finish(new Error('OCR produced more text than the output cap allows'));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => errors.push(chunk));
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        finish(
          new Error(
            `OCR tool "${binary}" is not installed (install tesseract-ocr / poppler-utils, or set TESSERACT_BIN / PDF_RASTER_BIN)`,
          ),
        );
        return;
      }
      finish(new Error(`OCR failed: ${error.message}`));
    });
    child.on('close', (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(errors)
          .toString('utf8')
          .trim()
          .slice(0, 400);
        finish(
          new Error(
            `OCR tool "${binary}" exited with code ${code}${stderr ? `: ${stderr}` : ''}`,
          ),
        );
        return;
      }
      finish(null, Buffer.concat(chunks).toString('utf8'));
    });

    if (options.input) child.stdin.write(options.input);
    child.stdin.end();
  });
}

/** True when the tesseract binary is present and executable (cached). */
export async function ocrAvailable(force = false): Promise<boolean> {
  const binary = tesseractBinary();
  if (!force && availabilityCache.has(binary)) {
    return availabilityCache.get(binary) as boolean;
  }
  let available: boolean;
  try {
    const { stdout } = await execFileAsync(binary, ['--version'], {
      timeout: 5_000,
    });
    available = /tesseract/i.test(stdout);
  } catch {
    available = false;
  }
  availabilityCache.set(binary, available);
  return available;
}

/** True when the PDF rasterizer is present (needed only for scanned PDFs). */
export async function pdfRasterAvailable(): Promise<boolean> {
  const binary = pdfRasterBinary();
  const key = `raster:${binary}`;
  if (availabilityCache.has(key)) return availabilityCache.get(key) as boolean;
  let available: boolean;
  try {
    await execFileAsync(binary, ['-v'], { timeout: 5_000 });
    available = true;
  } catch {
    available = false;
  }
  availabilityCache.set(key, available);
  return available;
}

/** Forget cached availability (tests). */
export function resetOcrAvailabilityCache(): void {
  availabilityCache.clear();
}

export interface OcrOptions {
  languages?: string;
  timeoutMs?: number;
}

/** OCR one image buffer (PNG/JPEG/TIFF/BMP/WebP) through tesseract's stdin. */
export async function ocrImage(
  buffer: Buffer,
  options: OcrOptions = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? ingestionLimits().ocrTimeoutMs;
  const languages = options.languages ?? languagesSetting();
  const text = await runProcess(
    tesseractBinary(),
    ['stdin', 'stdout', '-l', languages, '--psm', '3'],
    { input: buffer, timeoutMs },
  );
  return text.replace(/\r\n?/g, '\n').trim();
}

/**
 * Rasterize the leading pages of a PDF and OCR each one. Bounded by
 * `OCR_MAX_PAGES` (default 30) so a 900-page scan cannot pin the worker.
 */
export async function ocrPdfPages(
  filePath: string,
  options: OcrOptions & { maxPages?: number } = {},
): Promise<Array<{ page: number; text: string }>> {
  const limits = ingestionLimits();
  const maxPages = options.maxPages ?? limits.maxOcrPages;
  if (!(await ocrAvailable())) {
    throw new Error(
      'OCR is not available: install tesseract-ocr (or set TESSERACT_BIN) to index scanned PDFs',
    );
  }
  if (!(await pdfRasterAvailable())) {
    throw new Error(
      'PDF rasterization is not available: install poppler-utils (pdftoppm) to OCR scanned PDFs, or upload page images instead',
    );
  }

  const dir = await mkdtemp(path.join(os.tmpdir(), 'nexus-ocr-'));
  const prefix = path.join(dir, 'page');
  try {
    await runProcess(
      pdfRasterBinary(),
      [
        '-r',
        '200',
        '-gray',
        '-png',
        '-f',
        '1',
        '-l',
        String(maxPages),
        filePath,
        prefix,
      ],
      { timeoutMs: limits.parserTimeoutMs },
    );
    const files = (await readdir(dir))
      .filter((name) => name.endsWith('.png'))
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    const pages: Array<{ page: number; text: string }> = [];
    for (const [index, name] of files.entries()) {
      const fullPath = path.join(dir, name);
      // Skip absurdly large renders rather than feeding them to tesseract.
      const info = await stat(fullPath);
      if (info.size > limits.maxEntryBytes) continue;
      const buffer = await readFile(fullPath);
      const text = await ocrImage(buffer, options);
      if (text) pages.push({ page: index + 1, text });
    }
    return pages;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
