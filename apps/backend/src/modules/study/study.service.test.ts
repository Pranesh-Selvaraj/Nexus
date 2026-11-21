import { describe, expect, it } from 'vitest';

import { parseGeneratedCards } from './study.service.js';

describe('parseGeneratedCards', () => {
  it('parses a plain JSON array', () => {
    const cards = parseGeneratedCards(
      '[{"front":"Q1","back":"A1"},{"front":"Q2","back":"A2"}]',
      5,
    );
    expect(cards).toEqual([
      { front: 'Q1', back: 'A1' },
      { front: 'Q2', back: 'A2' },
    ]);
  });

  it('strips markdown fences and surrounding prose', () => {
    const raw =
      'Here are the cards:\n```json\n[{"front":"Q","back":"A"}]\n```\nDone.';
    expect(parseGeneratedCards(raw, 5)).toEqual([{ front: 'Q', back: 'A' }]);
  });

  it('drops malformed entries and clamps to the requested count', () => {
    const raw = JSON.stringify([
      { front: 'Q1', back: 'A1' },
      { front: '', back: 'A2' },
      { front: 'Q3', back: 'A3' },
      { front: 'Q4', back: 'A4' },
    ]);
    expect(parseGeneratedCards(raw, 2)).toEqual([
      { front: 'Q1', back: 'A1' },
      { front: 'Q3', back: 'A3' },
    ]);
  });

  it('returns an empty list for unparseable output', () => {
    expect(parseGeneratedCards('I cannot help with that.', 5)).toEqual([]);
    expect(parseGeneratedCards('[not json]', 5)).toEqual([]);
    expect(parseGeneratedCards('{"front":"Q"}', 5)).toEqual([]);
  });
});
