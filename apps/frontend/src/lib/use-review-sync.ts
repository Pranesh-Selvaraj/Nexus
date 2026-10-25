import { useEffect, useRef, useState } from 'react';

import { onQueueChange, pendingReviews, removeQueuedReview } from './offline';
import { trpc } from './trpc';

/**
 * Flush ratings taken offline once the browser is online again, and expose the
 * pending count for the offline banner. Runs from the Study panel so a queued
 * review is synced even if the user closed the review screen.
 */
export function useReviewSync(workspaceId: string): {
  online: boolean;
  pending: number;
} {
  const utils = trpc.useUtils();
  const [online, setOnline] = useState(
    () => typeof navigator === 'undefined' || navigator.onLine,
  );
  const [pending, setPending] = useState(
    () => pendingReviews(workspaceId).length,
  );
  const review = trpc.study.cards.review.useMutation();
  const mutateAsync = review.mutateAsync;
  const mutateRef = useRef(mutateAsync);
  const syncing = useRef(false);

  useEffect(() => {
    mutateRef.current = mutateAsync;
  }, [mutateAsync]);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    const refresh = () => setPending(pendingReviews(workspaceId).length);
    const off = onQueueChange(refresh);
    refresh();
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      off();
    };
  }, [workspaceId]);

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    void (async () => {
      const queued = pendingReviews(workspaceId);
      if (queued.length > 0 && !syncing.current) {
        syncing.current = true;
        try {
          for (const item of queued) {
            await mutateRef.current({
              cardId: item.cardId,
              rating: item.rating,
            });
            removeQueuedReview(item.id);
          }
        } catch {
          // Still unreachable or the server rejected it: keep the rest for the
          // next online event instead of dropping the user's practice.
        } finally {
          syncing.current = false;
        }
      }
      if (cancelled) return;
      setPending(pendingReviews(workspaceId).length);
      void utils.study.cards.due.invalidate({ workspaceId });
      void utils.study.progress.invalidate({ workspaceId });
      void utils.study.decks.list.invalidate({ workspaceId });
    })();
    return () => {
      cancelled = true;
    };
  }, [online, workspaceId, utils]);

  return { online, pending };
}
