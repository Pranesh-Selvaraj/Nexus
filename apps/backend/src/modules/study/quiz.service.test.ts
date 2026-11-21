import { describe, expect, it } from 'vitest';

import {
  heuristicShortGrade,
  parseGeneratedQuestions,
} from './quiz.service.js';

describe('parseGeneratedQuestions', () => {
  it('parses an mcq question and resolves the answer by option text', () => {
    const raw = JSON.stringify([
      {
        kind: 'mcq',
        prompt: 'What does Nexus combine?',
        options: ['Vectors and keywords', 'Only keywords'],
        answer: 'Vectors and keywords',
        explanation: 'Hybrid retrieval fuses both arms.',
      },
    ]);
    const questions = parseGeneratedQuestions(raw, 5, ['mcq']);
    expect(questions).toHaveLength(1);
    expect(questions[0]?.answer).toBe('Vectors and keywords');
    expect(questions[0]?.options).toEqual([
      'Vectors and keywords',
      'Only keywords',
    ]);
  });

  it('accepts a 1-based index answer and strips code fences', () => {
    const raw =
      '```json\n[{"kind":"mcq","prompt":"Q","options":["a","b","c"],"answer":2}]\n```';
    const questions = parseGeneratedQuestions(raw, 5, ['mcq']);
    expect(questions[0]?.answer).toBe('b');
  });

  it('parses true/false from booleans and strings', () => {
    const raw = JSON.stringify([
      { kind: 'truefalse', prompt: 'A', answer: true },
      { kind: 'truefalse', prompt: 'B', answer: 'false', explanation: 'e' },
    ]);
    const questions = parseGeneratedQuestions(raw, 5, ['truefalse']);
    expect(questions.map((q) => q.answer)).toEqual(['true', 'false']);
    expect(questions[0]?.options).toEqual(['True', 'False']);
  });

  it('filters by requested kinds and drops malformed entries', () => {
    const raw = JSON.stringify([
      { kind: 'short', prompt: 'Short one', answer: 'Expected' },
      { kind: 'mcq', prompt: 'No options', options: [], answer: 'x' },
      { kind: 'essay', prompt: 'Wrong kind', answer: 'x' },
      { kind: 'short', prompt: '', answer: 'x' },
      { kind: 'truefalse', prompt: 'TF', answer: 'maybe' },
    ]);
    const questions = parseGeneratedQuestions(raw, 5, ['short', 'truefalse']);
    expect(questions).toHaveLength(1);
    expect(questions[0]?.prompt).toBe('Short one');
  });

  it('honors the max count', () => {
    const raw = JSON.stringify(
      Array.from({ length: 5 }, (_, i) => ({
        kind: 'short',
        prompt: `Q${i}`,
        answer: `A${i}`,
      })),
    );
    expect(parseGeneratedQuestions(raw, 2, ['short'])).toHaveLength(2);
  });

  it('returns nothing for unparseable output', () => {
    expect(parseGeneratedQuestions('no json here', 5, ['mcq'])).toEqual([]);
    expect(parseGeneratedQuestions('[oops]', 5, ['mcq'])).toEqual([]);
  });
});

describe('heuristicShortGrade', () => {
  it('accepts exact and contained answers', () => {
    expect(
      heuristicShortGrade('vector similarity', 'vector similarity').correct,
    ).toBe(true);
    expect(
      heuristicShortGrade(
        'vector similarity',
        'it uses vector similarity and keywords',
      ).correct,
    ).toBe(true);
  });

  it('accepts keyword-overlap answers above the threshold', () => {
    expect(
      heuristicShortGrade(
        'Reciprocal rank fusion combines both arms',
        'reciprocal rank fusion fuses both arms',
      ).correct,
    ).toBe(true);
  });

  it('rejects empty or unrelated answers', () => {
    expect(heuristicShortGrade('expected answer', '').correct).toBe(false);
    expect(
      heuristicShortGrade('expected answer', 'completely different').correct,
    ).toBe(false);
  });
});
