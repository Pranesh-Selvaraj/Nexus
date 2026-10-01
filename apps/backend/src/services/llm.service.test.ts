import { describe, expect, it, vi } from 'vitest';

import { buildMessages, generateConversationTitle } from './llm.service.js';
import type { SourceHit } from './llm.service.js';

const completionsCreate = vi.hoisted(() => vi.fn());

vi.mock('openai', () => ({
  default: vi.fn(function () {
    return { chat: { completions: { create: completionsCreate } } };
  }),
}));
vi.mock('./settings.service.js', () => ({
  getSetting: vi.fn(async () => 'gpt-4o-mini'),
  getSettingNumber: vi.fn(async () => 0.2),
}));

const source = (overrides: Partial<SourceHit> = {}): SourceHit => ({
  id: '11111111-1111-4111-8111-111111111111',
  documentId: '22222222-2222-4222-8222-222222222222',
  title: 'about-nexus.txt',
  content: 'Nexus is a retrieval-augmented generation system.',
  page: 1,
  pageEnd: 1,
  headingPath: [],
  similarity: 0.87,
  vectorScore: 0.87,
  keywordScore: 0,
  fusedScore: 1,
  tokenCount: 12,
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
    expect(String(last.content)).toContain(
      '<source id="1" title="about-nexus.txt" page="1">',
    );
    expect(String(last.content)).toContain(
      'Nexus is a retrieval-augmented generation system.',
    );
  });

  it('omits page suffix when page is null and includes the heading trail', () => {
    const messages = buildMessages({
      query: 'q',
      history: [],
      sources: [
        source({
          page: null,
          pageEnd: null,
          headingPath: ['Chapter 3', '3.2'],
        }),
      ],
    });
    const last = String(messages[messages.length - 1]?.content);
    expect(last).toContain('<source id="1" title="about-nexus.txt"');
    expect(last).not.toContain('page=');
    expect(last).toContain('section="Chapter 3 &gt; 3.2"');
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
    expect(last).toContain('<source id="1" title="one.txt"');
    expect(last).toContain('<source id="2" title="two.txt"');
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

describe('generateConversationTitle', () => {
  it('uses the LLM output as the title, stripping quotes', async () => {
    completionsCreate.mockResolvedValue({
      choices: [{ message: { content: '"Quarterly planning notes"' } }],
    });

    const title = await generateConversationTitle('What are our Q3 goals?');
    expect(title).toBe('Quarterly planning notes');

    const createArgs = completionsCreate.mock.calls[0]?.[0] as {
      model: string;
      messages: { content: string }[];
    };
    expect(createArgs.model).toBe('gpt-4o-mini');
    expect(createArgs.messages[0]?.content).toContain('What are our Q3 goals?');
  });

  it('throws when the LLM returns no content', async () => {
    completionsCreate.mockResolvedValue({
      choices: [{ message: { content: '' } }],
    });

    await expect(generateConversationTitle('hi')).rejects.toThrow(
      'empty conversation title',
    );
  });

  it('sends the conversation id as a stable session header', async () => {
    completionsCreate.mockClear();
    completionsCreate.mockResolvedValue({
      choices: [{ message: { content: 'Title' } }],
    });

    await generateConversationTitle('hello there', 'conv-123');

    const options = completionsCreate.mock.calls[0]?.[1] as {
      headers: Record<string, string>;
    };
    expect(options.headers['x-opencode-session']).toBe('conv-123');
  });
});
