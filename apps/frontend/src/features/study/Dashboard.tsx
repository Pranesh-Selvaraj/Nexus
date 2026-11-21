import { trpc } from '../../lib/trpc';

export function Dashboard({
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
