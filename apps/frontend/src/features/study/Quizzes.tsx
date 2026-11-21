import { QUIZ_KIND_LABELS } from './constants';
import { useState } from 'react';
import type { QuizKind, QuizResult } from '@nexus/contracts';
import { useToast } from '../../components/Toast';
import { trpc } from '../../platform/trpc';

export function Quizzes({
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

export function QuizRunner({
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
