import { describe, expect, it } from 'vitest';

import {
  heuristicMinedTerms,
  parseMinedVocabulary,
} from './vocabulary.service.js';

describe('parseMinedVocabulary', () => {
  it('parses a plain JSON array', () => {
    const terms = parseMinedVocabulary(
      JSON.stringify([
        {
          term: 'retrieval',
          translation: 'recuperación',
          partOfSpeech: 'noun',
          example: 'Hybrid retrieval.',
        },
      ]),
      10,
    );
    expect(terms).toHaveLength(1);
    expect(terms[0]?.translation).toBe('recuperación');
  });

  it('tolerates code fences and surrounding prose', () => {
    const raw =
      'Here you go:\n```json\n[{"term":"fuse","translation":"fusionar"}]\n```';
    const terms = parseMinedVocabulary(raw, 10);
    expect(terms[0]?.term).toBe('fuse');
    expect(terms[0]?.partOfSpeech).toBeNull();
  });

  it('deduplicates case-insensitively and respects max', () => {
    const raw = JSON.stringify([
      { term: 'Cat' },
      { term: 'cat' },
      { term: 'dog' },
      { term: 'bird' },
    ]);
    expect(parseMinedVocabulary(raw, 2)).toHaveLength(2);
  });

  it('drops malformed entries and unparseable output', () => {
    expect(parseMinedVocabulary('no json here', 5)).toEqual([]);
    expect(parseMinedVocabulary('[{"term":""},{"term":"ok"}]', 5)).toHaveLength(
      1,
    );
  });
});

describe('heuristicMinedTerms', () => {
  it('skips stop words and short words', () => {
    const terms = heuristicMinedTerms(
      'The cat is very small but the enormous elephant arrived.',
      10,
    );
    const words = terms.map((term) => term.term);
    expect(words).toContain('enormous');
    expect(words).toContain('elephant');
    expect(words).not.toContain('the');
    expect(words).not.toContain('cat');
  });

  it('attaches an example sentence and never invents a translation', () => {
    const [term] = heuristicMinedTerms(
      'Photosynthesis converts light into energy.',
      1,
    );
    expect(term?.translation).toBeNull();
    expect(term?.example).toContain('Photosynthesis');
  });

  it('respects the maximum', () => {
    const text = 'Alpha bravo charlie delta echo foxtrot golf hotel india.';
    expect(heuristicMinedTerms(text, 3)).toHaveLength(3);
  });
});
