import { useState } from 'react';

import type {
  DictationScore,
  VoiceConfig,
  VocabularyState,
} from '@nexus/shared-types';

import { useToast } from '../../components/Toast';
import { trpc } from '../../lib/trpc';
import { ReadAloudPlayer } from '../voice/ReadAloudPlayer';
import { PronunciationPanel } from '../voice/PronunciationPanel';

interface Props {
  workspaceId: string;
  config: VoiceConfig | undefined;
}

type Tab = 'vocabulary' | 'dictation' | 'pronunciation' | 'progress';

const TABS: { id: Tab; label: string }[] = [
  { id: 'vocabulary', label: 'Vocabulary' },
  { id: 'dictation', label: 'Dictation' },
  { id: 'pronunciation', label: 'Pronunciation' },
  { id: 'progress', label: 'Progress' },
];

const SAMPLE_TEXT =
  'Hybrid retrieval fuses vector similarity with keyword search. The scheduler defers difficult cards until the learner has consolidated the material.';

export function LanguagePanel({ workspaceId, config }: Props) {
  const [tab, setTab] = useState<Tab>('vocabulary');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-zinc-800 px-3 py-2">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
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
          {tab === 'vocabulary' && (
            <VocabularyPanel workspaceId={workspaceId} config={config} />
          )}
          {tab === 'dictation' && (
            <DictationPanel workspaceId={workspaceId} config={config} />
          )}
          {tab === 'pronunciation' && (
            <PronunciationPanel workspaceId={workspaceId} config={config} />
          )}
          {tab === 'progress' && <CefrPanel workspaceId={workspaceId} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

const STATE_CLASS: Record<VocabularyState, string> = {
  known: 'bg-emerald-950/60 text-emerald-300',
  learning: 'bg-nexus-600/20 text-nexus-200',
  ignored: 'bg-zinc-800 text-zinc-500',
};

function VocabularyPanel({
  workspaceId,
  config,
}: {
  workspaceId: string;
  config: VoiceConfig | undefined;
}) {
  const toast = useToast();
  const utils = trpc.useUtils();
  const [text, setText] = useState(SAMPLE_TEXT);
  const [filter, setFilter] = useState<'all' | VocabularyState>('all');

  const list = trpc.language.vocabulary.list.useQuery({
    workspaceId,
    state: filter === 'all' ? undefined : filter,
  });
  const mine = trpc.language.vocabulary.mine.useMutation({
    onSuccess: (data) => {
      toast.push({
        kind: 'success',
        message: `Added ${data.items.length} term${data.items.length === 1 ? '' : 's'} (${data.cardsCreated} card${data.cardsCreated === 1 ? '' : 's'}).`,
      });
      void utils.language.vocabulary.list.invalidate({ workspaceId });
      void utils.study.decks.invalidate();
    },
    onError: (err) =>
      toast.push({ kind: 'error', message: `Mining failed: ${err.message}` }),
  });
  const update = trpc.language.vocabulary.update.useMutation({
    onSuccess: () =>
      void utils.language.vocabulary.list.invalidate({ workspaceId }),
    onError: (err) => toast.push({ kind: 'error', message: err.message }),
  });
  const remove = trpc.language.vocabulary.delete.useMutation({
    onSuccess: () =>
      void utils.language.vocabulary.list.invalidate({ workspaceId }),
    onError: (err) => toast.push({ kind: 'error', message: err.message }),
  });

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold">Vocabulary</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Mine words from any passage. Each new term gets a spaced-repetition
          card with its translation and an example sentence.
        </p>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={3}
          aria-label="Text to mine"
          className="mt-3 w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-nexus-500"
        />
        <button
          type="button"
          onClick={() =>
            mine.mutate({ workspaceId, text, maxTerms: 12, createCards: true })
          }
          disabled={mine.isPending || text.trim().length < 20}
          className="mt-2 rounded-lg bg-nexus-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-nexus-500 disabled:opacity-40"
        >
          {mine.isPending ? 'Mining…' : 'Mine vocabulary'}
        </button>
      </section>

      <section>
        <div className="flex items-center gap-2">
          {(['all', 'learning', 'known', 'ignored'] as const).map((state) => (
            <button
              key={state}
              type="button"
              onClick={() => setFilter(state)}
              className={`rounded-full px-2.5 py-1 text-[11px] capitalize ${
                filter === state
                  ? 'bg-zinc-700 text-zinc-100'
                  : 'text-zinc-500 hover:bg-zinc-800'
              }`}
            >
              {state}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-zinc-600">
            {list.data?.length ?? 0} terms
          </span>
        </div>

        {list.data && list.data.length > 0 ? (
          <ul className="mt-3 divide-y divide-zinc-800 rounded-xl border border-zinc-800">
            {list.data.map((item) => (
              <li key={item.id} className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-zinc-100">{item.term}</span>
                  {item.partOfSpeech && (
                    <span className="text-[10px] uppercase text-zinc-600">
                      {item.partOfSpeech}
                    </span>
                  )}
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] ${STATE_CLASS[item.state]}`}
                  >
                    {item.state}
                  </span>
                  <span className="ml-auto flex items-center gap-1.5 text-[11px]">
                    <ReadAloudPlayer
                      text={item.term}
                      workspaceId={workspaceId}
                      config={config}
                      label="🔊"
                      compact
                    />
                    {(['learning', 'known', 'ignored'] as const).map(
                      (state) => (
                        <button
                          key={state}
                          type="button"
                          onClick={() =>
                            update.mutate({ vocabularyId: item.id, state })
                          }
                          className="rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                          title={`Mark ${state}`}
                        >
                          {state[0]?.toUpperCase()}
                        </button>
                      ),
                    )}
                    <button
                      type="button"
                      onClick={() => remove.mutate({ vocabularyId: item.id })}
                      className="rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                      title="Delete"
                    >
                      ✕
                    </button>
                  </span>
                </div>
                {item.translation && (
                  <p className="mt-0.5 text-sm text-zinc-400">
                    {item.translation}
                  </p>
                )}
                {item.example && (
                  <p className="mt-0.5 text-xs italic text-zinc-600">
                    {item.example}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-zinc-600">
            No vocabulary yet — mine a passage above, or select text in a chat
            answer and choose “Mine”.
          </p>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dictation
// ---------------------------------------------------------------------------

const DIFF_CLASS: Record<string, string> = {
  correct: 'text-emerald-300',
  wrong: 'text-amber-300',
  missing: 'text-red-400 line-through',
  extra: 'text-sky-300',
};

function DictationPanel({
  workspaceId,
  config,
}: {
  workspaceId: string;
  config: VoiceConfig | undefined;
}) {
  const toast = useToast();
  const [target, setTarget] = useState(
    'The library closes at six o’clock on weekdays.',
  );
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState<DictationScore | null>(null);

  const score = trpc.language.dictation.score.useMutation({
    onSuccess: setResult,
    onError: (err) =>
      toast.push({ kind: 'error', message: `Could not score: ${err.message}` }),
  });

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold">Dictation</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Listen to the sentence, then type exactly what you heard. Every
          attempt is counted as listening practice.
        </p>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <label
          htmlFor="dictation-target"
          className="text-xs font-semibold uppercase tracking-wider text-zinc-500"
        >
          Sentence
        </label>
        <div className="mt-2 flex items-center gap-3">
          <input
            id="dictation-target"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-nexus-500"
          />
          <ReadAloudPlayer
            text={target}
            workspaceId={workspaceId}
            config={config}
            label="▶ Play"
            compact
          />
        </div>

        <label
          htmlFor="dictation-typed"
          className="mt-4 block text-xs font-semibold uppercase tracking-wider text-zinc-500"
        >
          Your transcription
        </label>
        <textarea
          id="dictation-typed"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          rows={2}
          className="mt-2 w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-nexus-500"
        />
        <button
          type="button"
          onClick={() =>
            score.mutate({
              workspaceId,
              target,
              typed,
              language: config?.targetLanguage || undefined,
            })
          }
          disabled={score.isPending || !typed.trim()}
          className="mt-2 rounded-lg bg-nexus-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-nexus-500 disabled:opacity-40"
        >
          {score.isPending ? 'Checking…' : 'Check'}
        </button>
      </section>

      {result && (
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-3xl font-semibold text-zinc-100">
            {Math.round(result.accuracy * 100)}%
          </p>
          <p className="text-xs text-zinc-500">
            {result.correct} / {result.total} words correct
          </p>
          <div className="mt-3 flex flex-wrap gap-x-2 gap-y-1 text-sm">
            {result.words.map((word, index) => (
              <span
                key={`${word.word}-${index}`}
                className={DIFF_CLASS[word.status] ?? 'text-zinc-300'}
              >
                {word.word}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CEFR progress
// ---------------------------------------------------------------------------

function CefrPanel({ workspaceId }: { workspaceId: string }) {
  const profile = trpc.language.cefr.get.useQuery({ workspaceId });

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold">Language level</h2>
        <p className="mt-1 text-sm text-zinc-500">
          A CEFR estimate per skill, recomputed from your reviews, dictation,
          pronunciation and quiz results. Skills without enough evidence keep
          your starting level.
        </p>
      </section>

      {profile.isLoading && (
        <p className="text-sm text-zinc-500">Estimating…</p>
      )}
      {profile.data && (
        <>
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <p className="text-xs uppercase tracking-wider text-zinc-500">
              Overall
            </p>
            <p className="mt-1 text-3xl font-semibold text-nexus-200">
              {profile.data.overall}
            </p>
            {profile.data.targetLanguage && (
              <p className="text-xs text-zinc-500">
                Target language: {profile.data.targetLanguage}
              </p>
            )}
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            {profile.data.skills.map((skill) => (
              <div
                key={skill.skill}
                className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm capitalize text-zinc-300">
                    {skill.skill}
                  </p>
                  <span className="rounded bg-nexus-600/20 px-2 py-0.5 text-sm font-semibold text-nexus-200">
                    {skill.level}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-nexus-500"
                    style={{ width: `${Math.round(skill.score * 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-zinc-600">
                  {skill.evidence === 0
                    ? 'Not enough practice yet'
                    : `${skill.evidence} practice event${skill.evidence === 1 ? '' : 's'}`}
                </p>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
