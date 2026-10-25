import { and, asc, eq, getTableColumns, lte, sql } from 'drizzle-orm';

import type { DueCard, FlashcardDTO, ReviewRating } from '@nexus/shared-types';

import { db } from '../db/index.js';
import {
  cardReviews,
  decks,
  flashcards,
  progressEvents,
  workspaces,
} from '../db/schema.js';
import { ApiError } from '../utils/errors.js';
import {
  previewIntervals,
  scheduleReview,
  type FlashcardSchedule,
} from './fsrs.service.js';

const RATING_VALUE: Record<ReviewRating, number> = {
  again: 1,
  hard: 2,
  good: 3,
  easy: 4,
};

type CardRow = typeof flashcards.$inferSelect;

function scheduleFromRow(row: CardRow): FlashcardSchedule {
  return {
    dueAt: row.dueAt,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsedDays: row.elapsedDays,
    scheduledDays: row.scheduledDays,
    learningSteps: row.learningSteps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    lastReviewAt: row.lastReviewAt,
  };
}

export function toCardDTO(row: CardRow): FlashcardDTO {
  return {
    id: row.id,
    deckId: row.deckId,
    kind: row.kind === 'cloze' ? 'cloze' : 'qa',
    front: row.front,
    back: row.back,
    dueAt: new Date(row.dueAt).toISOString(),
    state: row.state,
    reps: row.reps,
    lapses: row.lapses,
    suspended: row.suspended,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

/**
 * Due cards with the four FSRS interval previews, scoped to a workspace the
 * caller owns. Shared by the study UI and `GET /api/v1/reviews/due`.
 */
export async function listDueCards(params: {
  userId: string;
  workspaceId: string;
  deckId?: string;
  limit: number;
}): Promise<DueCard[]> {
  const [workspace] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(
      and(
        eq(workspaces.id, params.workspaceId),
        eq(workspaces.userId, params.userId),
      ),
    )
    .limit(1);
  if (!workspace) throw new ApiError('Workspace not found', 404);

  const conditions = [
    eq(decks.workspaceId, params.workspaceId),
    eq(flashcards.suspended, false),
    lte(flashcards.dueAt, new Date()),
  ];
  if (params.deckId) conditions.push(eq(flashcards.deckId, params.deckId));

  const rows = await db
    .select({ ...getTableColumns(flashcards), deckName: decks.name })
    .from(flashcards)
    .innerJoin(decks, eq(decks.id, flashcards.deckId))
    .where(and(...conditions))
    .orderBy(asc(flashcards.dueAt), asc(flashcards.createdAt))
    .limit(params.limit);

  return rows.map((row) => ({
    ...toCardDTO(row),
    deckName: row.deckName,
    intervals: previewIntervals(scheduleFromRow(row)),
  }));
}

/**
 * Submit one rating: reschedule the card with FSRS, record the review and a
 * progress event, and report how many cards are still due. Shared by the study
 * UI and `POST /api/v1/reviews`.
 */
export async function submitCardReview(params: {
  userId: string;
  cardId: string;
  rating: ReviewRating;
  durationMs?: number;
}): Promise<{ nextDueAt: string; remaining: number }> {
  const [row] = await db
    .select({
      ...getTableColumns(flashcards),
      workspaceId: decks.workspaceId,
    })
    .from(flashcards)
    .innerJoin(decks, eq(decks.id, flashcards.deckId))
    .innerJoin(workspaces, eq(workspaces.id, decks.workspaceId))
    .where(
      and(
        eq(flashcards.id, params.cardId),
        eq(workspaces.userId, params.userId),
      ),
    )
    .limit(1);
  if (!row) throw new ApiError('Card not found', 404);

  const next = scheduleReview(scheduleFromRow(row), params.rating, new Date());
  await db
    .update(flashcards)
    .set({
      dueAt: next.dueAt,
      stability: next.stability,
      difficulty: next.difficulty,
      elapsedDays: next.elapsedDays,
      scheduledDays: next.scheduledDays,
      learningSteps: next.learningSteps,
      reps: next.reps,
      lapses: next.lapses,
      state: next.state,
      lastReviewAt: next.lastReviewAt,
    })
    .where(eq(flashcards.id, row.id));

  await db.insert(cardReviews).values({
    cardId: row.id,
    rating: RATING_VALUE[params.rating],
    durationMs: params.durationMs ?? null,
  });
  await db.insert(progressEvents).values({
    userId: params.userId,
    workspaceId: row.workspaceId,
    kind: 'review',
    subject: row.deckId,
    correct: params.rating !== 'again',
    durationMs: params.durationMs ?? null,
  });

  const remainingResult = await db.execute(
    sql`
      SELECT COUNT(*)::int AS remaining
      FROM flashcards c
      JOIN decks d ON d.id = c.deck_id
      WHERE d.workspace_id = ${row.workspaceId}
        AND NOT c.suspended
        AND c.due_at <= now()
    `,
  );
  const remaining = (
    remainingResult as unknown as { rows: Array<{ remaining: number }> }
  ).rows[0];

  return {
    nextDueAt: next.dueAt.toISOString(),
    remaining: Number(remaining?.remaining ?? 0),
  };
}
