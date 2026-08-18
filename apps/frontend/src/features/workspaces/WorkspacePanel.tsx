import { ChatPanel } from '../chat/ChatPanel';
import { DocumentList } from '../upload/DocumentList';
import { UploadDropzone } from '../upload/UploadDropzone';
import { trpc } from '../../lib/trpc';

interface Props {
  workspaceId: string;
}

export function WorkspacePanel({ workspaceId }: Props) {
  const exportWorkspace = trpc.workspace.export.useQuery(
    { workspaceId },
    { enabled: false, retry: false },
  );

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
      // refetch errors surface in the UI below
    }
  }

  return (
    <div className="flex h-full">
      <ChatPanel workspaceId={workspaceId} />
      <aside className="flex w-80 shrink-0 flex-col border-l border-zinc-800 bg-zinc-900/40">
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
