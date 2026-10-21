import type {
  MineVocabularyInput,
  MineVocabularyResult,
  VocabularyItemDTO,
  VocabularyState,
} from '@nexus/shared-types';
import { and, desc, eq, ilike, or } from 'drizzle-orm';

import { db } from '../db/index.js';
import { flashcards, vocabularyItems } from '../db/schema.js';
import { getOrCreateDefaultDeck } from './deck.service.js';
import { assertChatConfigured } from './embedding.service.js';
import { emptySchedule } from './fsrs.service.js';
import { getOpenAIClient } from './openai-client.js';
import { getSetting } from './settings.service.js';
import { normalizeWord, splitSentences, tokenizeWords } from './text-utils.js';

export interface MinedTerm {
  term: string;
  translation: string | null;
  partOfSpeech: string | null;
  example: string | null;
}

function cleanTerm(value: unknown): MinedTerm | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const term = typeof record.term === 'string' ? record.term.trim() : '';
  if (!term || term.length > 80) return null;
  return {
    term,
    translation:
      typeof record.translation === 'string' && record.translation.trim()
        ? record.translation.trim().slice(0, 400)
        : null,
    partOfSpeech:
      typeof record.partOfSpeech === 'string' && record.partOfSpeech.trim()
        ? record.partOfSpeech.trim().slice(0, 40)
        : null,
    example:
      typeof record.example === 'string' && record.example.trim()
        ? record.example.trim().slice(0, 400)
        : null,
  };
}

/**
 * Parse the model's mined-term JSON. Tolerant by design (mirrors
 * parseGeneratedCards): the model may wrap JSON in prose or code fences.
 */
export function parseMinedVocabulary(raw: string, max: number): MinedTerm[] {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed: unknown = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    const terms: MinedTerm[] = [];
    const seen = new Set<string>();
    for (const entry of parsed) {
      const term = cleanTerm(entry);
      if (!term) continue;
      const key = normalizeWord(term.term);
      if (seen.has(key)) continue;
      seen.add(key);
      terms.push(term);
      if (terms.length >= max) break;
    }
    return terms;
  } catch {
    return [];
  }
}

/** Stop words for the heuristic fallback (kept small and multilingual-lite). */
const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'are',
  'but',
  'not',
  'you',
  'all',
  'any',
  'can',
  'had',
  'her',
  'was',
  'one',
  'our',
  'out',
  'his',
  'has',
  'him',
  'she',
  'its',
  'who',
  'did',
  'yes',
  'this',
  'that',
  'with',
  'have',
  'from',
  'they',
  'will',
  'would',
  'there',
  'their',
  'what',
  'about',
  'which',
  'when',
  'make',
  'like',
  'time',
  'just',
  'know',
  'take',
  'into',
  'your',
  'some',
  'them',
  'than',
  'then',
  'only',
  'come',
  'also',
  'back',
  'after',
  'use',
  'two',
  'how',
  'our',
  'work',
  'first',
  'well',
  'way',
  'even',
  'new',
  'want',
  'because',
  'these',
  'give',
  'most',
  'been',
  'more',
  'other',
  'were',
  'here',
  'does',
  'being',
  'very',
  'should',
  'could',
]);

/**
 * Offline fallback: pick the longest, least-common words in the passage. No
 * translation is invented — a blank translation is honest and the learner can
 * fill it in, whereas a hallucinated one would be worse than useless.
 */
export function heuristicMinedTerms(text: string, max: number): MinedTerm[] {
  const sentences = splitSentences(text);
  const counts = new Map<
    string,
    { display: string; count: number; sentence: string }
  >();
  for (const word of tokenizeWords(text)) {
    const key = normalizeWord(word);
    if (key.length < 4 || STOP_WORDS.has(key)) continue;
    const display = word.toLowerCase();
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      const sentence =
        sentences.find((candidate) =>
          candidate.toLowerCase().includes(display),
        ) ?? null;
      counts.set(key, { display, count: 1, sentence: sentence ?? '' });
    }
  }
  return [...counts.values()]
    .sort((a, b) => a.count - b.count || b.display.length - a.display.length)
    .slice(0, max)
    .map((entry) => ({
      term: entry.display,
      translation: null,
      partOfSpeech: null,
      example: entry.sentence || null,
    }));
}

/**
 * Ask the chat model to mine vocabulary with translations and examples. The
 * deterministic stub matches on "Mine vocabulary".
 */
export async function mineVocabularyViaLLM(
  text: string,
  language: string,
  nativeLanguage: string,
  max: number,
  sessionId?: string,
): Promise<MinedTerm[]> {
  await assertChatConfigured();
  const client = await getOpenAIClient('chat');
  const model = await getSetting('openai.model');
  const prompt = [
    'Mine vocabulary from the passage below for a language learner.',
    `Target language: ${language || 'the passage language'}. Explain in ${nativeLanguage}.`,
    `Pick the ${max} most useful words or short phrases. Skip proper nouns and trivial function words.`,
    'Return ONLY a JSON array. Each item: {"term": string, "translation": string, "partOfSpeech": string, "example": string}',
    'The example must be the sentence from the passage that contains the term.',
    '',
    'Passage:',
    text.slice(0, 6000),
  ].join('\n');

  const completion = await client.chat.completions.create(
    {
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    },
    sessionId ? { headers: { 'x-opencode-session': sessionId } } : undefined,
  );
  const raw = completion.choices[0]?.message?.content ?? '';
  return parseMinedVocabulary(raw, max);
}

export function toVocabularyDTO(
  row: typeof vocabularyItems.$inferSelect,
): VocabularyItemDTO {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    term: row.term,
    lemma: row.lemma,
    language: row.language,
    translation: row.translation,
    partOfSpeech: row.partOfSpeech,
    example: row.example,
    frequencyRank: row.frequencyRank,
    state: (row.state as VocabularyState) ?? 'learning',
    cardId: row.cardId,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

/**
 * Mine terms from a passage and persist them, creating an SRS card per new
 * term (front: the term; back: its translation and the example sentence).
 */
export async function mineAndStore(
  input: MineVocabularyInput,
  sessionId?: string,
): Promise<MineVocabularyResult> {
  const [targetSetting, nativeSetting] = await Promise.all([
    getSetting('language.target'),
    getSetting('language.native'),
  ]);
  const language =
    input.language ?? input.targetLanguage ?? targetSetting ?? '';
  const native = nativeSetting || 'English';

  let terms: MinedTerm[];
  try {
    terms = await mineVocabularyViaLLM(
      input.text,
      language,
      native,
      input.maxTerms,
      sessionId,
    );
  } catch {
    terms = [];
  }
  if (terms.length === 0) {
    terms = heuristicMinedTerms(input.text, input.maxTerms);
  }

  let deckId: string | null = null;
  let cardsCreated = 0;
  const items: VocabularyItemDTO[] = [];

  for (const term of terms) {
    const lemma = normalizeWord(term.term);
    if (!lemma) continue;
    const [existing] = await db
      .select()
      .from(vocabularyItems)
      .where(
        and(
          eq(vocabularyItems.workspaceId, input.workspaceId),
          eq(vocabularyItems.lemma, lemma),
          eq(vocabularyItems.language, language),
        ),
      )
      .limit(1);
    if (existing) {
      items.push(toVocabularyDTO(existing));
      continue;
    }

    let cardId: string | null = null;
    let created: typeof vocabularyItems.$inferSelect | undefined;
    try {
      // The vocabulary row is inserted first (with a conflict-safe upsert), so
      // a concurrent mine of the same term never creates an orphan card: the
      // card is only inserted after the term row wins.
      created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(vocabularyItems)
          .values({
            workspaceId: input.workspaceId,
            term: term.term,
            lemma,
            language,
            translation: term.translation,
            partOfSpeech: term.partOfSpeech,
            example: term.example,
            state: 'learning',
            cardId: null,
            sourceChunkId: input.sourceChunkId ?? null,
            sourceMessageId: input.sourceMessageId ?? null,
          })
          .onConflictDoNothing({
            target: [
              vocabularyItems.workspaceId,
              vocabularyItems.lemma,
              vocabularyItems.language,
            ],
          })
          .returning();
        if (!row) return undefined;

        if (!input.createCards) return row;
        if (!deckId) {
          deckId = await getOrCreateDefaultDeck(input.workspaceId);
        }
        const back = [
          term.translation,
          term.example ? `_${term.example}_` : null,
        ]
          .filter(Boolean)
          .join('\n\n');
        const [card] = await tx
          .insert(flashcards)
          .values({
            deckId,
            kind: 'qa',
            front: term.term,
            back: back || `(${native} translation pending)`,
            sourceChunkId: input.sourceChunkId ?? null,
            sourceMessageId: input.sourceMessageId ?? null,
            ...emptySchedule(),
          })
          .returning({ id: flashcards.id });
        if (!card) return row;
        cardId = card.id;
        const [updated] = await tx
          .update(vocabularyItems)
          .set({ cardId: card.id })
          .where(eq(vocabularyItems.id, row.id))
          .returning();
        return updated ?? row;
      });
    } catch {
      created = undefined;
    }

    if (!created) {
      // A concurrent miner (or a retry) already stored this term.
      const [existing] = await db
        .select()
        .from(vocabularyItems)
        .where(
          and(
            eq(vocabularyItems.workspaceId, input.workspaceId),
            eq(vocabularyItems.lemma, lemma),
            eq(vocabularyItems.language, language),
          ),
        )
        .limit(1);
      if (existing) items.push(toVocabularyDTO(existing));
      continue;
    }

    if (cardId) cardsCreated += 1;
    items.push(toVocabularyDTO(created));
  }

  return { items, cardsCreated, deckId };
}

export async function listVocabulary(
  workspaceId: string,
  options: { state?: VocabularyState; query?: string } = {},
): Promise<VocabularyItemDTO[]> {
  const filters = [eq(vocabularyItems.workspaceId, workspaceId)];
  if (options.state) {
    filters.push(eq(vocabularyItems.state, options.state));
  }
  if (options.query?.trim()) {
    const pattern = `%${options.query.trim()}%`;
    const search = or(
      ilike(vocabularyItems.term, pattern),
      ilike(vocabularyItems.translation, pattern),
    );
    if (search) filters.push(search);
  }
  const rows = await db
    .select()
    .from(vocabularyItems)
    .where(and(...filters))
    .orderBy(desc(vocabularyItems.createdAt))
    .limit(500);
  return rows.map(toVocabularyDTO);
}

export async function updateVocabulary(
  vocabularyId: string,
  patch: { state?: VocabularyState; translation?: string },
): Promise<VocabularyItemDTO> {
  const [row] = await db
    .select()
    .from(vocabularyItems)
    .where(eq(vocabularyItems.id, vocabularyId))
    .limit(1);
  if (!row) throw new Error('Vocabulary item not found');

  const [updated] = await db
    .update(vocabularyItems)
    .set({
      state: patch.state ?? row.state,
      translation:
        patch.translation !== undefined ? patch.translation : row.translation,
    })
    .where(eq(vocabularyItems.id, vocabularyId))
    .returning();
  if (!updated) throw new Error('Failed to update vocabulary item');
  // Ownership is enforced by the router before this runs; the update itself is
  // scoped by the (already-authorised) item id.
  return toVocabularyDTO(updated);
}

export async function deleteVocabulary(vocabularyId: string): Promise<boolean> {
  const [row] = await db
    .select()
    .from(vocabularyItems)
    .where(eq(vocabularyItems.id, vocabularyId))
    .limit(1);
  if (!row) return false;
  // Removing a mined term removes the SRS card it created, so the deck does
  // not accumulate cards whose term was deleted.
  await db.transaction(async (tx) => {
    if (row.cardId) {
      await tx.delete(flashcards).where(eq(flashcards.id, row.cardId));
    }
    await tx
      .delete(vocabularyItems)
      .where(eq(vocabularyItems.id, vocabularyId));
  });
  return true;
}
