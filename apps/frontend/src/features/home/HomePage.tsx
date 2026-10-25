import { trpc } from '../../lib/trpc';

interface Props {
  onOpenTopic: (topicId: string) => void;
  onStartReview: (topicId: string) => void;
  onOpenTopics: () => void;
  onCreateTopic: () => void;
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'no activity yet';
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/**
 * Universal dashboard: everything the learner is working on, across topics.
 * The portal opens here instead of an empty chat.
 */
export function HomePage({
  onOpenTopic,
  onStartReview,
  onOpenTopics,
  onCreateTopic,
}: Props) {
  const overview = trpc.dashboard.overview.useQuery(undefined);
  const data = overview.data;

  const stats = [
    ['Topics', data?.totals.topics ?? 0, 'learning spaces'],
    ['Sources', data?.totals.documents ?? 0, 'documents and pages'],
    ['Due now', data?.totals.dueCards ?? 0, 'cards to review'],
    ['Reviewed today', data?.totals.reviewsToday ?? 0, 'cards practised'],
  ] as const;

  const nextTopic = data?.topics.find((topic) => topic.dueCount > 0);
  const activeTopics = (data?.topics ?? []).slice(0, 6);
  const words = data?.totals.wordsIngested ?? 0;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-5 py-8 md:px-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-nexus-300">
              Learning portal
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">
              What do you want to learn today?
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
              Bring a book, a lecture, a web page or a picture. Ask questions,
              practise with exercises, and review what you want to remember —
              technology, languages, art, anything.
            </p>
          </div>
          <button
            onClick={onCreateTopic}
            className="rounded-xl bg-nexus-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-nexus-500"
          >
            + New topic
          </button>
        </header>

        <section
          className="mt-7 grid grid-cols-2 gap-3 md:grid-cols-4"
          aria-label="Learning overview"
        >
          {stats.map(([label, value, hint]) => (
            <div
              key={label}
              className="rounded-2xl border border-zinc-800/80 bg-gradient-to-b from-zinc-900/80 to-zinc-900/30 px-4 py-3"
            >
              <p className="text-[11px] uppercase tracking-wider text-zinc-500">
                {label}
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-100">
                {value.toLocaleString()}
              </p>
              <p className="mt-0.5 text-[11px] text-zinc-600">{hint}</p>
            </div>
          ))}
        </section>

        {overview.isLoading && (
          <p className="mt-8 text-sm text-zinc-500">Loading your learning...</p>
        )}

        {data && data.topics.length === 0 && (
          <section className="mt-8 rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/30 p-8 text-center">
            <h2 className="text-lg font-semibold text-zinc-200">
              Start your first topic
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-zinc-400">
              A topic is a learning space: add your sources, then chat with
              them, build flashcards and quizzes, and practise until it sticks.
            </p>
            <button
              onClick={onCreateTopic}
              className="mt-4 rounded-xl bg-nexus-600 px-4 py-2 text-sm font-semibold text-white hover:bg-nexus-500"
            >
              Create a topic
            </button>
          </section>
        )}

        {activeTopics.length > 0 && (
          <section className="mt-8">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
                Continue learning
              </h2>
              <button
                onClick={onOpenTopics}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                All topics →
              </button>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {activeTopics.map((topic) => (
                <article
                  key={topic.id}
                  className="flex flex-col rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 transition-colors hover:border-zinc-700"
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      onClick={() => onOpenTopic(topic.id)}
                      className="min-w-0 text-left"
                    >
                      <h3 className="truncate text-sm font-semibold text-zinc-100">
                        {topic.name}
                      </h3>
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-zinc-500">
                        {topic.description ?? 'A learning space'}
                      </p>
                    </button>
                    {topic.dueCount > 0 && (
                      <span className="shrink-0 rounded-full bg-amber-950/60 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                        {topic.dueCount} due
                      </span>
                    )}
                  </div>
                  <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
                    <div>
                      <dt className="inline">Sources: </dt>
                      <dd className="inline text-zinc-300">
                        {topic.documentCount}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline">Activity: </dt>
                      <dd className="inline text-zinc-300">
                        {relativeTime(topic.lastActivityAt)}
                      </dd>
                    </div>
                    {topic.processingCount > 0 && (
                      <div className="text-amber-400">
                        <dt className="inline">Processing: </dt>
                        <dd className="inline">{topic.processingCount}</dd>
                      </div>
                    )}
                  </dl>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => onOpenTopic(topic.id)}
                      className="flex-1 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700"
                    >
                      Learn
                    </button>
                    <button
                      onClick={() =>
                        topic.dueCount > 0
                          ? onStartReview(topic.id)
                          : onOpenTopic(topic.id)
                      }
                      className="flex-1 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
                    >
                      {topic.dueCount > 0
                        ? `Review ${topic.dueCount}`
                        : 'Practice'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          {nextTopic && (
            <section className="rounded-2xl border border-nexus-700/40 bg-nexus-950/20 p-5">
              <h2 className="text-sm font-semibold text-nexus-200">
                Suggested next step
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-zinc-400">
                <strong className="text-zinc-200">{nextTopic.name}</strong> has{' '}
                {nextTopic.dueCount} card{nextTopic.dueCount === 1 ? '' : 's'}{' '}
                due. A short review now keeps the material fresh.
              </p>
              <button
                onClick={() => onStartReview(nextTopic.id)}
                className="mt-3 rounded-lg bg-nexus-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-nexus-500"
              >
                Start review
              </button>
            </section>
          )}

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
            <h2 className="text-sm font-semibold text-zinc-300">
              Suggested activities
            </h2>
            <ul className="mt-2 space-y-1.5 text-xs text-zinc-400">
              <li>
                <strong className="text-zinc-200">
                  Ask a grounded question
                </strong>{' '}
                about one of your sources; answers cite the passage.
              </li>
              <li>
                <strong className="text-zinc-200">Generate flashcards</strong>{' '}
                from a document and review them with spaced repetition.
              </li>
              <li>
                <strong className="text-zinc-200">Take a quiz</strong> generated
                from your material, then review the mistakes.
              </li>
              <li>
                <strong className="text-zinc-200">Practise a language</strong>{' '}
                with dictation, pronunciation and vocabulary mining.
              </li>
            </ul>
            {words > 0 && (
              <p className="mt-3 text-[11px] text-zinc-600">
                {words.toLocaleString()} words indexed across your topics.
              </p>
            )}
          </section>
        </div>

        {(data?.recentDocuments.length ?? 0) > 0 && (
          <section className="mt-8 pb-8">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
              Recently added
            </h2>
            <ul className="mt-2 divide-y divide-zinc-800/70 rounded-2xl border border-zinc-800">
              {data?.recentDocuments.map((doc) => (
                <li
                  key={doc.id}
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  <span className="text-[10px] uppercase text-zinc-600">
                    {doc.fileType ?? 'file'}
                  </span>
                  <button
                    onClick={() => onOpenTopic(doc.workspaceId)}
                    className="min-w-0 flex-1 truncate text-left text-sm text-zinc-300 hover:text-white"
                  >
                    {doc.title}
                  </button>
                  <span className="shrink-0 text-[11px] text-zinc-600">
                    {doc.workspaceName}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase ${
                      doc.status === 'ready'
                        ? 'bg-emerald-950/50 text-emerald-400'
                        : doc.status === 'failed'
                          ? 'bg-red-950/50 text-red-400'
                          : 'bg-amber-950/40 text-amber-400'
                    }`}
                  >
                    {doc.status}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
