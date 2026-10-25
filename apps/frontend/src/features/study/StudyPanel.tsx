import { lazy, Suspense, useEffect, useState } from 'react';

import type {
  ArtifactKind,
  DueCard,
  QuizKind,
  QuizResult,
  ReviewRating,
} from '@nexus/shared-types';

import { useToast } from '../../components/Toast';
import {
  cacheDueCards,
  cachedDueCards,
  isNetworkError,
  queueReview,
} from '../../lib/offline';
import { trpc } from '../../lib/trpc';
import { useReviewSync } from '../../lib/use-review-sync';

// KaTeX/highlight.js are heavy; load the renderer only when an artifact opens.
const Markdown = lazy(() =>
  import('../../components/Markdown').then((m) => ({ default: m.Markdown })),
);

interface Props {
  workspaceId: string;
}

type Tab = 'dashboard' | 'review' | 'decks' | 'quizzes' | 'artifacts' | 'notes';

const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'review', label: 'Review' },
  { id: 'decks', label: 'Decks' },
  { id: 'quizzes', label: 'Quizzes' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'notes', label: 'Notes' },
];

const RATING_BUTTONS: {
  rating: ReviewRating;
  label: string;
  className: string;
}[] = [
  {
    rating: 'again',
    label: 'Again',
    className: 'bg-red-950/60 text-red-300 hover:bg-red-900/60',
  },
  {
    rating: 'hard',
    label: 'Hard',
    className: 'bg-amber-950/60 text-amber-300 hover:bg-amber-900/60',
  },
  {
    rating: 'good',
    label: 'Good',
    className: 'bg-emerald-950/60 text-emerald-300 hover:bg-emerald-900/60',
  },
  {
    rating: 'easy',
    label: 'Easy',
    className: 'bg-sky-950/60 text-sky-300 hover:bg-sky-900/60',
  },
];

/** Study loop: dashboard, flashcard review (FSRS), decks and notes. */
export function StudyPanel({ workspaceId }: Props) {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [reviewDeckId, setReviewDeckId] = useState<string | null>(null);
  const [activeQuizId, setActiveQuizId] = useState<string | null>(null);
  const { online, pending } = useReviewSync(workspaceId);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {(!online || pending > 0) && (
        <div
          role="status"
          className="border-b border-amber-900/50 bg-amber-950/25 px-4 py-2 text-center text-[11px] text-amber-300"
        >
          {!online
            ? `Offline — reviews are saved on this device${pending > 0 ? ` (${pending} pending)` : ''} and sync when you reconnect.`
            : `Syncing ${pending} offline review${pending === 1 ? '' : 's'}…`}
        </div>
      )}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-zinc-800 px-3 py-2">
        {TABS.map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === item.id
                ? 'bg-nexus-600/20 text-nexus-200 ring-1 ring-nexus-600/40'
                : 'text-zinc-400 hover:bg-zinc-800'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-4 py-6 md:px-6">
          {tab === 'dashboard' && (
            <Dashboard
              workspaceId={workspaceId}
              onReview={() => {
                setReviewDeckId(null);
                setTab('review');
              }}
            />
          )}
          {tab === 'review' && (
            <ReviewSession
              workspaceId={workspaceId}
              deckId={reviewDeckId}
              online={online}
              onDone={() => setTab('dashboard')}
            />
          )}
          {tab === 'decks' && (
            <Decks
              workspaceId={workspaceId}
              onReview={(deckId) => {
                setReviewDeckId(deckId);
                setTab('review');
              }}
            />
          )}
          {tab === 'quizzes' &&
            (activeQuizId ? (
              <QuizRunner
                quizId={activeQuizId}
                onExit={() => setActiveQuizId(null)}
              />
            ) : (
              <Quizzes workspaceId={workspaceId} onStart={setActiveQuizId} />
            ))}
          {tab === 'artifacts' && <Artifacts workspaceId={workspaceId} />}
          {tab === 'notes' && <Notes workspaceId={workspaceId} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function Dashboard({
  workspaceId,
  onReview,
}: {
  workspaceId: string;
  onReview: () => void;
}) {
  const progress = trpc.study.progress.useQuery({ workspaceId });
  const cefr = trpc.language.cefr.get.useQuery({ workspaceId });
  const data = progress.data;

  const stats: { label: string; value: string }[] = [
    { label: 'Due now', value: String(data?.dueNow ?? 0) },
    { label: 'New cards', value: String(data?.newCards ?? 0) },
    { label: 'Reviews today', value: String(data?.reviewsToday ?? 0) },
    {
      label: 'Streak',
      value: `${data?.streakDays ?? 0} day${data?.streakDays === 1 ? '' : 's'}`,
    },
    {
      label: 'Retention (30d)',
      value:
        data?.retention30d == null
          ? '—'
          : `${Math.round(data.retention30d * 100)}%`,
    },
    { label: 'Cards added (7d)', value: String(data?.cardsAdded7d ?? 0) },
  ];

  return (
    <div>
      <h2 className="text-lg font-semibold">Today</h2>
      <p className="mt-1 text-sm text-zinc-500">
        Review your due cards, then add more from any document or passage.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3"
          >
            <p className="text-xs text-zinc-500">{stat.label}</p>
            <p className="mt-1 text-xl font-semibold text-zinc-100">
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {cefr.data && (
        <section className="mt-5 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Language level
            </h3>
            <span className="rounded bg-nexus-600/20 px-2 py-0.5 text-sm font-semibold text-nexus-200">
              {cefr.data.overall}
            </span>
            {cefr.data.targetLanguage && (
              <span className="text-[11px] text-zinc-600">
                {cefr.data.targetLanguage}
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {cefr.data.skills.map((skill) => (
              <span
                key={skill.skill}
                title={
                  skill.evidence === 0
                    ? 'No practice recorded yet'
                    : `${skill.evidence} practice event(s) · ${Math.round(skill.score * 100)}%`
                }
                className="rounded-full border border-zinc-700 px-2.5 py-1 text-[11px] capitalize text-zinc-300"
              >
                {skill.skill}{' '}
                <span className="font-semibold text-nexus-200">
                  {skill.level}
                </span>
              </span>
            ))}
          </div>
        </section>
      )}

      <button
        onClick={onReview}
        disabled={(data?.dueNow ?? 0) === 0}
        className="mt-5 rounded-lg bg-nexus-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-nexus-500 disabled:opacity-40"
      >
        {(data?.dueNow ?? 0) === 0
          ? 'Nothing due right now'
          : `Start review (${data?.dueNow})`}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

function ReviewSession({
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

// ---------------------------------------------------------------------------
// Decks
// ---------------------------------------------------------------------------

function Decks({
  workspaceId,
  onReview,
}: {
  workspaceId: string;
  onReview: (deckId: string) => void;
}) {
  const utils = trpc.useUtils();
  const toast = useToast();
  const decks = trpc.study.decks.list.useQuery({ workspaceId });
  const documents = trpc.document.listByWorkspace.useQuery({ workspaceId });
  const [newDeck, setNewDeck] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [count, setCount] = useState('8');

  const invalidate = () => {
    void utils.study.decks.list.invalidate({ workspaceId });
    void utils.study.progress.invalidate({ workspaceId });
  };

  const createDeck = trpc.study.decks.create.useMutation({
    onSuccess: () => {
      setNewDeck('');
      invalidate();
    },
    onError: (err) =>
      toast.push({
        kind: 'error',
        message: `Create deck failed: ${err.message}`,
      }),
  });
  const deleteDeck = trpc.study.decks.delete.useMutation({
    onSuccess: invalidate,
    onError: (err) =>
      toast.push({ kind: 'error', message: `Delete failed: ${err.message}` }),
  });
  const generate = trpc.study.cards.generate.useMutation({
    onSuccess: (data) => {
      toast.push({
        kind: 'success',
        message: `Created ${data.created.length} flashcard${data.created.length === 1 ? '' : 's'}.`,
      });
      invalidate();
    },
    onError: (err) =>
      toast.push({
        kind: 'error',
        message: `Generation failed: ${err.message}`,
      }),
  });

  const exportQuery = trpc.study.cards.exportCsv.useQuery(
    { workspaceId },
    { enabled: false },
  );

  async function downloadCsv() {
    const result = await exportQuery.refetch();
    const payload = result.data;
    if (!payload) return;
    const blob = new Blob([payload.csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = payload.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold">Decks</h2>
        <ul className="mt-3 space-y-2">
          {decks.data?.map((deck) => (
            <li
              key={deck.id}
              className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{deck.name}</p>
                <p className="text-xs text-zinc-500">
                  {deck.cardCount} card{deck.cardCount === 1 ? '' : 's'} ·{' '}
                  {deck.dueCount} due
                  {deck.newCount > 0 ? ` · ${deck.newCount} new` : ''}
                </p>
              </div>
              <button
                onClick={() => onReview(deck.id)}
                disabled={deck.dueCount === 0}
                className="rounded-lg bg-nexus-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-nexus-500 disabled:opacity-40"
              >
                Review
              </button>
              <button
                onClick={() => {
                  if (confirm(`Delete deck "${deck.name}" and its cards?`)) {
                    deleteDeck.mutate({ deckId: deck.id });
                  }
                }}
                className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                title="Delete deck"
                aria-label="Delete deck"
              >
                ✕
              </button>
            </li>
          ))}
          {decks.data?.length === 0 && (
            <li className="rounded-xl border border-dashed border-zinc-800 px-4 py-6 text-center text-xs text-zinc-600">
              No decks yet. Generate cards from a document below.
            </li>
          )}
        </ul>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (newDeck.trim()) {
              createDeck.mutate({ workspaceId, name: newDeck.trim() });
            }
          }}
          className="mt-3 flex gap-2"
        >
          <input
            value={newDeck}
            onChange={(event) => setNewDeck(event.target.value)}
            placeholder="New deck name"
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-nexus-500"
          />
          <button
            type="submit"
            disabled={!newDeck.trim() || createDeck.isPending}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
          >
            Add deck
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <h3 className="text-sm font-semibold">
          Generate cards from a document
        </h3>
        <p className="mt-1 text-xs text-zinc-500">
          The chat model turns the document's indexed passages into flashcards.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <select
            value={documentId}
            onChange={(event) => setDocumentId(event.target.value)}
            aria-label="Document"
            className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-nexus-500"
          >
            <option value="">Select a document…</option>
            {documents.data
              ?.filter((doc) => doc.status === 'ready')
              .map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.title}
                </option>
              ))}
          </select>
          <input
            type="number"
            min={1}
            max={30}
            value={count}
            onChange={(event) => setCount(event.target.value)}
            aria-label="Number of cards"
            className="w-20 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-nexus-500"
          />
          <button
            onClick={() =>
              generate.mutate({
                workspaceId,
                documentId,
                count: Math.min(30, Math.max(1, Number(count) || 8)),
              })
            }
            disabled={!documentId || generate.isPending}
            className="rounded-lg bg-nexus-600 px-4 py-2 text-sm font-semibold text-white hover:bg-nexus-500 disabled:opacity-40"
          >
            {generate.isPending ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </section>

      <section className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
        <div>
          <p className="text-sm font-medium">Export to Anki</p>
          <p className="text-xs text-zinc-500">
            Downloads a CSV (front, back) that Anki imports directly.
          </p>
        </div>
        <button
          onClick={() => void downloadCsv()}
          disabled={exportQuery.isFetching}
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
        >
          {exportQuery.isFetching ? 'Exporting…' : 'Export CSV'}
        </button>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quizzes
// ---------------------------------------------------------------------------

const QUIZ_KIND_LABELS: Record<QuizKind, string> = {
  mcq: 'Multiple choice',
  truefalse: 'True/False',
  short: 'Short answer',
};

function Quizzes({
  workspaceId,
  onStart,
}: {
  workspaceId: string;
  onStart: (quizId: string) => void;
}) {
  const utils = trpc.useUtils();
  const toast = useToast();
  const quizzes = trpc.quiz.list.useQuery({ workspaceId });
  const documents = trpc.document.listByWorkspace.useQuery({ workspaceId });
  const [documentId, setDocumentId] = useState('');
  const [count, setCount] = useState('5');
  const [kinds, setKinds] = useState<Record<QuizKind, boolean>>({
    mcq: true,
    truefalse: true,
    short: false,
  });
  const selectedKinds = (Object.keys(kinds) as QuizKind[]).filter(
    (kind) => kinds[kind],
  );

  const generate = trpc.quiz.generate.useMutation({
    onSuccess: (quiz) => {
      toast.push({
        kind: 'success',
        message: `Quiz ready with ${quiz.questionCount} question${quiz.questionCount === 1 ? '' : 's'}.`,
      });
      void utils.quiz.list.invalidate({ workspaceId });
      onStart(quiz.id);
    },
    onError: (err) =>
      toast.push({ kind: 'error', message: `Quiz failed: ${err.message}` }),
  });
  const remove = trpc.quiz.delete.useMutation({
    onSuccess: () => void utils.quiz.list.invalidate({ workspaceId }),
  });

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <h3 className="text-sm font-semibold">Generate a quiz</h3>
        <p className="mt-1 text-xs text-zinc-500">
          Questions come from a document's indexed passages. Wrong answers
          become flashcards in your deck.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <select
            aria-label="Quiz document"
            value={documentId}
            onChange={(event) => setDocumentId(event.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-nexus-500"
          >
            <option value="">Select a document…</option>
            {documents.data
              ?.filter((doc) => doc.status === 'ready')
              .map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.title}
                </option>
              ))}
          </select>
          <input
            aria-label="Question count"
            type="number"
            min={1}
            max={20}
            value={count}
            onChange={(event) => setCount(event.target.value)}
            className="w-20 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-nexus-500"
          />
          <button
            onClick={() =>
              generate.mutate({
                workspaceId,
                documentId,
                count: Math.min(20, Math.max(1, Number(count) || 5)),
                kinds: selectedKinds,
              })
            }
            disabled={
              !documentId || generate.isPending || selectedKinds.length === 0
            }
            className="rounded-lg bg-nexus-600 px-4 py-2 text-sm font-semibold text-white hover:bg-nexus-500 disabled:opacity-40"
          >
            {generate.isPending ? 'Generating…' : 'Generate'}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-zinc-400">
          {(Object.keys(QUIZ_KIND_LABELS) as QuizKind[]).map((kind) => (
            <label key={kind} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={kinds[kind]}
                onChange={(event) =>
                  setKinds((prev) => ({
                    ...prev,
                    [kind]: event.target.checked,
                  }))
                }
                className="accent-nexus-600"
              />
              {QUIZ_KIND_LABELS[kind]}
            </label>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Your quizzes</h2>
        <ul className="mt-3 space-y-2">
          {quizzes.data?.map((quiz) => (
            <li
              key={quiz.id}
              className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{quiz.title}</p>
                <p className="text-xs text-zinc-500">
                  {quiz.questionCount} question
                  {quiz.questionCount === 1 ? '' : 's'} · {quiz.attempts}{' '}
                  attempt{quiz.attempts === 1 ? '' : 's'}
                  {quiz.bestScore != null
                    ? ` · best ${Math.round(quiz.bestScore * 100)}%`
                    : ''}
                </p>
              </div>
              <button
                onClick={() => onStart(quiz.id)}
                disabled={quiz.questionCount === 0}
                className="rounded-lg bg-nexus-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-nexus-500 disabled:opacity-40"
              >
                Start
              </button>
              <button
                onClick={() => {
                  if (confirm('Delete this quiz and its attempts?')) {
                    remove.mutate({ quizId: quiz.id });
                  }
                }}
                aria-label="Delete quiz"
                className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
              >
                ✕
              </button>
            </li>
          ))}
          {quizzes.data?.length === 0 && (
            <li className="text-xs text-zinc-600">
              No quizzes yet. Generate one from a document above.
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}

function QuizRunner({
  quizId,
  onExit,
}: {
  quizId: string;
  onExit: () => void;
}) {
  const toast = useToast();
  const quiz = trpc.quiz.get.useQuery({ quizId });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const submit = trpc.quiz.submit.useMutation({
    onSuccess: (data) => setResult(data),
    onError: (err) =>
      toast.push({ kind: 'error', message: `Submit failed: ${err.message}` }),
  });

  if (quiz.isLoading) {
    return <p className="text-sm text-zinc-500">Loading quiz…</p>;
  }
  const questions = quiz.data?.questions ?? [];

  if (result) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 text-center">
          <p className="text-3xl font-bold">
            {Math.round(result.score * 100)}%
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            {result.correct} of {result.total} correct
          </p>
          {result.cardsCreated > 0 && (
            <p className="mt-2 text-xs text-amber-300">
              {result.cardsCreated} mistake card
              {result.cardsCreated === 1 ? '' : 's'} added to your deck.
            </p>
          )}
        </div>
        <ul className="mt-4 space-y-2">
          {result.results.map((entry, index) => (
            <li
              key={entry.questionId}
              className={`rounded-xl border p-4 text-sm ${
                entry.correct
                  ? 'border-emerald-900/40 bg-emerald-950/10'
                  : 'border-red-900/40 bg-red-950/10'
              }`}
            >
              <p className="font-medium text-zinc-200">
                {index + 1}. {entry.prompt}
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                Your answer:{' '}
                <span
                  className={
                    entry.correct ? 'text-emerald-300' : 'text-red-300'
                  }
                >
                  {entry.yourAnswer || '—'}
                </span>
              </p>
              {!entry.correct && (
                <p className="text-xs text-zinc-400">
                  Correct:{' '}
                  <span className="text-emerald-300">
                    {entry.correctAnswer}
                  </span>
                </p>
              )}
              {entry.feedback && (
                <p className="mt-1 text-xs text-zinc-500">{entry.feedback}</p>
              )}
              {entry.explanation && (
                <p className="mt-1 text-xs text-zinc-500">
                  {entry.explanation}
                </p>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => {
              setResult(null);
              setAnswers({});
            }}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            Retake
          </button>
          <button
            onClick={onExit}
            className="rounded-lg bg-nexus-600 px-4 py-2 text-sm font-semibold text-white hover:bg-nexus-500"
          >
            Back to quizzes
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{quiz.data?.title}</h2>
        <button
          onClick={onExit}
          className="text-xs text-zinc-400 hover:text-zinc-200"
        >
          Cancel
        </button>
      </div>
      {questions.map((question, index) => (
        <div
          key={question.id}
          className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
        >
          <p className="text-sm font-medium text-zinc-200">
            {index + 1}. {question.prompt}
          </p>
          <div className="mt-2">
            {question.kind === 'short' ? (
              <textarea
                value={answers[question.id] ?? ''}
                onChange={(event) =>
                  setAnswers((prev) => ({
                    ...prev,
                    [question.id]: event.target.value,
                  }))
                }
                rows={2}
                placeholder="Your answer…"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-nexus-500"
              />
            ) : (
              <div className="space-y-1.5">
                {(question.options ?? []).map((option) => (
                  <label
                    key={option}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
                  >
                    <input
                      type="radio"
                      name={question.id}
                      checked={answers[question.id] === option}
                      onChange={() =>
                        setAnswers((prev) => ({
                          ...prev,
                          [question.id]: option,
                        }))
                      }
                      className="accent-nexus-600"
                    />
                    {option}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
      <button
        onClick={() =>
          submit.mutate({
            quizId,
            answers: questions.map((question) => ({
              questionId: question.id,
              answer: answers[question.id] ?? '',
            })),
          })
        }
        disabled={submit.isPending || questions.length === 0}
        className="w-full rounded-xl bg-nexus-600 px-4 py-3 text-sm font-semibold text-white hover:bg-nexus-500 disabled:opacity-40"
      >
        {submit.isPending ? 'Grading…' : 'Submit quiz'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Studio artifacts
// ---------------------------------------------------------------------------

const ARTIFACT_KIND_LABELS: Record<ArtifactKind, string> = {
  summary: 'Summary',
  study_guide: 'Study guide',
  glossary: 'Glossary',
  mindmap: 'Mind map',
};

function Artifacts({ workspaceId }: { workspaceId: string }) {
  const utils = trpc.useUtils();
  const toast = useToast();
  const artifacts = trpc.artifacts.list.useQuery({ workspaceId });
  const documents = trpc.document.listByWorkspace.useQuery({ workspaceId });
  const [documentId, setDocumentId] = useState('');
  const [kind, setKind] = useState<ArtifactKind>('summary');

  const generate = trpc.artifacts.generate.useMutation({
    onSuccess: () => {
      toast.push({ kind: 'success', message: 'Artifact created' });
      void utils.artifacts.list.invalidate({ workspaceId });
    },
    onError: (err) =>
      toast.push({ kind: 'error', message: `Artifact failed: ${err.message}` }),
  });
  const remove = trpc.artifacts.delete.useMutation({
    onSuccess: () => void utils.artifacts.list.invalidate({ workspaceId }),
  });

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <h3 className="text-sm font-semibold">Generate a study artifact</h3>
        <p className="mt-1 text-xs text-zinc-500">
          Turn a document into a summary, a study guide, a glossary or a Mermaid
          mind map. Artifacts are saved in this workspace's studio.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <select
            aria-label="Artifact document"
            value={documentId}
            onChange={(event) => setDocumentId(event.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-nexus-500"
          >
            <option value="">Select a document…</option>
            {documents.data
              ?.filter((doc) => doc.status === 'ready')
              .map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.title}
                </option>
              ))}
          </select>
          <select
            aria-label="Artifact kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as ArtifactKind)}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-nexus-500"
          >
            {(Object.keys(ARTIFACT_KIND_LABELS) as ArtifactKind[]).map(
              (artifactKind) => (
                <option key={artifactKind} value={artifactKind}>
                  {ARTIFACT_KIND_LABELS[artifactKind]}
                </option>
              ),
            )}
          </select>
          <button
            onClick={() => generate.mutate({ workspaceId, documentId, kind })}
            disabled={!documentId || generate.isPending}
            className="rounded-lg bg-nexus-600 px-4 py-2 text-sm font-semibold text-white hover:bg-nexus-500 disabled:opacity-40"
          >
            {generate.isPending ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Studio</h2>
        <ul className="mt-3 space-y-2">
          {artifacts.data?.map((artifact) => (
            <li
              key={artifact.id}
              className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
            >
              <div className="flex items-center gap-2">
                <span className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                  {ARTIFACT_KIND_LABELS[artifact.kind]}
                </span>
                <p className="min-w-0 flex-1 truncate text-sm font-medium">
                  {artifact.title}
                </p>
                <button
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(artifact.contentMd)
                      .then(() =>
                        toast.push({ kind: 'success', message: 'Copied' }),
                      );
                  }}
                  className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                >
                  Copy
                </button>
                <button
                  onClick={() => remove.mutate({ artifactId: artifact.id })}
                  aria-label="Delete artifact"
                  className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                >
                  ✕
                </button>
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-nexus-300">
                  View
                </summary>
                <div className="markdown-body mt-2 max-h-96 overflow-y-auto rounded-lg bg-zinc-950/60 p-3">
                  <Suspense
                    fallback={
                      <pre className="whitespace-pre-wrap text-xs text-zinc-400">
                        {artifact.contentMd}
                      </pre>
                    }
                  >
                    <Markdown content={artifact.contentMd} />
                  </Suspense>
                </div>
              </details>
            </li>
          ))}
          {artifacts.data?.length === 0 && (
            <li className="text-xs text-zinc-600">
              No artifacts yet. Generate one from a document above.
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notes & highlights
// ---------------------------------------------------------------------------

function Notes({ workspaceId }: { workspaceId: string }) {
  const utils = trpc.useUtils();
  const toast = useToast();
  const notes = trpc.notes.notes.list.useQuery({ workspaceId });
  const highlights = trpc.notes.highlights.list.useQuery({ workspaceId });
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const invalidate = () => {
    void utils.notes.notes.list.invalidate({ workspaceId });
    void utils.notes.highlights.list.invalidate({ workspaceId });
  };

  const createNote = trpc.notes.notes.create.useMutation({
    onSuccess: () => {
      setTitle('');
      setContent('');
      invalidate();
    },
    onError: (err) =>
      toast.push({
        kind: 'error',
        message: `Save note failed: ${err.message}`,
      }),
  });
  const deleteNote = trpc.notes.notes.delete.useMutation({
    onSuccess: invalidate,
  });
  const deleteHighlight = trpc.notes.highlights.delete.useMutation({
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold">Notes</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (title.trim()) {
              createNote.mutate({
                workspaceId,
                title: title.trim(),
                contentMd: content,
              });
            }
          }}
          className="mt-3 space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4"
        >
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Note title"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-nexus-500"
          />
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Write in Markdown…"
            rows={3}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-nexus-500"
          />
          <button
            type="submit"
            disabled={!title.trim() || createNote.isPending}
            className="rounded-lg bg-nexus-600 px-4 py-2 text-sm font-semibold text-white hover:bg-nexus-500 disabled:opacity-40"
          >
            {createNote.isPending ? 'Saving…' : 'Save note'}
          </button>
        </form>

        <ul className="mt-4 space-y-2">
          {notes.data?.map((note) => (
            <li
              key={note.id}
              className="group rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{note.title}</p>
                  {note.contentMd && (
                    <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-zinc-500">
                      {note.contentMd}
                    </p>
                  )}
                  {note.tags.length > 0 && (
                    <p className="mt-1 text-[10px] text-zinc-600">
                      {note.tags.join(' · ')}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => deleteNote.mutate({ noteId: note.id })}
                  aria-label="Delete note"
                  className="rounded p-1 text-zinc-600 opacity-0 hover:bg-zinc-800 hover:text-red-400 group-hover:opacity-100"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
          {notes.data?.length === 0 && (
            <li className="text-xs text-zinc-600">
              No notes yet. Select a passage in chat and choose “Highlight”.
            </li>
          )}
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Highlights</h2>
        <ul className="mt-3 space-y-2">
          {highlights.data?.map((highlight) => (
            <li
              key={highlight.id}
              className="group rounded-xl border border-amber-900/30 bg-amber-950/10 px-4 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="border-l-2 border-amber-500/60 pl-3 text-sm text-zinc-300">
                    “{highlight.quotedText.slice(0, 300)}”
                  </p>
                  {highlight.note && (
                    <p className="mt-1.5 text-xs text-zinc-500">
                      {highlight.note}
                    </p>
                  )}
                </div>
                <button
                  onClick={() =>
                    deleteHighlight.mutate({ highlightId: highlight.id })
                  }
                  aria-label="Delete highlight"
                  className="rounded p-1 text-zinc-600 opacity-0 hover:bg-zinc-800 hover:text-red-400 group-hover:opacity-100"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
          {highlights.data?.length === 0 && (
            <li className="text-xs text-zinc-600">
              No highlights yet. Select text in a chat answer to save one.
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
