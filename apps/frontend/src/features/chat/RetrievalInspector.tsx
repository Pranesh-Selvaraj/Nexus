import type { RetrievalDebug } from '@nexus/contracts';

import { Stat } from './SourcesPanel';
import { pct } from './utils';
export function RetrievalInspector({
  debug,
  onClose,
}: {
  debug: RetrievalDebug;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Retrieval inspector"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold">Retrieval inspector</h2>
            <p className="text-xs text-zinc-500">
              How this answer's sources were selected.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close inspector"
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          >
            ✕
          </button>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
          <Stat label="Profile" value={debug.profile} />
          <Stat
            label="Rewritten query"
            value={debug.rewritten ? 'yes' : 'no'}
          />
          <Stat label="Reranked" value={debug.reranked ? 'yes' : 'no'} />
          <Stat
            label="Vector candidates"
            value={String(debug.vectorCandidates)}
          />
          <Stat
            label="Keyword candidates"
            value={String(debug.keywordCandidates)}
          />
          <Stat
            label="Context budget"
            value={`${debug.usedTokens} / ${debug.tokenBudget} tokens`}
          />
          <Stat label="Min vector score" value={String(debug.minScore)} />
        </dl>

        {debug.rewritten && (
          <p className="mt-3 rounded-lg bg-zinc-950/60 px-3 py-2 text-xs text-zinc-400">
            <span className="text-zinc-500">Original:</span>{' '}
            {debug.originalQuery}
            <br />
            <span className="text-zinc-500">Searched for:</span>{' '}
            {debug.searchQuery}
          </p>
        )}

        <div className="mt-4">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Candidates ({debug.candidates.length})
          </p>
          <div className="space-y-1">
            {debug.candidates.map((candidate) => (
              <div
                key={candidate.id}
                className={`rounded-lg border px-3 py-2 text-xs ${
                  candidate.selected
                    ? 'border-nexus-700/60 bg-nexus-950/20'
                    : 'border-zinc-800 bg-zinc-950/40'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-zinc-500">
                    #{candidate.rank}
                    {candidate.rerankedRank != null &&
                    candidate.rerankedRank !== candidate.rank
                      ? ` → ${candidate.rerankedRank}`
                      : ''}
                  </span>
                  {candidate.selected && (
                    <span className="rounded bg-nexus-600/30 px-1.5 text-[10px] text-nexus-200">
                      selected
                    </span>
                  )}
                  <span className="truncate text-zinc-300">
                    {candidate.title}
                  </span>
                  {candidate.page != null && (
                    <span className="text-zinc-600">p.{candidate.page}</span>
                  )}
                  <span className="ml-auto shrink-0 text-zinc-500">
                    v {pct(candidate.vectorScore)} · k{' '}
                    {pct(candidate.keywordScore)} · f{' '}
                    {pct(candidate.fusedScore)}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-zinc-500">
                  {candidate.contentPreview}
                </p>
              </div>
            ))}
            {debug.candidates.length === 0 && (
              <p className="text-xs text-zinc-600">
                No candidates were retrieved for this question.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
