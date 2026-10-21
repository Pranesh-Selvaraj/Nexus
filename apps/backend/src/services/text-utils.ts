// ---------------------------------------------------------------------------
// Pure text helpers shared by speech, pronunciation and dictation.
// ---------------------------------------------------------------------------

/** Split text into sentences while keeping terminal punctuation. */
export function splitSentences(text: string, maxLength = 320): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const sentences: string[] = [];
  for (const paragraph of normalized.split(/\n+/)) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    // Split after . ! ? followed by whitespace or end of string. The lookahead
    // keeps decimals ("3.14") and abbreviations ("e.g.") mostly intact.
    const parts = trimmed
      .split(/(?<=[.!?])\s+(?=[A-Z0-9"“'(])/)
      .map((part) => part.trim())
      .filter(Boolean);
    for (const part of parts) {
      if (part.length <= maxLength) {
        sentences.push(part);
        continue;
      }
      // Very long sentences (e.g. run-on transcripts) are chunked on word
      // boundaries so the karaoke highlight still progresses.
      let current = '';
      for (const word of part.split(/\s+/)) {
        if (current && current.length + word.length + 1 > maxLength) {
          sentences.push(current);
          current = word;
        } else {
          current = current ? `${current} ${word}` : word;
        }
      }
      if (current) sentences.push(current);
    }
  }
  return sentences;
}

/** Word tokens, unicode-aware, punctuation stripped. */
export function tokenizeWords(text: string): string[] {
  return (
    text.normalize('NFC').match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []
  );
}

/** Normalize a token for comparison (case + diacritics). */
export function normalizeWord(word: string): string {
  return word
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Levenshtein edit distance between two strings. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] as number) + 1,
        (previous[j] as number) + 1,
        (previous[j - 1] as number) + cost,
      );
    }
    previous = current;
  }
  return previous[b.length] as number;
}

/**
 * Character-level resemblance of two words, 0..1. Short words are held to a
 * stricter standard so "ship"/"sheep" is not scored as a near miss.
 */
export function wordSimilarity(a: string, b: string): number {
  const na = normalizeWord(a);
  const nb = normalizeWord(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const distance = levenshtein(na, nb);
  const score = 1 - distance / Math.max(na.length, nb.length);
  return Math.max(0, Math.min(1, score));
}

export interface AlignedWord {
  word: string;
  heard: string | null;
  score: number;
  status: 'good' | 'close' | 'off' | 'missing';
}

function statusFor(score: number): AlignedWord['status'] {
  if (score >= 0.85) return 'good';
  if (score >= 0.6) return 'close';
  return 'off';
}

/**
 * Align the words the learner was supposed to say with the words the
 * recognizer heard, using a Needleman-Wunsch style alignment where the
 * substitution cost is the character-level word similarity. Returns one
 * entry per target word.
 */
export function alignPronunciation(
  target: string,
  heard: string,
): AlignedWord[] {
  const a = tokenizeWords(target);
  const b = tokenizeWords(heard);
  if (a.length === 0) return [];
  if (b.length === 0) {
    return a.map((word) => ({
      word,
      heard: null,
      score: 0,
      status: 'missing' as const,
    }));
  }

  const rows = a.length;
  const cols = b.length;
  // dp[i][j] = best alignment score for a[0..i) and b[0..j).
  const dp: number[][] = Array.from({ length: rows + 1 }, () =>
    new Array<number>(cols + 1).fill(0),
  );
  const get = (i: number, j: number): number =>
    (dp[i] as number[])[j] as number;
  const set = (i: number, j: number, value: number): void => {
    (dp[i] as number[])[j] = value;
  };
  const gap = -0.6;
  for (let i = 1; i <= rows; i++) set(i, 0, i * gap);
  for (let j = 1; j <= cols; j++) set(0, j, j * gap);
  for (let i = 1; i <= rows; i++) {
    for (let j = 1; j <= cols; j++) {
      const sim = wordSimilarity(a[i - 1] as string, b[j - 1] as string);
      const match = get(i - 1, j - 1) + (sim * 2 - 1);
      const skipA = get(i - 1, j) + gap;
      const skipB = get(i, j - 1) + gap;
      set(i, j, Math.max(match, skipA, skipB));
    }
  }

  const result: AlignedWord[] = [];
  let i = rows;
  let j = cols;
  while (i > 0) {
    const sim =
      j > 0 ? wordSimilarity(a[i - 1] as string, b[j - 1] as string) : -1;
    const match = j > 0 ? get(i - 1, j - 1) + (sim * 2 - 1) : -Infinity;
    const skipA = get(i - 1, j) + gap;
    if (j > 0 && get(i, j) === match) {
      result.push({
        word: a[i - 1] as string,
        heard: b[j - 1] as string,
        score: sim,
        status: statusFor(sim),
      });
      i -= 1;
      j -= 1;
    } else if (get(i, j) === skipA || j === 0) {
      result.push({
        word: a[i - 1] as string,
        heard: null,
        score: 0,
        status: 'missing',
      });
      i -= 1;
    } else {
      j -= 1;
    }
  }
  return result.reverse();
}

export interface DiffWord {
  word: string;
  status: 'correct' | 'wrong' | 'missing' | 'extra';
}

/**
 * Word-level diff for dictation: aligns the expected sentence with what the
 * learner typed and marks each expected word correct/wrong/missing, plus any
 * extra words the learner added.
 */
export function dictationDiff(target: string, typed: string): DiffWord[] {
  const a = tokenizeWords(target);
  const b = tokenizeWords(typed);
  // Edit-distance table: match costs 0, substitution/insert/delete cost 1.
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  const get = (i: number, j: number): number =>
    (dp[i] as number[])[j] as number;
  const set = (i: number, j: number, value: number): void => {
    (dp[i] as number[])[j] = value;
  };
  for (let i = 1; i <= a.length; i++) set(i, 0, i);
  for (let j = 1; j <= b.length; j++) set(0, j, j);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const equal =
        normalizeWord(a[i - 1] as string) === normalizeWord(b[j - 1] as string);
      set(
        i,
        j,
        equal
          ? get(i - 1, j - 1)
          : 1 + Math.min(get(i - 1, j - 1), get(i - 1, j), get(i, j - 1)),
      );
    }
  }

  const result: DiffWord[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (
      i > 0 &&
      j > 0 &&
      normalizeWord(a[i - 1] as string) === normalizeWord(b[j - 1] as string) &&
      get(i, j) === get(i - 1, j - 1)
    ) {
      result.push({ word: a[i - 1] as string, status: 'correct' });
      i -= 1;
      j -= 1;
      continue;
    }
    if (i > 0 && j > 0 && get(i, j) === get(i - 1, j - 1) + 1) {
      result.push({ word: a[i - 1] as string, status: 'wrong' });
      i -= 1;
      j -= 1;
      continue;
    }
    if (i > 0 && get(i, j) === get(i - 1, j) + 1) {
      result.push({ word: a[i - 1] as string, status: 'missing' });
      i -= 1;
      continue;
    }
    if (j > 0) {
      result.push({ word: b[j - 1] as string, status: 'extra' });
      j -= 1;
    }
  }
  return result.reverse();
}

/** Accuracy for a dictation attempt (correct / expected words). */
export function dictationAccuracy(diff: DiffWord[]): {
  accuracy: number;
  correct: number;
  total: number;
} {
  const total = diff.filter((word) => word.status !== 'extra').length;
  const correct = diff.filter((word) => word.status === 'correct').length;
  return {
    accuracy: total === 0 ? 0 : correct / total,
    correct,
    total,
  };
}
