import type { DueCard, ReviewRating } from '@nexus/shared-types';

/**
 * Offline review support (P-8). Two small pieces of local state:
 *
 * - the last due-card list per workspace, so the review screen can open with
 *   no network at all;
 * - a queue of ratings taken while offline, flushed to the API when the
 *   connection returns.
 *
 * Cards are identified by id and ratings are idempotent from the user's point
 * of view (FSRS applies them in order); the queue is stored in localStorage so
 * a reload does not lose practice done offline.
 */
const DUE_PREFIX = 'nexus.due.';
const QUEUE_KEY = 'nexus.reviewQueue.v1';
const QUEUE_EVENT = 'nexus:review-queue-changed';

export interface QueuedReview {
  id: string;
  workspaceId: string;
  cardId: string;
  rating: ReviewRating;
  queuedAt: string;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function cacheDueCards(workspaceId: string, cards: DueCard[]): void {
  storage()?.setItem(
    `${DUE_PREFIX}${workspaceId}`,
    JSON.stringify({ cards, at: new Date().toISOString() }),
  );
}

export function cachedDueCards(workspaceId: string): DueCard[] | null {
  const raw = storage()?.getItem(`${DUE_PREFIX}${workspaceId}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { cards?: DueCard[] };
    return Array.isArray(parsed.cards) && parsed.cards.length > 0
      ? parsed.cards
      : null;
  } catch {
    return null;
  }
}

function readQueue(): QueuedReview[] {
  const raw = storage()?.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as QueuedReview[];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedReview[]): void {
  storage()?.setItem(QUEUE_KEY, JSON.stringify(queue));
  window.dispatchEvent(new Event(QUEUE_EVENT));
}

export function queueReview(
  workspaceId: string,
  cardId: string,
  rating: ReviewRating,
): QueuedReview {
  const item: QueuedReview = {
    id: crypto.randomUUID(),
    workspaceId,
    cardId,
    rating,
    queuedAt: new Date().toISOString(),
  };
  // Keep one pending rating per card: re-rating offline replaces the earlier
  // one instead of applying two different grades in sequence.
  const queue = readQueue().filter((entry) => entry.cardId !== cardId);
  writeQueue([...queue, item]);
  return item;
}

export function pendingReviews(workspaceId?: string): QueuedReview[] {
  const queue = readQueue();
  return workspaceId
    ? queue.filter((entry) => entry.workspaceId === workspaceId)
    : queue;
}

export function removeQueuedReview(id: string): void {
  writeQueue(readQueue().filter((entry) => entry.id !== id));
}

export function onQueueChange(listener: () => void): () => void {
  window.addEventListener(QUEUE_EVENT, listener);
  return () => window.removeEventListener(QUEUE_EVENT, listener);
}

/** True for failures that mean "the network is gone", not "the server said no". */
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false)
    return true;
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /failed to fetch|networkerror|network error|load failed|offline|fetch failed/i.test(
    message,
  );
}
