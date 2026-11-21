import { describe, expect, it } from 'vitest';

import { formatRelative, pct, toLocalMessage } from './utils';

describe('formatRelative', () => {
  it('labels recent timestamps in minutes and hours', () => {
    const now = Date.now();
    expect(formatRelative(new Date(now - 30_000).toISOString())).toBe(
      'just now',
    );
    expect(formatRelative(new Date(now - 5 * 60_000).toISOString())).toBe(
      '5m ago',
    );
    expect(formatRelative(new Date(now - 3 * 3_600_000).toISOString())).toBe(
      '3h ago',
    );
  });
});

describe('pct', () => {
  it('rounds and handles missing values', () => {
    expect(pct(0.756)).toBe('76%');
    expect(pct(undefined)).toBe('—');
  });
});

describe('toLocalMessage', () => {
  it('maps DTO fields onto the local message shape', () => {
    const message = toLocalMessage({
      id: '11111111-1111-4111-8111-111111111111',
      role: 'assistant',
      content: 'hi',
      kind: 'answer',
      createdAt: new Date().toISOString(),
      sources: [{ id: 'x' }],
      retrievalDebug: { candidates: [] },
      feedback: null,
    } as never);

    expect(message.id).toContain('1111');
    expect(message.error).toBe(false);
    expect(message.retrieval).toEqual({ candidates: [] });
  });
});
