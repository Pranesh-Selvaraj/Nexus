import { describe, expect, it } from 'vitest';

import {
  alignPronunciation,
  dictationAccuracy,
  dictationDiff,
  levenshtein,
  normalizeWord,
  splitSentences,
  tokenizeWords,
  wordSimilarity,
} from './text-utils.js';

describe('splitSentences', () => {
  it('splits on terminal punctuation', () => {
    expect(splitSentences('One. Two! Three?')).toEqual([
      'One.',
      'Two!',
      'Three?',
    ]);
  });

  it('keeps a single sentence intact', () => {
    expect(splitSentences('Hello world')).toEqual(['Hello world']);
  });

  it('chunks very long sentences on word boundaries', () => {
    const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
    const sentences = splitSentences(long, 60);
    expect(sentences.length).toBeGreaterThan(1);
    for (const sentence of sentences) {
      expect(sentence.length).toBeLessThanOrEqual(60);
    }
    expect(sentences.join(' ')).toBe(long);
  });

  it('returns nothing for blank input', () => {
    expect(splitSentences('   ')).toEqual([]);
  });
});

describe('tokenizeWords', () => {
  it('strips punctuation and keeps unicode letters', () => {
    expect(tokenizeWords("Café, s'il vous plaît!")).toEqual([
      'Café',
      "s'il",
      'vous',
      'plaît',
    ]);
  });
});

describe('wordSimilarity', () => {
  it('is 1 for identical words regardless of case/accents', () => {
    expect(wordSimilarity('Résumé', 'resume')).toBe(1);
  });

  it('is lower for more distant words', () => {
    expect(wordSimilarity('ship', 'sheep')).toBeGreaterThan(
      wordSimilarity('ship', 'banana'),
    );
  });

  it('handles empty strings', () => {
    expect(wordSimilarity('', 'x')).toBe(0);
  });
});

describe('levenshtein', () => {
  it('computes edit distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('same', 'same')).toBe(0);
  });
});

describe('alignPronunciation', () => {
  it('scores an exact repetition as good', () => {
    const words = alignPronunciation(
      'the quick brown fox',
      'the quick brown fox',
    );
    expect(words).toHaveLength(4);
    expect(words.every((word) => word.status === 'good')).toBe(true);
  });

  it('marks omitted words as missing', () => {
    const words = alignPronunciation('the quick brown fox', 'the fox');
    const missing = words.filter((word) => word.status === 'missing');
    expect(missing.length).toBeGreaterThan(0);
    expect(words.find((word) => word.word === 'fox')?.heard).toBe('fox');
  });

  it('returns missing for every word when nothing was heard', () => {
    const words = alignPronunciation('hello world', '');
    expect(words.map((word) => word.status)).toEqual(['missing', 'missing']);
  });

  it('flags a near-miss as close/off rather than good', () => {
    const words = alignPronunciation('sheep', 'ship');
    expect(words[0]?.status).not.toBe('good');
    expect(words[0]?.score).toBeLessThan(1);
  });
});

describe('dictationDiff', () => {
  it('marks a perfect transcription as correct', () => {
    const diff = dictationDiff('The cat sat.', 'the cat sat');
    expect(diff.every((word) => word.status === 'correct')).toBe(true);
    expect(dictationAccuracy(diff)).toEqual({
      accuracy: 1,
      correct: 3,
      total: 3,
    });
  });

  it('reports missing and extra words', () => {
    const diff = dictationDiff('the cat sat', 'the cat sat on');
    expect(diff.find((word) => word.word === 'on')?.status).toBe('extra');
    const missing = dictationDiff('the cat sat', 'the cat');
    expect(missing.find((word) => word.word === 'sat')?.status).toBe('missing');
  });

  it('reports a substituted word as wrong', () => {
    const diff = dictationDiff('the cat sat', 'the bat sat');
    expect(diff.find((word) => word.word === 'cat')?.status).toBe('wrong');
    expect(diff.filter((word) => word.status === 'extra')).toHaveLength(0);
  });

  it('computes accuracy over expected words only', () => {
    const diff = dictationDiff('one two three', 'one three');
    expect(dictationAccuracy(diff)).toEqual({
      accuracy: 2 / 3,
      correct: 2,
      total: 3,
    });
  });
});

describe('normalizeWord', () => {
  it('lowercases and strips diacritics', () => {
    expect(normalizeWord('Résumé')).toBe('resume');
  });
});
