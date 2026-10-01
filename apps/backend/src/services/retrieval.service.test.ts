import { describe, expect, it } from 'vitest';

import type { RawCandidate } from './retrieval.service.js';
import {
  applyDiversity,
  applyMinScore,
  fuseRrf,
  resolveProfileConfig,
  trimToBudget,
  validateCitations,
} from './retrieval.service.js';

function candidate(
  id: string,
  overrides: Partial<RawCandidate> = {},
): RawCandidate {
  return {
    id,
    documentId: 'doc-1',
    title: 'notes.txt',
    content: `content ${id}`,
    contentHash: `hash-${id}`,
    page: 1,
    pageEnd: 1,
    headingPath: [],
    tokenCount: 10,
    vectorScore: 0.5,
    keywordScore: 0,
    fusedScore: 0,
    ...overrides,
  };
}

describe('resolveProfileConfig', () => {
  const base = {
    profile: 'balanced',
    queryRewrite: true,
    rerank: false,
    minScore: 0.1,
    tokenBudget: 6000,
    topK: 6,
    vectorWeight: 0.6,
    keywordWeight: 0.4,
  };

  it('fast disables query rewriting', () => {
    expect(
      resolveProfileConfig({ ...base, profile: 'fast' }).queryRewrite,
    ).toBe(false);
  });

  it('thorough always reranks', () => {
    expect(
      resolveProfileConfig({ ...base, profile: 'thorough', rerank: false })
        .rerank,
    ).toBe(true);
  });

  it('balanced honors the individual toggles', () => {
    const resolved = resolveProfileConfig({ ...base, profile: 'balanced' });
    expect(resolved.queryRewrite).toBe(true);
    expect(resolved.rerank).toBe(false);
  });

  it('falls back to balanced for unknown profiles', () => {
    expect(resolveProfileConfig({ ...base, profile: 'nope' }).profile).toBe(
      'balanced',
    );
  });
});

describe('fuseRrf', () => {
  it('retrieves a semantic-only match even when keyword hits exist (B-2)', () => {
    const semanticOnly = candidate('semantic', { vectorScore: 0.9 });
    const keywordOnly = candidate('keyword', {
      vectorScore: 0.2,
      keywordScore: 1,
    });

    const fused = fuseRrf(
      [semanticOnly, candidate('other', { vectorScore: 0.4 })],
      [keywordOnly],
      0.6,
      0.4,
    );

    const ids = fused.map((hit) => hit.id);
    expect(ids).toContain('semantic');
    expect(ids).toContain('keyword');
    // The best vector hit still wins the fused ordering.
    expect(fused[0]?.id).toBe('semantic');
  });

  it('adds both rank contributions for a chunk in both arms', () => {
    const shared = candidate('shared');
    const fused = fuseRrf(
      [shared],
      [candidate('shared', { keywordScore: 1 })],
      0.5,
      0.5,
    );
    expect(fused).toHaveLength(1);
    expect(fused[0]?.fusedScore).toBe(1);
  });

  it('normalizes scores to 0..1', () => {
    const fused = fuseRrf(
      [candidate('a'), candidate('b')],
      [candidate('c', { keywordScore: 0.5 })],
      0.6,
      0.4,
    );
    for (const hit of fused) {
      expect(hit.fusedScore).toBeGreaterThanOrEqual(0);
      expect(hit.fusedScore).toBeLessThanOrEqual(1);
    }
  });
});

describe('applyMinScore', () => {
  it('keeps keyword-only matches regardless of vector score', () => {
    const kept = applyMinScore(
      [
        candidate('weak', { vectorScore: 0.05 }),
        candidate('keyword', { vectorScore: 0, keywordScore: 0.8 }),
        candidate('strong', { vectorScore: 0.9 }),
      ],
      0.5,
    );
    expect(kept.map((hit) => hit.id)).toEqual(['keyword', 'strong']);
  });

  it('is a no-op when disabled', () => {
    const hits = [candidate('a', { vectorScore: 0 })];
    expect(applyMinScore(hits, 0)).toHaveLength(1);
  });
});

describe('applyDiversity', () => {
  it('caps chunks per document but fills topK on a second pass', () => {
    const hits = [
      candidate('a1'),
      candidate('a2'),
      candidate('a3'),
      candidate('a4'),
      candidate('b1', { documentId: 'doc-2' }),
    ];
    const selected = applyDiversity(hits, 4, 2);
    expect(selected).toHaveLength(4);
    expect(selected.filter((hit) => hit.documentId === 'doc-1')).toHaveLength(
      3,
    );
  });

  it('drops duplicate content hashes', () => {
    const hits = [
      candidate('a', { contentHash: 'same' }),
      candidate('b', { contentHash: 'same' }),
      candidate('c', { contentHash: 'other' }),
    ];
    expect(applyDiversity(hits, 3).map((hit) => hit.id)).toEqual(['a', 'c']);
  });
});

describe('trimToBudget', () => {
  it('always keeps the best hit and stops when the budget is spent', () => {
    const hits = [
      candidate('a', { tokenCount: 100 }),
      candidate('b', { tokenCount: 100 }),
      candidate('c', { tokenCount: 100 }),
    ];
    const { hits: kept, usedTokens } = trimToBudget(hits, 150);
    expect(kept.map((hit) => hit.id)).toEqual(['a']);
    expect(usedTokens).toBe(100);
  });

  it('keeps multiple hits that fit', () => {
    const { hits: kept } = trimToBudget(
      [candidate('a'), candidate('b'), candidate('c')],
      25,
    );
    expect(kept).toHaveLength(2);
  });
});

describe('validateCitations', () => {
  it('keeps only in-range unique citations, sorted', () => {
    expect(validateCitations('See [2] and [1], not [9] or [2].', 3)).toEqual([
      1, 2,
    ]);
  });

  it('returns nothing when there are no citations', () => {
    expect(validateCitations('No citations here.', 3)).toEqual([]);
  });
});
