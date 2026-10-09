import { describe, expect, it } from 'vitest';

import {
  computeStreak,
  emptySchedule,
  previewIntervals,
  scheduleReview,
} from './fsrs.service.js';

const NOW = new Date('2026-10-01T12:00:00Z');

describe('emptySchedule', () => {
  it('creates a new card due immediately', () => {
    const schedule = emptySchedule(NOW);
    expect(schedule.dueAt.getTime()).toBe(NOW.getTime());
    expect(schedule.reps).toBe(0);
    expect(schedule.state).toBe(0);
    expect(schedule.lastReviewAt).toBeNull();
  });
});

describe('scheduleReview', () => {
  it('increments reps and records the review time', () => {
    const next = scheduleReview(emptySchedule(NOW), 'good', NOW);
    expect(next.reps).toBe(1);
    expect(next.lastReviewAt?.getTime()).toBe(NOW.getTime());
    expect(next.dueAt.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('schedules Easy further out than Good, and Good further than Again', () => {
    const base = emptySchedule(NOW);
    const again = scheduleReview(base, 'again', NOW);
    const good = scheduleReview(base, 'good', NOW);
    const easy = scheduleReview(base, 'easy', NOW);

    expect(easy.dueAt.getTime()).toBeGreaterThan(good.dueAt.getTime());
    expect(good.dueAt.getTime()).toBeGreaterThan(again.dueAt.getTime());
  });

  it('graduates a card to the review state after two successful learning steps', () => {
    let schedule = emptySchedule(NOW);
    schedule = scheduleReview(schedule, 'good', NOW);
    expect(schedule.state).toBe(1);
    schedule = scheduleReview(
      schedule,
      'good',
      new Date(NOW.getTime() + 3 * 86_400_000),
    );
    // Regression guard: without persisting FSRS `learning_steps` the card
    // stayed in Learning forever and never reached Review.
    expect(schedule.state).toBe(2);
  });

  it('counts a lapse when a learned card is rated Again', () => {
    let schedule = emptySchedule(NOW);
    schedule = scheduleReview(schedule, 'good', NOW);
    schedule = scheduleReview(
      schedule,
      'good',
      new Date(NOW.getTime() + 3 * 86_400_000),
    );
    schedule = scheduleReview(
      schedule,
      'good',
      new Date(NOW.getTime() + 10 * 86_400_000),
    );
    const lapsed = scheduleReview(
      schedule,
      'again',
      new Date(NOW.getTime() + 24 * 86_400_000),
    );
    expect(lapsed.lapses).toBe(1);
  });

  it('grows stability on successful reviews', () => {
    let schedule = emptySchedule(NOW);
    schedule = scheduleReview(schedule, 'good', NOW);
    const firstStability = schedule.stability;
    schedule = scheduleReview(
      schedule,
      'good',
      new Date(NOW.getTime() + 2 * 86_400_000),
    );
    expect(schedule.stability).toBeGreaterThan(firstStability);
  });

  it('previews a distinct interval per rating', () => {
    const preview = previewIntervals(emptySchedule(NOW), NOW);
    expect(Object.keys(preview).sort()).toEqual([
      'again',
      'easy',
      'good',
      'hard',
    ]);
    for (const value of Object.values(preview)) {
      expect(value).toMatch(/^\d+(m|h|d|mo|y)$/);
    }
  });
});

describe('computeStreak', () => {
  it('is zero without reviews', () => {
    expect(computeStreak([], NOW)).toBe(0);
  });

  it('counts consecutive days ending today', () => {
    expect(computeStreak(['2026-10-01', '2026-09-30', '2026-09-29'], NOW)).toBe(
      3,
    );
  });

  it('counts a streak ending yesterday as still alive', () => {
    expect(computeStreak(['2026-09-30', '2026-09-29'], NOW)).toBe(2);
  });

  it('stops at a gap and ignores older runs', () => {
    expect(
      computeStreak(
        ['2026-10-01', '2026-09-29', '2026-09-28', '2026-09-27'],
        NOW,
      ),
    ).toBe(1);
  });
});
