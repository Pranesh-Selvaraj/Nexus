import { describe, expect, it } from 'vitest';

import {
  levelForSkill,
  levelFromRank,
  levelFromScore,
  levelRank,
} from './language.service.js';

describe('levelFromScore', () => {
  it('maps thresholds to CEFR bands', () => {
    expect(levelFromScore(0.98)).toBe('C2');
    expect(levelFromScore(0.9)).toBe('C1');
    expect(levelFromScore(0.8)).toBe('B2');
    expect(levelFromScore(0.7)).toBe('B1');
    expect(levelFromScore(0.55)).toBe('A2');
    expect(levelFromScore(0.2)).toBe('A1');
  });
});

describe('levelForSkill', () => {
  it('keeps the seeded level below the evidence floor', () => {
    expect(levelForSkill(0.99, 0, 'B1')).toBe('B1');
    expect(levelForSkill(0.99, 2, 'B1')).toBe('B1');
  });

  it('measures once enough evidence exists', () => {
    expect(levelForSkill(0.99, 5, 'B1')).toBe('C2');
    expect(levelForSkill(0.2, 5, 'B1')).toBe('A1');
  });
});

describe('levelRank / levelFromRank', () => {
  it('round-trips ranks', () => {
    for (const level of ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const) {
      expect(levelFromRank(levelRank(level))).toBe(level);
    }
  });

  it('clamps out-of-range ranks', () => {
    expect(levelFromRank(-3)).toBe('A1');
    expect(levelFromRank(99)).toBe('C2');
  });
});
