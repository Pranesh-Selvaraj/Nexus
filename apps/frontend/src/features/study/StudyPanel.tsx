import { useState } from 'react';

import { useReviewSync } from '../../lib/use-review-sync';

import { Artifacts } from './Artifacts';
import { Dashboard } from './Dashboard';
import { Decks } from './Decks';
import { Notes } from './Notes';
import { Quizzes, QuizRunner } from './Quizzes';
import { ReviewSession } from './ReviewSession';

interface Props {
  workspaceId: string;
  initialTab?: Tab;
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

/** Study loop: dashboard, flashcard review (FSRS), decks and notes. */
export function StudyPanel({ workspaceId, initialTab }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'dashboard');
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

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Decks
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Quizzes
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Studio artifacts
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Notes & highlights
// ---------------------------------------------------------------------------
