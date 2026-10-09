import { createEmptyCard, fsrs, Rating, State } from 'ts-fsrs';
import type { Card, Grade } from 'ts-fsrs';

import type { ReviewRating } from '@nexus/shared-types';

/**
 * Serializable FSRS scheduling state, matching the flashcards columns. The
 * scheduler itself is stateless (ts-fsrs), so everything needed to schedule
 * the next review lives on the card row.
 */
export interface FlashcardSchedule {
  dueAt: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  /** FSRS learning-step counter (without it cards never graduate). */
  learningSteps: number;
  reps: number;
  lapses: number;
  state: number;
  lastReviewAt: Date | null;
}

const scheduler = fsrs();

export const RATING_MAP: Record<ReviewRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

/** A brand-new card, due immediately. */
export function emptySchedule(now: Date = new Date()): FlashcardSchedule {
  return fromCard(createEmptyCard(now), null);
}

/** Apply one rating and return the next scheduling state. */
export function scheduleReview(
  current: FlashcardSchedule,
  rating: ReviewRating,
  now: Date = new Date(),
): FlashcardSchedule {
  const result = scheduler.repeat(toCard(current), now);
  return fromCard(result[RATING_MAP[rating]].card, now);
}

/** Human-readable interval preview for each rating button. */
export function previewIntervals(
  current: FlashcardSchedule,
  now: Date = new Date(),
): Record<ReviewRating, string> {
  const result = scheduler.repeat(toCard(current), now);
  return {
    again: formatInterval(result[Rating.Again].card.due, now),
    hard: formatInterval(result[Rating.Hard].card.due, now),
    good: formatInterval(result[Rating.Good].card.due, now),
    easy: formatInterval(result[Rating.Easy].card.due, now),
  };
}

/** Lower bound of "today" in UTC, used by progress aggregation. */
export function startOfUtcDay(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/**
 * Consecutive review days ending today or yesterday. `days` are UTC dates in
 * descending order (as returned by a DISTINCT query).
 */
export function computeStreak(days: string[], now: Date = new Date()): number {
  const unique = [...new Set(days)].sort().reverse();
  if (unique.length === 0) return 0;

  const today = startOfUtcDay(now).toISOString().slice(0, 10);
  const yesterday = new Date(startOfUtcDay(now).getTime() - 86_400_000)
    .toISOString()
    .slice(0, 10);
  if (unique[0] !== today && unique[0] !== yesterday) return 0;

  let streak = 1;
  for (let i = 1; i < unique.length; i += 1) {
    const previous = new Date(`${unique[i - 1]}T00:00:00Z`).getTime();
    const current = new Date(`${unique[i]}T00:00:00Z`).getTime();
    if (previous - current !== 86_400_000) break;
    streak += 1;
  }
  return streak;
}

// ---------------------------------------------------------------------------
// Internal conversions
// ---------------------------------------------------------------------------

function toCard(schedule: FlashcardSchedule): Card {
  return {
    due: schedule.dueAt,
    stability: schedule.stability,
    difficulty: schedule.difficulty,
    elapsed_days: schedule.elapsedDays,
    scheduled_days: schedule.scheduledDays,
    learning_steps: schedule.learningSteps,
    reps: schedule.reps,
    lapses: schedule.lapses,
    state: schedule.state as State,
    last_review: schedule.lastReviewAt ?? undefined,
  } as Card;
}

function fromCard(card: Card, lastReviewAt: Date | null): FlashcardSchedule {
  return {
    dueAt: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps ?? 0,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReviewAt,
  };
}

function formatInterval(due: Date, now: Date): string {
  const minutes = Math.max(
    1,
    Math.round((due.getTime() - now.getTime()) / 60_000),
  );
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.round(days / 30);
  return months < 12 ? `${months}mo` : `${Math.round(months / 12)}y`;
}
