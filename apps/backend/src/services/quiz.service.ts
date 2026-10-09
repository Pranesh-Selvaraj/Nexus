import type { QuizKind } from '@nexus/shared-types';

import { assertChatConfigured } from './embedding.service.js';
import { getOpenAIClient, sessionHeaders } from './openai-client.js';
import { getSetting } from './settings.service.js';

export interface GeneratedQuestion {
  kind: QuizKind;
  prompt: string;
  options: string[] | null;
  /** mcq: exact option text; truefalse: 'true'/'false'; short: expected answer. */
  answer: string;
  explanation: string | null;
}

export interface ShortAnswerGrade {
  correct: boolean;
  feedback: string | null;
}

const QUIZ_SYSTEM_PROMPT = [
  'You write quiz questions from source material.',
  'Reply with ONLY a JSON array of objects. Each object has:',
  '"kind" ("mcq", "truefalse" or "short"), "prompt", "options" (mcq only, 3-5 strings),',
  '"answer" (mcq: the exact correct option text; truefalse: true or false; short: the expected answer),',
  'and "explanation" (one sentence).',
  'No markdown fences, no commentary.',
].join(' ');

/** Tolerant parsing of a model-produced quiz array (unit tested). */
export function parseGeneratedQuestions(
  raw: string,
  max: number,
  kinds: QuizKind[],
): GeneratedQuestion[] {
  const cleaned = raw
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end <= start) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: GeneratedQuestion[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const kind = String(record.kind ?? '').toLowerCase() as QuizKind;
    if (!kinds.includes(kind)) continue;
    const prompt =
      typeof record.prompt === 'string' ? record.prompt.trim() : '';
    if (!prompt) continue;
    const explanation =
      typeof record.explanation === 'string' && record.explanation.trim()
        ? record.explanation.trim().slice(0, 1000)
        : null;

    if (kind === 'mcq') {
      const options = Array.isArray(record.options)
        ? record.options
            .filter((option): option is string => typeof option === 'string')
            .map((option) => option.trim())
            .filter(Boolean)
        : [];
      if (options.length < 2) continue;
      let answer: string | null = null;
      if (typeof record.answer === 'number') {
        answer = options[record.answer - 1] ?? options[record.answer] ?? null;
      } else if (typeof record.answer === 'string') {
        const wanted = record.answer.trim().toLowerCase();
        answer =
          options.find((option) => option.toLowerCase() === wanted) ?? null;
      }
      if (!answer) continue;
      out.push({ kind, prompt, options, answer, explanation });
    } else if (kind === 'truefalse') {
      let answer: string | null = null;
      if (typeof record.answer === 'boolean') {
        answer = record.answer ? 'true' : 'false';
      } else if (
        typeof record.answer === 'string' &&
        /^(true|false)$/i.test(record.answer.trim())
      ) {
        answer = record.answer.trim().toLowerCase();
      }
      if (!answer) continue;
      out.push({
        kind,
        prompt,
        options: ['True', 'False'],
        answer,
        explanation,
      });
    } else {
      const answer =
        typeof record.answer === 'string' ? record.answer.trim() : '';
      if (!answer) continue;
      out.push({ kind, prompt, options: null, answer, explanation });
    }
    if (out.length >= max) break;
  }
  return out;
}

export async function generateQuizFromText(
  text: string,
  count: number,
  kinds: QuizKind[],
  sessionId?: string,
): Promise<GeneratedQuestion[]> {
  await assertChatConfigured();
  const client = await getOpenAIClient('chat');
  const model = await getSetting('openai.model');

  const completion = await client.chat.completions.create(
    {
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: QUIZ_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Create up to ${count} quiz questions of these kinds: ${kinds.join(', ')} from this material:\n\n${text.slice(0, 12000)}`,
        },
      ],
    },
    sessionId ? sessionHeaders(sessionId) : undefined,
  );

  return parseGeneratedQuestions(
    completion.choices[0]?.message?.content ?? '',
    count,
    kinds,
  );
}

/** Fallback grading when the model is unavailable or unparseable. */
export function heuristicShortGrade(
  expected: string,
  answer: string,
): ShortAnswerGrade {
  const normalize = (value: string): string =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const wanted = normalize(expected);
  const given = normalize(answer);
  if (!given) return { correct: false, feedback: null };
  if (given === wanted || given.includes(wanted) || wanted.includes(given)) {
    return { correct: true, feedback: null };
  }
  const keywords = wanted.split(' ').filter((word) => word.length > 3);
  if (keywords.length === 0) return { correct: false, feedback: null };
  const hits = keywords.filter((word) => given.includes(word)).length;
  return { correct: hits / keywords.length >= 0.6, feedback: null };
}

/**
 * Grade short answers by meaning with one model call. Missing or malformed
 * grades fall back to keyword overlap so a provider hiccup never blocks the
 * attempt.
 */
export async function gradeShortAnswers(
  items: { prompt: string; expected: string; answer: string }[],
  sessionId?: string,
): Promise<ShortAnswerGrade[]> {
  const fallback = items.map((item) =>
    heuristicShortGrade(item.expected, item.answer),
  );
  if (items.length === 0) return [];

  try {
    await assertChatConfigured();
    const client = await getOpenAIClient('chat');
    const model = await getSetting('openai.model');
    const listing = items
      .map(
        (item, index) =>
          `[${index + 1}] Question: ${item.prompt}\nExpected: ${item.expected}\nLearner answer: ${item.answer}`,
      )
      .join('\n\n');

    const completion = await client.chat.completions.create(
      {
        model,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              'You grade quiz short answers. Reply with ONLY a JSON array of objects {"correct": boolean, "feedback": "one short sentence"}. Grade by meaning, not exact wording.',
          },
          { role: 'user', content: `Grade these short answers:\n\n${listing}` },
        ],
      },
      sessionId ? sessionHeaders(sessionId) : undefined,
    );

    const raw = completion.choices[0]?.message?.content ?? '';
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start === -1 || end <= start) return fallback;
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(parsed)) return fallback;

    return items.map((_, index) => {
      const entry = parsed[index];
      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>;
        if (typeof record.correct === 'boolean') {
          return {
            correct: record.correct,
            feedback:
              typeof record.feedback === 'string'
                ? record.feedback.slice(0, 500)
                : null,
          };
        }
      }
      return fallback[index] ?? { correct: false, feedback: null };
    });
  } catch {
    return fallback;
  }
}
