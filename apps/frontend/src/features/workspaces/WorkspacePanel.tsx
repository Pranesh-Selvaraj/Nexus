import { ChatPanel } from '../chat/ChatPanel';
import { DocumentList } from '../upload/DocumentList';
import { UploadDropzone } from '../upload/UploadDropzone';
import { useToast } from '../../components/Toast';
import { trpc } from '../../lib/trpc';

interface Props {
  workspaceId: string;
}

export function WorkspacePanel({ workspaceId }: Props) {
  const toast = useToast();
  const utils = trpc.useUtils();
  const exportWorkspace = trpc.workspace.export.useQuery(
    { workspaceId },
    { enabled: false, retry: false },
  );

  // Embedding provenance: documents whose chunks were embedded with another
  // model/dimensions/version are flagged so the user can re-index in bulk
  // instead of hitting a dimension error mid-chat.
  const retrievalStatus = trpc.document.retrievalStatus.useQuery(
    { workspaceId },
    {
      refetchInterval: (query) =>
        query.state.data?.documentsReindexing ? 2_000 : false,
    },
  );
  const reindexAll = trpc.document.reindexAll.useMutation({
    onSuccess: () => {
      void utils.document.retrievalStatus.invalidate({ workspaceId });
      void utils.document.listByWorkspace.invalidate({ workspaceId });
    },
    onError: (err) =>
      toast.push({ kind: 'error', message: `Re-index failed: ${err.message}` }),
  });

  const needsReindex = retrievalStatus.data?.documentsNeedingReindex ?? 0;
  const reindexing = retrievalStatus.data?.documentsReindexing ?? 0;

  async function handleExport() {
    try {
      const data = await exportWorkspace.refetch();
      if (!data.data) return;
      const blob = new Blob([JSON.stringify(data.data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = data.data.workspace.name
        .replace(/[^a-z0-9-_]+/gi, '-')
        .toLowerCase();
      a.href = url;
      a.download = `nexus-${safeName || 'workspace'}-${new Date()
        .toISOString()
        .slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.push({ kind: 'error', message: 'Export failed' });
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col xl:flex-row">
      <ChatPanel workspaceId={workspaceId} />
      {/* Below xl the document panel stacks under the chat instead of
          squeezing it into an unusable column. */}
      <aside className="flex max-h-[45vh] w-full shrink-0 flex-col border-t border-zinc-800 bg-zinc-900/40 xl:max-h-none xl:w-80 xl:border-l xl:border-t-0">
        {(needsReindex > 0 || reindexing > 0) && (
          <div className="border-b border-amber-900/50 bg-amber-950/25 p-3 text-xs text-amber-300">
            {needsReindex > 0 ? (
              <>
                <p>
                  <strong>
                    {needsReindex} document{needsReindex === 1 ? '' : 's'}
                  </strong>{' '}
                  {needsReindex === 1 ? 'was' : 'were'} indexed with a different
                  embedding setup. Re-index to use the current model.
                </p>
                <button
                  onClick={() => reindexAll.mutate({ workspaceId })}
                  disabled={reindexAll.isPending}
                  className="mt-2 w-full rounded-lg bg-amber-600/80 py-1.5 font-semibold text-amber-50 transition-colors hover:bg-amber-500 disabled:opacity-50"
                >
                  {reindexAll.isPending
                    ? 'Queuing...'
                    : `Re-index ${needsReindex} document${needsReindex === 1 ? '' : 's'}`}
                </button>
              </>
            ) : (
              <p className="animate-pulse">
                Re-indexing {reindexing} document{reindexing === 1 ? '' : 's'}
                ...
              </p>
            )}
          </div>
        )}
        <UploadDropzone workspaceId={workspaceId} />
        <DocumentList workspaceId={workspaceId} />
        <div className="border-t border-zinc-800 p-3">
          <button
            onClick={() => void handleExport()}
            disabled={exportWorkspace.isFetching}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800 disabled:opacity-40"
          >
            <DownloadIcon className="h-3.5 w-3.5" />
            {exportWorkspace.isFetching
              ? 'Exporting...'
              : 'Export workspace (backup)'}
          </button>
          {exportWorkspace.isError && (
            <p className="mt-2 text-center text-[11px] text-red-400">
              Export failed
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
      aria-hidden
    >
      <path
        d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
