import { describe, expect, it } from 'vitest';

import {
  buildDocx,
  buildEpub,
  buildOdt,
  buildPdf,
  buildPptx,
  buildXlsx,
  TINY_JPEG,
  TINY_PNG,
  zipBuffer,
} from './fixtures.test-utils.js';
import {
  detectFile,
  isImageFormat,
  isMediaFormat,
  looksLikeLegacyOffice,
  looksLikeText,
  mimeForFormat,
  refineZipFormat,
  sniffBinaryFormat,
} from './magic.js';

describe('magic-byte detection', () => {
  it('detects PDF without trusting the extension', async () => {
    const pdf = buildPdf(['Hello']);
    expect(sniffBinaryFormat(pdf)).toBe('pdf');
    const detected = await detectFile(pdf, 'not-really.txt');
    expect(detected?.format).toBe('pdf');
    expect(detected?.mime).toBe('application/pdf');
  });

  it('detects images by signature', async () => {
    expect((await detectFile(TINY_PNG, 'picture.txt'))?.format).toBe('png');
    expect((await detectFile(TINY_JPEG, 'picture'))?.format).toBe('jpeg');
    expect(isImageFormat('png')).toBe(true);
    expect(isMediaFormat('mp3')).toBe(true);
    expect(mimeForFormat('jpeg')).toBe('image/jpeg');
  });

  it('distinguishes zip-based containers by their entry names', async () => {
    expect((await detectFile(await buildDocx('hi'), 'a.zip'))?.format).toBe(
      'docx',
    );
    expect(
      (await detectFile(await buildPptx([{ body: ['slide'] }]), 'a.zip'))
        ?.format,
    ).toBe('pptx');
    expect(
      (
        await detectFile(
          await buildXlsx([{ name: 'S', rows: [['x']] }]),
          'a.zip',
        )
      )?.format,
    ).toBe('xlsx');
    expect(
      (await detectFile(await buildOdt([{ text: 'hi' }]), 'a.zip'))?.format,
    ).toBe('odt');
    expect(
      (
        await detectFile(
          await buildEpub([{ title: 'One', paragraphs: ['text'] }]),
          'a.zip',
        )
      )?.format,
    ).toBe('epub');
    expect(
      (await detectFile(await zipBuffer({ 'notes.txt': 'hello' }), 'a.zip'))
        ?.format,
    ).toBe('zip');
  });

  it('treats unknown zip variants as archives', async () => {
    const refined = await refineZipFormat(
      await zipBuffer({ 'unknown.bin': 'x' }),
    );
    expect(refined.format).toBe('zip');
  });

  it('detects RTF, HTML, WebVTT and plain text', async () => {
    expect(sniffBinaryFormat(Buffer.from('{\\rtf1 hello}'))).toBe('rtf');
    expect(
      sniffBinaryFormat(
        Buffer.from('<!DOCTYPE html><html><body>x</body></html>'),
      ),
    ).toBe('html');
    expect(
      sniffBinaryFormat(Buffer.from('WEBVTT\n\n00:00.000 --> 00:01.000\nHi')),
    ).toBe('vtt');
    expect(sniffBinaryFormat(Buffer.from('plain notes about retrieval'))).toBe(
      'txt',
    );
  });

  it('rejects binaries and legacy Office files', async () => {
    const legacy = Buffer.from([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
    ]);
    expect(looksLikeLegacyOffice(legacy)).toBe(true);
    expect(await detectFile(legacy, 'old.doc')).toBeNull();
    const random = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x00, 0xff, 0xfe]);
    expect(await detectFile(random, 'data.bin')).toBeNull();
  });

  it('keeps the plain-text flavour from the extension', async () => {
    expect(
      (await detectFile(Buffer.from('# Heading\n\nBody'), 'notes.md'))?.format,
    ).toBe('md');
    expect(
      (await detectFile(Buffer.from('a,b\n1,2'), 'table.csv'))?.format,
    ).toBe('csv');
    expect((await detectFile(Buffer.from('{"a":1}'), 'x.json'))?.format).toBe(
      'json',
    );
    expect(
      (await detectFile(Buffer.from('hello'), 'notes.unknownext'))?.format,
    ).toBe('txt');
  });

  it('rejects text files that are mostly binary', () => {
    expect(looksLikeText(Buffer.from([0x00, 0x41, 0x42]))).toBe(false);
    expect(looksLikeText(Buffer.from('café ☕'))).toBe(true);
  });
});
