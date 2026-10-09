import { useEffect, useState } from 'react';

import type { DueCard, ReviewRating } from '@nexus/shared-types';

import { useToast } from '../../components/Toast';
import { trpc } from '../../lib/trpc';

interface Props {
  workspaceId: string;
}

type Tab = 'dashboard' | 'review' | 'decks' | 'notes';

const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'review', label: 'Review' },
  { id: 'decks', label: 'Decks' },
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-zinc-800 px-3 py-2">
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
  onDone,
}: {
  workspaceId: string;
  deckId: string | null;
  onDone: () => void;
}) {
  const utils = trpc.useUtils();
  const toast = useToast();
  const dueQuery = trpc.study.cards.due.useQuery({
    workspaceId,
    deckId: deckId ?? undefined,
    limit: 30,
  });
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

  const review = trpc.study.cards.review.useMutation({
    onSuccess: () => {
      setReviewedCount((count) => count + 1);
      setRevealed(false);
      setQueue((current) => (current ?? []).slice(1));
      void utils.study.progress.invalidate({ workspaceId });
      void utils.study.decks.list.invalidate({ workspaceId });
    },
    onError: (err) =>
      toast.push({ kind: 'error', message: `Review failed: ${err.message}` }),
  });

  const current = queue?.[0];

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
          if (rating) review.mutate({ cardId: current.id, rating });
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
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
              onClick={() =>
                review.mutate({ cardId: current.id, rating: button.rating })
              }
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
