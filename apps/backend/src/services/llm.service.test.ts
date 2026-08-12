import { describe, expect, it } from 'vitest';

import { buildMessages } from './llm.service';
import type { SourceHit } from './llm.service';

const source = (overrides: Partial<SourceHit> = {}): SourceHit => ({
  id: '11111111-1111-4111-8111-111111111111',
  documentId: '22222222-2222-4222-8222-222222222222',
  title: 'about-nexus.txt',
  content: 'Nexus is a retrieval-augmented generation system.',
  page: 1,
  similarity: 0.87,
  ...overrides,
});

describe('buildMessages', () => {
  it('includes a system prompt, history, and the grounded question', () => {
    const messages = buildMessages({
      query: 'What is Nexus?',
      history: [{ role: 'user', content: 'hi' }],
      sources: [source()],
    });

    expect(messages[0]?.role).toBe('system');
    expect(messages[1]).toEqual({ role: 'user', content: 'hi' });
    const last = messages[messages.length - 1]!;
    expect(last.role).toBe('user');
    expect(String(last.content)).toContain('What is Nexus?');
    expect(String(last.content)).toContain('[1] ("about-nexus.txt", page 1)');
    expect(String(last.content)).toContain(
      'Nexus is a retrieval-augmented generation system.',
    );
  });

  it('omits page suffix when page is null', () => {
    const messages = buildMessages({
      query: 'q',
      history: [],
      sources: [source({ page: null })],
    });
    const last = String(messages[messages.length - 1]?.content);
    expect(last).toContain('[1] ("about-nexus.txt")');
    expect(last).not.toContain('page');
  });

  it('numbers sources in order', () => {
    const messages = buildMessages({
      query: 'q',
      history: [],
      sources: [
        source({ id: 'a', title: 'one.txt' }),
        source({ id: 'b', title: 'two.txt' }),
      ],
    });
    const last = String(messages[messages.length - 1]?.content);
    expect(last).toContain('[1] ("one.txt"');
    expect(last).toContain('[2] ("two.txt"');
  });

  it('truncates history to the last 10 messages', () => {
    const history = Array.from({ length: 15 }, (_, i) => ({
      role: 'user' as const,
      content: `msg ${i}`,
    }));
    const messages = buildMessages({ query: 'q', history, sources: [] });

    const historyMessages = messages.filter((m) => m.role !== 'system');
    // 10 truncated history entries + the final grounded question
    expect(historyMessages).toHaveLength(11);
    const historyOnly = historyMessages.slice(0, -1);
    expect(historyOnly).toHaveLength(10);
    // last history item survives
    expect(String(historyOnly[9]?.content)).toBe('msg 14');
  });

  it('works with no sources', () => {
    const messages = buildMessages({
      query: 'q',
      history: [],
      sources: [],
    });
    expect(messages).toHaveLength(2);
    expect(String(messages[1]?.content)).toContain('Question: q');
  });
});
