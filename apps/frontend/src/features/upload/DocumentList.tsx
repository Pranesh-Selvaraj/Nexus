import { useState } from 'react';

import type { DocumentDTO } from '@nexus/shared-types';

import { useToast } from '../../components/Toast';
import { trpc } from '../../lib/trpc';
import {
  documentChips,
  documentImageUrl,
  documentSourceUrl,
  formatLabel,
  isImageDocument,
  structureSummary,
} from '../../lib/document-format';
import { ImageAnalysisPanel } from '../vision/ImageAnalysisPanel';

interface Props {
  workspaceId: string;
  /** Readers can browse and ask, but not retry/delete/generate. */
  readOnly?: boolean;
}

export function DocumentList({ workspaceId, readOnly = false }: Props) {
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
  // Vision is a capability: when no vision provider is configured the
  // "Analyse" affordance is hidden instead of failing after the click.
  const vision = trpc.vision.config.useQuery(undefined);
  const [analysing, setAnalysing] = useState<DocumentDTO | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);

  const invalidateDocuments = () => {
    void utils.document.listByWorkspace.invalidate({ workspaceId });
    void utils.document.images.invalidate({ workspaceId });
    // The sidebar count comes from workspace.list; keep it in sync.
    void utils.workspace.list.invalidate();
  };

  const restoreDocument = trpc.document.restore.useMutation({
    onSuccess: () => {
      invalidateDocuments();
      void utils.document.listTrashed.invalidate({ workspaceId });
    },
    onError: (err) =>
      toast.push({ kind: 'error', message: `Restore failed: ${err.message}` }),
  });
  const removeDocument = trpc.document.remove.useMutation({
    onSuccess: (_data, variables) => {
      invalidateDocuments();
      if (trashOpen) {
        void utils.document.listTrashed.invalidate({ workspaceId });
      }
      toast.push({
        kind: 'info',
        message: 'Moved to trash',
        action: {
          label: 'Undo',
          onClick: () =>
            restoreDocument.mutate({ documentId: variables.documentId }),
        },
      });
    },
    onError: (err) =>
      toast.push({ kind: 'error', message: `Delete failed: ${err.message}` }),
  });
  const trashed = trpc.document.listTrashed.useQuery(
    { workspaceId },
    { enabled: trashOpen },
  );
  const emptyTrash = trpc.document.emptyTrash.useMutation({
    onSuccess: (result) => {
      invalidateDocuments();
      void utils.document.listTrashed.invalidate({ workspaceId });
      toast.push({
        kind: 'success',
        message: `Permanently deleted ${result.purged} document${result.purged === 1 ? '' : 's'}`,
      });
    },
    onError: (err) =>
      toast.push({
        kind: 'error',
        message: `Empty trash failed: ${err.message}`,
      }),
  });
  const retryDocument = trpc.document.retry.useMutation({
    onSuccess: invalidateDocuments,
    onError: (err) =>
      toast.push({ kind: 'error', message: `Retry failed: ${err.message}` }),
  });
  const generateCards = trpc.study.cards.generate.useMutation({
    onSuccess: (data) => {
      toast.push({
        kind: 'success',
        message: `Created ${data.created.length} flashcard${data.created.length === 1 ? '' : 's'} — open Study to review.`,
      });
      void utils.study.progress.invalidate({ workspaceId });
      void utils.study.decks.list.invalidate({ workspaceId });
    },
    onError: (err) =>
      toast.push({ kind: 'error', message: `Cards failed: ${err.message}` }),
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
            No documents uploaded yet. Drop a book, a web link, an image or a
            recording above.
          </p>
        )}

        <ul className="space-y-2">
          {documents.map((doc) => (
            <DocumentRow
              key={doc.id}
              doc={doc}
              visionAvailable={Boolean(
                vision.data?.enabled && vision.data?.available,
              )}
              onAnalyse={() => setAnalysing(doc)}
              readOnly={readOnly}
              onDelete={() => removeDocument.mutate({ documentId: doc.id })}
              onRetry={() => retryDocument.mutate({ documentId: doc.id })}
              onMakeCards={() =>
                generateCards.mutate({
                  workspaceId,
                  documentId: doc.id,
                  count: 8,
                })
              }
              isDeleting={removeDocument.isPending}
            />
          ))}
        </ul>

        <div className="mt-3 border-t border-zinc-800 pt-2">
          <button
            onClick={() => setTrashOpen((open) => !open)}
            className="w-full rounded-lg px-2 py-1.5 text-left text-[11px] text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-300"
            aria-expanded={trashOpen}
          >
            {trashOpen ? 'Hide trash' : 'Show trash'}
          </button>
          {trashOpen && (
            <div className="mt-1.5 space-y-1.5">
              {trashed.isLoading && (
                <p className="px-2 text-[11px] text-zinc-600">
                  Loading trash...
                </p>
              )}
              {trashed.data?.length === 0 && (
                <p className="px-2 text-[11px] text-zinc-600">
                  Trash is empty.
                </p>
              )}
              {trashed.data?.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 px-2 py-1.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[11px] text-zinc-300">
                      {doc.title}
                    </p>
                    <p className="text-[10px] text-zinc-600">
                      deleted{' '}
                      {doc.deletedAt
                        ? new Date(doc.deletedAt).toLocaleDateString()
                        : 'recently'}
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      restoreDocument.mutate({ documentId: doc.id })
                    }
                    disabled={restoreDocument.isPending}
                    className="shrink-0 rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
                  >
                    Restore
                  </button>
                </div>
              ))}
              {(trashed.data?.length ?? 0) > 0 && (
                <button
                  onClick={() => emptyTrash.mutate({ workspaceId })}
                  disabled={emptyTrash.isPending}
                  className="w-full rounded-lg border border-red-900/60 px-2 py-1.5 text-[11px] text-red-400 transition-colors hover:bg-red-950/40 disabled:opacity-40"
                >
                  {emptyTrash.isPending
                    ? 'Deleting...'
                    : 'Empty trash permanently'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {analysing && (
        <ImageAnalysisPanel
          workspaceId={workspaceId}
          doc={analysing}
          onClose={() => setAnalysing(null)}
        />
      )}
    </div>
  );
}

interface RowProps {
  doc: DocumentDTO;
  visionAvailable: boolean;
  readOnly: boolean;
  onAnalyse: () => void;
  onDelete: () => void;
  onRetry: () => void;
  onMakeCards: () => void;
  isDeleting: boolean;
}

function DocumentRow({
  doc,
  visionAvailable,
  readOnly,
  onAnalyse,
  onDelete,
  onRetry,
  onMakeCards,
  isDeleting,
}: RowProps) {
  const status = doc.status;
  const image = isImageDocument(doc);
  const chips = documentChips(doc.metadata);
  const summary = structureSummary(doc.metadata);
  const sourceUrl = documentSourceUrl(doc);
  const chapters = doc.metadata?.chapters ?? [];
  const canAnalyse = image && status === 'ready' && visionAvailable;

  return (
    <li className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {image && status !== 'failed' ? (
            <img
              src={documentImageUrl(doc.id)}
              alt=""
              loading="lazy"
              className="h-10 w-10 shrink-0 rounded border border-zinc-800 object-cover"
            />
          ) : (
            <FileIcon className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
          )}
          <div className="min-w-0">
            <p
              className="truncate text-sm font-medium text-zinc-200"
              title={doc.title}
            >
              {doc.title}
            </p>
            {(formatLabel(doc.fileType) || summary.length > 0) &&
              status !== 'failed' && (
                <p className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-zinc-500">
                  {formatLabel(doc.fileType) && (
                    <span className="shrink-0 rounded bg-zinc-800 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-zinc-400">
                      {formatLabel(doc.fileType)}
                    </span>
                  )}
                  <span
                    className="min-w-0 truncate"
                    title={summary.join(' · ')}
                  >
                    {summary.join(' · ')}
                  </span>
                </p>
              )}
            <p className="mt-0.5 text-xs text-zinc-500">
              {status === 'ready'
                ? `${doc.chunkCount} chunk${doc.chunkCount === 1 ? '' : 's'} indexed`
                : status === 'failed'
                  ? `Failed after ${doc.attempts} attempt${doc.attempts === 1 ? '' : 's'}`
                  : new Date(doc.createdAt).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
            </p>
            {chips.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {chips.map((chip) => (
                  <span
                    key={chip.label}
                    title={chip.title}
                    className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                      chip.tone === 'warn'
                        ? 'bg-amber-950/50 text-amber-400'
                        : 'bg-nexus-600/20 text-nexus-300'
                    }`}
                  >
                    {chip.label}
                  </span>
                ))}
              </div>
            )}
            {sourceUrl && status !== 'failed' && (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-1 block truncate text-[11px] text-nexus-300 underline-offset-2 hover:underline"
                title={sourceUrl}
              >
                {sourceUrl.replace(/^https?:\/\//, '')}
              </a>
            )}
            {status === 'failed' && doc.errorMessage && (
              <p
                className="mt-1 line-clamp-3 text-xs text-red-400"
                title={doc.errorMessage}
              >
                {doc.errorMessage}
              </p>
            )}
            {chapters.length > 0 && status === 'ready' && (
              <details className="mt-1">
                <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-zinc-600 hover:text-zinc-400">
                  Contents ({chapters.length})
                </summary>
                <ol className="mt-1 max-h-32 space-y-0.5 overflow-y-auto pr-1">
                  {chapters.slice(0, 60).map((chapter, index) => (
                    <li
                      key={`${chapter.page}-${index}`}
                      className="flex items-baseline gap-1.5 text-[11px] text-zinc-500"
                    >
                      <span className="shrink-0 font-mono text-[9px] text-zinc-600">
                        {chapter.page}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {chapter.title}
                      </span>
                    </li>
                  ))}
                </ol>
              </details>
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
          {canAnalyse && (
            <button
              title="Analyse this image with the vision model"
              aria-label="Analyse image"
              onClick={onAnalyse}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-nexus-300"
            >
              <EyeIcon className="h-3.5 w-3.5" />
            </button>
          )}
          {status === 'ready' && (
            <button
              title="Generate flashcards from this document"
              aria-label="Generate flashcards"
              onClick={onMakeCards}
              hidden={readOnly}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-nexus-300"
            >
              <CardsIcon className="h-3.5 w-3.5" />
            </button>
          )}
          {status === 'failed' && (
            <button
              title="Retry indexing"
              aria-label="Retry indexing"
              onClick={onRetry}
              hidden={readOnly}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            >
              <RetryIcon className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            title="Delete document"
            aria-label="Delete document"
            onClick={onDelete}
            hidden={readOnly}
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
    deleted: 'bg-zinc-800 text-zinc-400',
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

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
    >
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

function CardsIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
    >
      <rect x="3" y="5" width="14" height="10" rx="2" />
      <path d="M7 19h12a2 2 0 0 0 2-2V9" strokeLinecap="round" />
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
