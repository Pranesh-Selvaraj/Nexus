import { RATING_BUTTONS } from './constants';
import { useEffect, useState } from 'react';
import type { DueCard, ReviewRating } from '@nexus/shared-types';
import { useToast } from '../../components/Toast';
import {
  cacheDueCards,
  cachedDueCards,
  isNetworkError,
  queueReview,
} from '../../lib/offline';
import { trpc } from '../../lib/trpc';

export function ReviewSession({
  workspaceId,
  deckId,
  online,
  onDone,
}: {
  workspaceId: string;
  deckId: string | null;
  online: boolean;
  onDone: () => void;
}) {
  const utils = trpc.useUtils();
  const toast = useToast();
  const dueQuery = trpc.study.cards.due.useQuery(
    {
      workspaceId,
      deckId: deckId ?? undefined,
      limit: 30,
    },
    {
      // Open the session from the last cached list when the network is gone
      // (or the cache is the only thing available on a cold offline start).
      initialData: () =>
        deckId ? undefined : (cachedDueCards(workspaceId) ?? undefined),
    },
  );
  const [queue, setQueue] = useState<DueCard[] | null>(null);
  const [seeded, setSeeded] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);

  // Render-phase adjustment (React's documented pattern): seed the session
  // queue once the due query resolves. Subsequent refetches must not clobber
  // the in-progress session.
  if (!seeded && dueQuery.data) {
    setSeeded(true);
    setQueue(dueQuery.data);
  }

  useEffect(() => {
    if (dueQuery.data) cacheDueCards(workspaceId, dueQuery.data);
  }, [dueQuery.data, workspaceId]);

  const review = trpc.study.cards.review.useMutation({
    onSuccess: () => {
      setReviewedCount((count) => count + 1);
      setRevealed(false);
      setQueue((current) => (current ?? []).slice(1));
      void utils.study.progress.invalidate({ workspaceId });
      void utils.study.decks.list.invalidate({ workspaceId });
    },
    onError: (err, variables) => {
      // Offline (or the connection dropped): keep the rating and advance, then
      // sync it when the browser reports it is online again.
      if (isNetworkError(err)) {
        queueReview(workspaceId, variables.cardId, variables.rating);
        setReviewedCount((count) => count + 1);
        setRevealed(false);
        setQueue((current) => (current ?? []).slice(1));
        toast.push({
          kind: 'info',
          message: 'Saved offline — this review syncs when you reconnect.',
        });
        return;
      }
      toast.push({ kind: 'error', message: `Review failed: ${err.message}` });
    },
  });

  const current = queue?.[0];

  /**
   * Submit one rating. When the browser already knows it is offline the queue
   * is written directly: waiting for a fetch that will not resolve would leave
   * the session stuck on a disabled card.
   */
  function submitRating(rating: ReviewRating) {
    if (!current) return;
    if (!navigator.onLine) {
      queueReview(workspaceId, current.id, rating);
      setReviewedCount((count) => count + 1);
      setRevealed(false);
      setQueue((items) => (items ?? []).slice(1));
      toast.push({
        kind: 'info',
        message: 'Saved offline — this review syncs when you reconnect.',
      });
      return;
    }
    review.mutate({ cardId: current.id, rating });
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!current) return;
      if (event.code === 'Space' && !revealed) {
        event.preventDefault();
        setRevealed(true);
        return;
      }
      if (revealed) {
        const index = ['1', '2', '3', '4'].indexOf(event.key);
        if (index >= 0) {
          event.preventDefault();
          const rating = RATING_BUTTONS[index]?.rating;
          if (rating) submitRating(rating);
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, revealed, review]);

  if (!current) {
    return (
      <div className="mt-10 text-center">
        <p className="text-sm text-zinc-400">
          {reviewedCount > 0
            ? `Session complete — ${reviewedCount} card${reviewedCount === 1 ? '' : 's'} reviewed.`
            : 'No cards are due right now.'}
        </p>
        <button
          onClick={onDone}
          className="mt-4 rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <p className="text-xs text-zinc-500">
        {current.deckName} · card {reviewedCount + 1} ·{' '}
        {(queue?.length ?? 1) - 1} more due
        {!online && ' · offline'}
      </p>

      <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 text-center">
        <p className="text-lg text-zinc-100">{current.front}</p>
        {revealed && (
          <p className="mt-5 border-t border-zinc-800 pt-5 text-sm text-zinc-300">
            {current.back}
          </p>
        )}
      </div>

      {revealed ? (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {RATING_BUTTONS.map((button, index) => (
            <button
              key={button.rating}
              onClick={() => submitRating(button.rating)}
              disabled={review.isPending}
              className={`rounded-xl px-3 py-3 text-sm font-medium transition-colors disabled:opacity-50 ${button.className}`}
            >
              {button.label}
              <span className="mt-0.5 block text-[10px] opacity-70">
                {index + 1} · {current.intervals[button.rating]}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <button
          onClick={() => setRevealed(true)}
          className="mt-4 w-full rounded-xl bg-nexus-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-nexus-500"
        >
          Show answer <span className="opacity-70">(space)</span>
        </button>
      )}
    </div>
  );
}
