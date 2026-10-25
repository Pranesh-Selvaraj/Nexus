/**
 * XLSX parser: one page per worksheet, rows as ` | `-separated lines.
 *
 * Values are resolved through the shared string table (most cells are
 * references), inline strings, booleans and formulas' cached results. The
 * sheet order comes from workbook.xml, not the file numbering, so a workbook
 * with renamed/reordered sheets keeps its intended structure.
 */
import { decodeEntities } from '../readability.js';
import { ingestionLimits } from '../limits.js';
import { openArchive, readEntryText, type OpenedArchive } from '../zip.js';
import {
  assertHasText,
  buildMetadata,
  type ParseContext,
  type ParsedDocument,
} from './types.js';

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) {
    result[match[1] as string] = match[2] as string;
  }
  return result;
}

/** Shared string table entries, in order (`<si>` may contain rich runs). */
export function parseSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const strings: string[] = [];
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)) {
    const inner = match[1] ?? '';
    const text = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)]
      .map((run) => decodeEntities(run[1] ?? ''))
      .join('');
    strings.push(text);
  }
  return strings;
}

interface SheetRef {
  name: string;
  target: string;
}

/** Sheet name + relationship target, in workbook order. */
export function parseWorkbook(
  workbookXml: string,
  relsXml: string,
): SheetRef[] {
  const relTargets = new Map<string, string>();
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const attrs = attributes(match[0]);
    if (attrs.Id && attrs.Target) {
      relTargets.set(
        attrs.Id,
        attrs.Target.replace(/^\/?xl\//, '').replace(/^\.\//, ''),
      );
    }
  }
  const sheets: SheetRef[] = [];
  for (const match of workbookXml.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const attrs = attributes(match[0]);
    const relId = attrs['r:id'];
    const target = relId ? relTargets.get(relId) : undefined;
    if (attrs.name && target) {
      sheets.push({ name: attrs.name, target: `xl/${target}` });
    }
  }
  return sheets;
}

function cellText(
  attrs: Record<string, string>,
  inner: string,
  shared: string[],
): string {
  const type = attrs.t ?? 'n';
  if (type === 's') {
    const index = Number(/<v[^>]*>(-?\d+)<\/v>/i.exec(inner)?.[1] ?? -1);
    return shared[index] ?? '';
  }
  if (type === 'inlineStr') {
    return [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)]
      .map((match) => decodeEntities(match[1] ?? ''))
      .join('');
  }
  const value = /<v[^>]*>([\s\S]*?)<\/v>/i.exec(inner)?.[1];
  if (value === undefined) return '';
  if (type === 'b') return value.trim() === '1' ? 'TRUE' : 'FALSE';
  if (type === 'str' || type === 'e') return decodeEntities(value);
  return value.trim();
}

export function sheetToText(xml: string, shared: string[]): string {
  const rows: string[] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
    const cells: string[] = [];
    for (const cellMatch of (rowMatch[1] ?? '').matchAll(
      /<c\b([^>]*)>([\s\S]*?)<\/c>/gi,
    )) {
      const attrs = attributes(cellMatch[1] ?? '');
      const value = cellText(attrs, cellMatch[2] ?? '', shared);
      cells.push(value.replace(/\s+/g, ' ').trim());
    }
    const line = cells
      .join(' | ')
      .replace(/(\s*\|\s*)+$/, '')
      .trim();
    if (line) rows.push(line);
  }
  return rows.join('\n');
}

export async function parseXlsx(ctx: ParseContext): Promise<ParsedDocument> {
  const limits = ingestionLimits();
  const archive: OpenedArchive = await openArchive(ctx.buffer, { limits });
  const budget = { remaining: limits.maxUncompressedBytes };

  const shared = parseSharedStrings(
    archive.zip.files['xl/sharedStrings.xml']
      ? await readEntryText(archive, 'xl/sharedStrings.xml', budget)
      : null,
  );
  const workbookXml = archive.zip.files['xl/workbook.xml']
    ? await readEntryText(archive, 'xl/workbook.xml', budget)
    : '';
  const relsXml = archive.zip.files['xl/_rels/workbook.xml.rels']
    ? await readEntryText(archive, 'xl/_rels/workbook.xml.rels', budget)
    : '';
  const sheets = parseWorkbook(workbookXml, relsXml);
  if (sheets.length === 0) throw new Error('XLSX contains no worksheets');

  const pages: Array<{ page: number; text: string }> = [];
  const chapters: Array<{ title: string; page: number }> = [];
  for (const sheet of sheets) {
    if (!archive.zip.files[sheet.target]) continue;
    const xml = await readEntryText(archive, sheet.target, budget);
    const body = sheetToText(xml, shared);
    if (!body.trim()) continue;
    const page = pages.length + 1;
    pages.push({ page, text: `## Sheet: ${sheet.name}\n\n${body}` });
    chapters.push({ title: sheet.name, page });
  }

  assertHasText(pages, 'XLSX');
  return {
    pages,
    title: ctx.fileName,
    metadata: buildMetadata(pages, {
      format: 'xlsx',
      kind: 'sheet',
      chapters,
      pageCount: pages.length,
    }),
  };
}
