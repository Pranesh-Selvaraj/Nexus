import { useState } from 'react';

import type { PronunciationScore, VoiceConfig } from '@nexus/shared-types';

import { useToast } from '../../components/Toast';
import { trpc } from '../../lib/trpc';
import { ReadAloudPlayer } from './ReadAloudPlayer';
import { MicButton } from './MicButton';

interface Props {
  workspaceId: string;
  config: VoiceConfig | undefined;
}

const STATUS_CLASS: Record<string, string> = {
  good: 'bg-emerald-950/60 text-emerald-300',
  close: 'bg-amber-950/60 text-amber-300',
  off: 'bg-red-950/60 text-red-300',
  missing: 'bg-zinc-800 text-zinc-400 line-through',
};

function scoreColor(score: number): string {
  if (score >= 0.85) return 'text-emerald-400';
  if (score >= 0.6) return 'text-amber-400';
  return 'text-red-400';
}

/**
 * Record-and-score pronunciation practice. Feedback is per word (aligned
 * against the target) and framed as guidance, not a grade.
 */
export function PronunciationPanel({ workspaceId, config }: Props) {
  const toast = useToast();
  const [target, setTarget] = useState(
    'The quick brown fox jumps over the lazy dog.',
  );
  const [transcript, setTranscript] = useState('');
  const [result, setResult] = useState<PronunciationScore | null>(null);

  const utils = trpc.useUtils();
  const pairs = trpc.voice.pronunciation.minimalPairs.useQuery();
  const history = trpc.voice.pronunciation.list.useQuery({ workspaceId });
  const score = trpc.voice.pronunciation.score.useMutation({
    onSuccess: (data) => {
      setResult(data);
      void utils.voice.pronunciation.list.invalidate({ workspaceId });
    },
    onError: (err) =>
      toast.push({ kind: 'error', message: `Scoring failed: ${err.message}` }),
  });

  function handleTranscript(text: string) {
    setTranscript(text);
    score.mutate({
      workspaceId,
      target,
      transcript: text,
      language: config?.targetLanguage || undefined,
    });
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold">Pronunciation</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Record yourself reading the target sentence. Each word is aligned
          against what the recognizer heard; treat the scores as feedback.
        </p>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <label
          htmlFor="pronunciation-target"
          className="text-xs font-semibold uppercase tracking-wider text-zinc-500"
        >
          Target sentence
        </label>
        <input
          id="pronunciation-target"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-nexus-500"
        />

        {pairs.data && pairs.data.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {pairs.data.slice(0, 8).map((pair) => (
              <button
                key={`${pair.a}-${pair.b}`}
                type="button"
                onClick={() => setTarget(`${pair.a}, ${pair.b}`)}
                title={pair.hint}
                className="rounded-full border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
              >
                {pair.a} / {pair.b}
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          <MicButton
            workspaceId={workspaceId}
            config={config}
            onTranscript={handleTranscript}
            disabled={!target.trim() || score.isPending}
          />
          <span className="text-xs text-zinc-500">
            {score.isPending
              ? 'Scoring…'
              : 'Click to record, click again to stop.'}
          </span>
          <div className="ml-auto">
            <ReadAloudPlayer
              text={target}
              workspaceId={workspaceId}
              config={config}
              label="Hear it"
              compact
            />
          </div>
        </div>

        {transcript && (
          <p className="mt-3 text-xs text-zinc-500">
            Heard: <span className="text-zinc-300">{transcript}</span>
          </p>
        )}
      </section>

      {result && (
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="flex items-baseline gap-3">
            <p
              className={`text-3xl font-semibold ${scoreColor(result.overall)}`}
            >
              {Math.round(result.overall * 100)}%
            </p>
            <p className="text-xs text-zinc-500">per-word average</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {result.words.map((word, index) => (
              <span
                key={`${word.word}-${index}`}
                title={
                  word.heard
                    ? `Heard “${word.heard}” · ${Math.round(word.score * 100)}%`
                    : 'Not detected'
                }
                className={`rounded-md px-2 py-1 text-xs ${STATUS_CLASS[word.status] ?? 'bg-zinc-800 text-zinc-300'}`}
              >
                {word.word}
              </span>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-zinc-600">
            {result.words.filter((word) => word.status !== 'good').length === 0
              ? 'Every word was recognised clearly.'
              : 'Highlighted words are the ones to practise again.'}
          </p>
        </section>
      )}

      <section>
        <h3 className="text-sm font-semibold text-zinc-300">Recent attempts</h3>
        {history.data && history.data.length > 0 ? (
          <ul className="mt-2 divide-y divide-zinc-800 rounded-xl border border-zinc-800">
            {history.data.slice(0, 8).map((attempt) => (
              <li
                key={attempt.id}
                className="flex items-center gap-3 px-3 py-2 text-sm"
              >
                <span
                  className={`font-semibold ${scoreColor(attempt.overall)}`}
                >
                  {Math.round(attempt.overall * 100)}%
                </span>
                <span className="truncate text-zinc-400">{attempt.target}</span>
                <span className="ml-auto shrink-0 text-[10px] text-zinc-600">
                  {new Date(attempt.createdAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-zinc-600">No attempts yet.</p>
        )}
      </section>
    </div>
  );
}
