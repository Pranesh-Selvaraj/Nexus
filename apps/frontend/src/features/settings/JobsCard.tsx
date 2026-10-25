import { trpc } from '../../lib/trpc';
import { useToast } from '../../components/Toast';

/**
 * Embedding queue admin view (P-3): pending/failed job counts and the failed
 * jobs with their document, error and attempt count, plus retry and drop
 * actions. Refreshes every five seconds while the settings page is open.
 */
export function JobsCard() {
  const toast = useToast();
  const utils = trpc.useUtils();
  const status = trpc.admin.queue.useQuery(undefined, {
    refetchInterval: 5_000,
  });

  const retry = trpc.admin.retryJob.useMutation({
    onSuccess: () => {
      void utils.admin.queue.invalidate();
      void utils.document.retrievalStatus.invalidate();
      toast.push({ kind: 'success', message: 'Job requeued' });
    },
    onError: (err) =>
      toast.push({ kind: 'error', message: `Retry failed: ${err.message}` }),
  });
  const remove = trpc.admin.removeJob.useMutation({
    onSuccess: () => {
      void utils.admin.queue.invalidate();
      toast.push({ kind: 'info', message: 'Job removed from the queue' });
    },
    onError: (err) =>
      toast.push({ kind: 'error', message: `Remove failed: ${err.message}` }),
  });

  const counts = status.data?.counts;

  return (
    <section className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900/40">
      <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
        <h2 className="text-sm font-semibold">Indexing queue</h2>
        <span className="text-[11px] text-zinc-500">
          {status.isFetching ? 'Refreshing…' : 'Refreshes every 5s'}
        </span>
      </div>
      <div className="space-y-3 p-5">
        {status.isLoading && (
          <p className="text-xs text-zinc-500">Loading queue...</p>
        )}
        {status.isError && (
          <p className="text-xs text-red-400">
            Could not read the queue: {status.error.message}
          </p>
        )}
        {counts && (
          <dl className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {(
              [
                ['waiting', counts.waiting],
                ['active', counts.active],
                ['delayed', counts.delayed],
                ['failed', counts.failed],
                ['completed', counts.completed],
                ['paused', counts.paused],
              ] as const
            ).map(([label, value]) => (
              <div
                key={label}
                className={`rounded-lg border px-2 py-1.5 text-center ${
                  label === 'failed' && value > 0
                    ? 'border-red-900/60 bg-red-950/30'
                    : 'border-zinc-800'
                }`}
              >
                <dt className="text-[10px] uppercase tracking-wide text-zinc-500">
                  {label}
                </dt>
                <dd
                  className={`text-sm font-semibold ${
                    label === 'failed' && value > 0
                      ? 'text-red-300'
                      : 'text-zinc-200'
                  }`}
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {status.data && status.data.failed.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
              Failed jobs
            </p>
            <ul className="space-y-1.5">
              {status.data.failed.map((job) => (
                <li
                  key={`${job.jobId}-${job.documentId}`}
                  className="rounded-lg border border-zinc-800 px-3 py-2"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs text-zinc-200">
                        {job.title ?? job.documentId}
                      </p>
                      <p className="text-[11px] text-zinc-500">
                        {job.attemptsMade} attempt
                        {job.attemptsMade === 1 ? '' : 's'}
                        {job.failedAt
                          ? ` · ${new Date(job.failedAt).toLocaleString()}`
                          : ''}
                      </p>
                      {job.error && (
                        <p className="mt-1 line-clamp-2 text-[11px] text-red-400/90">
                          {job.error}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        onClick={() =>
                          retry.mutate({ documentId: job.documentId })
                        }
                        disabled={retry.isPending}
                        className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-[11px] text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-40"
                      >
                        Retry
                      </button>
                      <button
                        onClick={() =>
                          remove.mutate({ documentId: job.documentId })
                        }
                        disabled={remove.isPending}
                        className="rounded-lg border border-red-900/60 px-2.5 py-1.5 text-[11px] text-red-400 transition-colors hover:bg-red-950/40 disabled:opacity-40"
                      >
                        Drop
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          status.data && (
            <p className="text-[11px] text-zinc-500">
              No failed indexing jobs. Completed jobs are pruned automatically
              after a while.
            </p>
          )
        )}
      </div>
    </section>
  );
}
