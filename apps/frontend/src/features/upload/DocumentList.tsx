import type { DocumentDTO } from '@nexus/shared-types';

import { useToast } from '../../components/Toast';
import { trpc } from '../../lib/trpc';

interface Props {
  workspaceId: string;
}

export function DocumentList({ workspaceId }: Props) {
  const utils = trpc.useUtils();
  const toast = useToast();
  const query = trpc.document.listByWorkspace.useQuery(
    { workspaceId },
    {
      // v5: refetchInterval receives the Query, not the data
      refetchInterval: (query) =>
        query.state.data?.some((doc) => doc.status === 'processing')
          ? 2_000
          : false,
    },
  );

  const invalidateDocuments = () => {
    void utils.document.listByWorkspace.invalidate({ workspaceId });
    // The sidebar count comes from workspace.list; keep it in sync.
    void utils.workspace.list.invalidate();
  };

  const removeDocument = trpc.document.remove.useMutation({
    onSuccess: invalidateDocuments,
    onError: (err) =>
      toast.push({ kind: 'error', message: `Delete failed: ${err.message}` }),
  });
  const retryDocument = trpc.document.retry.useMutation({
    onSuccess: invalidateDocuments,
    onError: (err) =>
      toast.push({ kind: 'error', message: `Retry failed: ${err.message}` }),
  });

  const documents = query.data ?? [];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <p className="px-4 pb-2 pt-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Documents <span className="text-zinc-600">({documents.length})</span>
      </p>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {query.isLoading && (
          <p className="px-1 py-2 text-xs text-zinc-600">Loading...</p>
        )}

        {!query.isLoading && documents.length === 0 && (
          <p className="px-1 py-2 text-xs text-zinc-600">
            No documents uploaded yet.
          </p>
        )}

        <ul className="space-y-2">
          {documents.map((doc) => (
            <DocumentRow
              key={doc.id}
              doc={doc}
              onDelete={() => removeDocument.mutate({ documentId: doc.id })}
              onRetry={() => retryDocument.mutate({ documentId: doc.id })}
              isDeleting={removeDocument.isPending}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

interface RowProps {
  doc: DocumentDTO;
  onDelete: () => void;
  onRetry: () => void;
  isDeleting: boolean;
}

function DocumentRow({ doc, onDelete, onRetry, isDeleting }: RowProps) {
  const status = doc.status;
  return (
    <li className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <FileIcon className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
          <div className="min-w-0">
            <p
              className="truncate text-sm font-medium text-zinc-200"
              title={doc.title}
            >
              {doc.title}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              {status === 'ready'
                ? `${doc.chunkCount} chunk${doc.chunkCount === 1 ? '' : 's'} indexed`
                : status === 'failed'
                  ? `Failed after ${doc.attempts} attempt${doc.attempts === 1 ? '' : 's'}`
                  : new Date(doc.createdAt).toLocaleString()}
            </p>
            {status === 'failed' && doc.errorMessage && (
              <p
                className="mt-1 line-clamp-3 text-xs text-red-400"
                title={doc.errorMessage}
              >
                {doc.errorMessage}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {doc.needsReindex && (
            <span
              title="Indexed with a different embedding setup - re-index to use the current model"
              className="rounded-full bg-amber-950/50 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-400"
            >
              reindex
            </span>
          )}
          <StatusBadge status={status} />
          {status === 'failed' && (
            <button
              title="Retry indexing"
              aria-label="Retry indexing"
              onClick={onRetry}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            >
              <RetryIcon className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            title="Delete document"
            aria-label="Delete document"
            onClick={onDelete}
            disabled={isDeleting}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-50"
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </li>
  );
}

function StatusBadge({ status }: { status: DocumentDTO['status'] }) {
  const styles: Record<DocumentDTO['status'], string> = {
    processing: 'bg-amber-950/50 text-amber-400 animate-pulse',
    ready: 'bg-emerald-950/50 text-emerald-400',
    failed: 'bg-red-950/50 text-red-400',
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${styles[status]}`}
    >
      {status}
    </span>
  );
}

function FileIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
    >
      <path
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
        strokeLinejoin="round"
      />
      <path d="M14 2v6h6M9 13h6M9 17h6" strokeLinecap="round" />
    </svg>
  );
}

function RetryIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
    >
      <path
        d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
    >
      <path
        d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
