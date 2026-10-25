/**
 * RTF parser.
 *
 * RTF is a text format wrapped in a control-word grammar: destinations such
 * as fonttbl/colortbl/pict must be dropped wholesale, `\'hh` escapes are in a
 * code page (CP1252 by default), and `\uN` carries UTF-16 code units. A naive
 * tag-strip leaves font names and binary blobs in the text, so this is a real
 * (small) tokenizer.
 */

/** CP1252 punctuation for the 0x80-0x9F range (others map to Latin-1). */
const CP1252: Record<number, string> = {
  0x80: '€',
  0x82: '‚',
  0x83: 'ƒ',
  0x84: '„',
  0x85: '…',
  0x86: '†',
  0x87: '‡',
  0x88: 'ˆ',
  0x89: '‰',
  0x8a: 'Š',
  0x8b: '‹',
  0x8c: 'Œ',
  0x8e: 'Ž',
  0x91: '‘',
  0x92: '’',
  0x93: '“',
  0x94: '”',
  0x95: '•',
  0x96: '–',
  0x97: '—',
  0x98: '˜',
  0x99: '™',
  0x9a: 'š',
  0x9b: '›',
  0x9c: 'œ',
  0x9e: 'ž',
  0x9f: 'Ÿ',
};

function cp1252Char(byte: number): string {
  return CP1252[byte] ?? String.fromCharCode(byte);
}

/** Destinations whose contents are never document text. */
const SKIP_DESTINATIONS = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'info',
  'pict',
  'object',
  'header',
  'headerl',
  'headerr',
  'headerf',
  'footer',
  'footerl',
  'footerr',
  'footerf',
  'footnote',
  'field',
  'fldinst',
  'listtable',
  'listoverridetable',
  'rsidtbl',
  'generator',
  'xmlnstbl',
  'themedata',
  'colorschememapping',
  'datastore',
  'latentstyles',
  'filetbl',
  'revtbl',
  'pnseclvl',
  'mmathPr',
  'wgrffmtfilter',
  'nonshppict',
]);

const SYMBOL_WORDS: Record<string, string> = {
  par: '\n',
  line: '\n',
  row: '\n',
  tab: '\t',
  cell: ' | ',
  emdash: '—',
  endash: '–',
  lquote: '‘',
  rquote: '’',
  ldblquote: '“',
  rdblquote: '”',
  bullet: '•',
  emspace: ' ',
  enspace: ' ',
};

/** Convert RTF source to plain text. */
export function rtfToText(rtf: string): string {
  let out = '';
  let skip = false;
  let ucSkip = 1;
  let pendingSkip = 0;
  const stack: Array<{ skip: boolean; ucSkip: number }> = [];

  const index = { i: 0 };
  const source = rtf;
  const length = source.length;

  while (index.i < length) {
    const char = source[index.i] as string;

    if (char === '{') {
      stack.push({ skip, ucSkip });
      index.i += 1;
      continue;
    }
    if (char === '}') {
      const state = stack.pop();
      if (state) {
        skip = state.skip;
        ucSkip = state.ucSkip;
      }
      index.i += 1;
      continue;
    }
    if (char === '\r' || char === '\n') {
      index.i += 1;
      continue;
    }
    if (char !== '\\') {
      index.i += 1;
      if (skip) continue;
      if (pendingSkip > 0) {
        pendingSkip -= 1;
        continue;
      }
      out += char;
      continue;
    }

    // Escape or control word.
    index.i += 1;
    const next = source[index.i];
    if (next === undefined) break;

    if (next === "'") {
      const hex = source.slice(index.i + 1, index.i + 3);
      index.i += 3;
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) continue;
      if (skip) continue;
      if (pendingSkip > 0) {
        pendingSkip -= 1;
        continue;
      }
      out += cp1252Char(Number.parseInt(hex, 16));
      continue;
    }
    if (!/[a-zA-Z]/.test(next)) {
      index.i += 1;
      if (skip) continue;
      if (next === '*') {
        // `\*` introduces an application-specific destination group.
        skip = true;
        continue;
      }
      if (next === '\\' || next === '{' || next === '}') out += next;
      continue;
    }

    // Control word: letters, optional signed number, optional space.
    let word = '';
    while (index.i < length && /[a-zA-Z]/.test(source[index.i] as string)) {
      word += source[index.i];
      index.i += 1;
    }
    let numeric = '';
    if (source[index.i] === '-') {
      numeric += '-';
      index.i += 1;
    }
    while (index.i < length && /[0-9]/.test(source[index.i] as string)) {
      numeric += source[index.i];
      index.i += 1;
    }
    if (source[index.i] === ' ') index.i += 1;

    if (SKIP_DESTINATIONS.has(word)) {
      skip = true;
      continue;
    }
    if (skip) continue;

    if (word === 'uc') {
      const value = Number.parseInt(numeric || '1', 10);
      ucSkip = Number.isFinite(value) && value >= 0 ? value : 1;
      continue;
    }
    if (word === 'u') {
      let code = Number.parseInt(numeric || '0', 10);
      if (code < 0) code += 65536;
      out += String.fromCharCode(code);
      pendingSkip = ucSkip;
      continue;
    }
    if (word in SYMBOL_WORDS) {
      out += SYMBOL_WORDS[word];
      continue;
    }
    // Unknown control word: no visible output.
  }

  return out
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
