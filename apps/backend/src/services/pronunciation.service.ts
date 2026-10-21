import type { MinimalPair, PronunciationScore } from '@nexus/shared-types';
import { desc, eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import { progressEvents, pronunciationAttempts } from '../db/schema.js';
import { alignPronunciation } from './text-utils.js';

export interface ScorePronunciationInput {
  userId: string;
  workspaceId: string;
  target: string;
  transcript: string;
  language?: string;
  durationMs?: number;
}

function toDTO(
  row: typeof pronunciationAttempts.$inferSelect,
): PronunciationScore {
  return {
    id: row.id,
    target: row.target,
    transcript: row.transcript,
    overall: row.overall,
    words: row.words ?? [],
    language: row.language,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

/**
 * Score a spoken attempt against a target sentence. Deliberately transparent
 * and local: per-word alignment with character-level similarity, presented as
 * feedback rather than a grade (pronunciation scoring quality depends on the
 * provider, which self-hosted setups may not have).
 */
export async function scorePronunciation(
  input: ScorePronunciationInput,
): Promise<PronunciationScore> {
  const words = alignPronunciation(input.target, input.transcript);
  const overall =
    words.length === 0
      ? 0
      : words.reduce((sum, word) => sum + word.score, 0) / words.length;

  const [row] = await db
    .insert(pronunciationAttempts)
    .values({
      userId: input.userId,
      workspaceId: input.workspaceId,
      target: input.target,
      transcript: input.transcript,
      overall,
      words,
      language: input.language ?? null,
    })
    .returning();
  if (!row) throw new Error('Failed to store pronunciation attempt');

  await db.insert(progressEvents).values({
    userId: input.userId,
    workspaceId: input.workspaceId,
    kind: 'pronunciation',
    subject: input.language ?? words[0]?.word ?? null,
    correct: overall >= 0.7,
    durationMs: input.durationMs ?? null,
  });

  return toDTO(row);
}

/** Recent attempts for a workspace (newest first). */
export async function listPronunciationAttempts(
  workspaceId: string,
  limit = 20,
): Promise<PronunciationScore[]> {
  const rows = await db
    .select()
    .from(pronunciationAttempts)
    .where(eq(pronunciationAttempts.workspaceId, workspaceId))
    .orderBy(desc(pronunciationAttempts.createdAt))
    .limit(limit);
  return rows.map(toDTO);
}

/**
 * Minimal pairs for high-value English contrasts. Kept static and small: they
 * are practice prompts, not a phonology engine.
 */
export const MINIMAL_PAIRS: MinimalPair[] = [
  { a: 'ship', b: 'sheep', hint: '/ɪ/ vs /iː/' },
  { a: 'bit', b: 'beat', hint: '/ɪ/ vs /iː/' },
  { a: 'bad', b: 'bed', hint: '/æ/ vs /e/' },
  { a: 'cat', b: 'cut', hint: '/æ/ vs /ʌ/' },
  { a: 'thin', b: 'sin', hint: '/θ/ vs /s/' },
  { a: 'think', b: 'sink', hint: '/θ/ vs /s/' },
  { a: 'light', b: 'right', hint: '/l/ vs /r/' },
  { a: 'west', b: 'vest', hint: '/w/ vs /v/' },
  { a: 'three', b: 'tree', hint: '/θr/ vs /tr/' },
  { a: 'live', b: 'leave', hint: '/ɪ/ vs /iː/' },
];
