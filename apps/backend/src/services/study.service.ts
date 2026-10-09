import { assertChatConfigured } from './embedding.service.js';
import { getOpenAIClient, sessionHeaders } from './openai-client.js';
import { getSetting } from './settings.service.js';

export interface GeneratedCard {
  front: string;
  back: string;
}

const CARD_SYSTEM_PROMPT = [
  'You write concise study flashcards from source material.',
  'Reply with ONLY a JSON array of objects, each with a "front" (a short question) and a "back" (a concise, self-contained answer).',
  'No markdown fences, no commentary.',
].join(' ');

/**
 * Tolerantly extract flashcards from a model response: strips code fences,
 * finds the JSON array, and drops malformed entries. Pure so it can be
 * unit-tested without a provider.
 */
export function parseGeneratedCards(raw: string, max: number): GeneratedCard[] {
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

  const cards: GeneratedCard[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const front = typeof record.front === 'string' ? record.front.trim() : '';
    const back = typeof record.back === 'string' ? record.back.trim() : '';
    if (front.length === 0 || back.length === 0) continue;
    cards.push({ front: front.slice(0, 2000), back: back.slice(0, 4000) });
    if (cards.length >= max) break;
  }
  return cards;
}

/**
 * Ask the chat model for up to `count` flashcards from arbitrary text.
 * Returns an empty array when the model produces nothing parseable; callers
 * surface that as a friendly error.
 */
export async function generateCardsFromText(
  text: string,
  count: number,
  sessionId?: string,
): Promise<GeneratedCard[]> {
  await assertChatConfigured();
  const client = await getOpenAIClient('chat');
  const model = await getSetting('openai.model');

  const completion = await client.chat.completions.create(
    {
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: CARD_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Create up to ${count} flashcards from this material:\n\n${text.slice(0, 12000)}`,
        },
      ],
    },
    sessionId ? sessionHeaders(sessionId) : undefined,
  );

  return parseGeneratedCards(
    completion.choices[0]?.message?.content ?? '',
    count,
  );
}
