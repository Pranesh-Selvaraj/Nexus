import { trpc } from '../../lib/trpc';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

/**
 * Storage dashboard (P-6): how much disk the workspace owns, how much of the
 * quota that is, and how many documents are waiting in the trash. Trashed
 * documents still count toward the quota until the purge window elapses.
 */
export function StorageCard() {
  const usage = trpc.storage.usage.useQuery(undefined);

  return (
    <section className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900/40">
      <h2 className="border-b border-zinc-800 px-5 py-3 text-sm font-semibold">
        Storage
      </h2>
      <div className="space-y-3 p-5">
        {usage.isLoading && (
          <p className="text-xs text-zinc-500">Loading usage...</p>
        )}
        {usage.data && (
          <>
            <div>
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-zinc-300">
                  {formatBytes(usage.data.usedBytes)} used
                  {usage.data.quotaBytes > 0 &&
                    ` of ${formatBytes(usage.data.quotaBytes)}`}
                </span>
                <span className="text-zinc-500">
                  {usage.data.documentCount} document
                  {usage.data.documentCount === 1 ? '' : 's'}
                  {usage.data.trashedCount > 0 &&
                    ` · ${usage.data.trashedCount} in trash`}
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-nexus-500"
                  style={{
                    width: `${usage.data.quotaBytes > 0 ? Math.min(100, (usage.data.usedBytes / usage.data.quotaBytes) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>

            <ul className="space-y-1">
              {usage.data.byWorkspace
                .filter((workspace) => workspace.bytes > 0)
                .slice(0, 5)
                .map((workspace) => (
                  <li
                    key={workspace.workspaceId}
                    className="flex items-center justify-between text-[11px] text-zinc-500"
                  >
                    <span className="min-w-0 truncate">{workspace.name}</span>
                    <span className="shrink-0 tabular-nums">
                      {formatBytes(workspace.bytes)}
                    </span>
                  </li>
                ))}
            </ul>

            <p className="text-[11px] leading-relaxed text-zinc-600">
              Trashed documents stay restorable for {usage.data.trashDays} day
              {usage.data.trashDays === 1 ? '' : 's'} (Storage &amp; trash
              settings) and still count toward the quota until the maintenance
              job purges them. A quota of 0 disables the limit.
            </p>
          </>
        )}
        {usage.isError && (
          <p className="text-xs text-red-400">
            Could not load storage usage: {usage.error.message}
          </p>
        )}
      </div>
    </section>
  );
}
