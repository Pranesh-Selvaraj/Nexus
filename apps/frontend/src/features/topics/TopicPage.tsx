import { useState } from 'react';

import { ChatPanel } from '../chat/ChatPanel';
import { LanguagePanel } from '../language/LanguagePanel';
import { ShareDialog } from '../share/ShareDialog';
import { StudyPanel } from '../study/StudyPanel';
import { DocumentList } from '../upload/DocumentList';
import { UploadDropzone } from '../upload/UploadDropzone';
import { VoiceChatPanel } from '../voice/VoiceChatPanel';
import { useToast } from '../../components/Toast';
import { trpc } from '../../lib/trpc';

type Tab = 'learn' | 'practice' | 'voice' | 'language';

interface Props {
  workspaceId: string;
  onBack: () => void;
  onDeleted: () => void;
  onOpenSettings: () => void;
  initialTab?: Tab;
  initialStudyTab?: 'dashboard' | 'review';
}

const TABS: { id: Tab; label: string; hint: string }[] = [
  {
    id: 'learn',
    label: 'Learn',
    hint: 'Ask questions grounded in your sources',
  },
  {
    id: 'practice',
    label: 'Practice',
    hint: 'Quizzes, flashcards, notes and progress',
  },
  { id: 'voice', label: 'Voice', hint: 'Talk to your tutor' },
  {
    id: 'language',
    label: 'Language',
    hint: 'Vocabulary, dictation, pronunciation',
  },
];

/**
 * One learning topic: chat with the sources, practise, use voice/language
 * activities and manage the library, in a single focused space.
 */
export function TopicPage({
  workspaceId,
  onBack,
  onDeleted,
  onOpenSettings,
  initialTab = 'learn',
  initialStudyTab,
}: Props) {
  const toast = useToast();
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [shareOpen, setShareOpen] = useState(false);
  const workspaces = trpc.workspace.list.useQuery(undefined);
  const workspace = workspaces.data?.find((item) => item.id === workspaceId);
  const voiceConfig = trpc.voice.config.useQuery(undefined);

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

  const deleteTopic = trpc.workspace.delete.useMutation({
    onSuccess: async () => {
      await utils.workspace.list.invalidate();
      await utils.dashboard.overview.invalidate();
      toast.push({ kind: 'info', message: 'Topic deleted' });
      onDeleted();
    },
    onError: (err) =>
      toast.push({ kind: 'error', message: `Delete failed: ${err.message}` }),
  });

  async function handleExport() {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/export.zip`, {
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get('content-disposition') ?? '';
      const fileName =
        /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'nexus-workspace.zip';
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.push({
        kind: 'error',
        message: `Export failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  function handleDelete() {
    if (
      !window.confirm(
        `Delete "${workspace?.name ?? 'this topic'}" and all its documents and conversations? This cannot be undone.`,
      )
    ) {
      return;
    }
    deleteTopic.mutate({ workspaceId });
  }

  if (!workspace) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-zinc-500">Loading topic...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Topic header: identity, activity and workspace actions. */}
      <header className="border-b border-zinc-800/80 bg-zinc-950/80 px-4 py-3 md:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <button
              onClick={onBack}
              className="text-[11px] text-zinc-500 hover:text-zinc-300"
            >
              ← All topics
            </button>
            <h1 className="mt-0.5 truncate text-xl font-bold tracking-tight">
              {workspace.name}
            </h1>
            <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500">
              {workspace.description ??
                'Ask, practise and review everything in this topic.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full border border-zinc-800 px-2.5 py-1 text-[11px] text-zinc-400">
              {workspace.documentCount} source
              {workspace.documentCount === 1 ? '' : 's'}
            </span>
            {retrievalStatus.data &&
              retrievalStatus.data.documentsNeedingReindex > 0 && (
                <button
                  onClick={() => reindexAll.mutate({ workspaceId })}
                  disabled={reindexAll.isPending}
                  className="rounded-full border border-amber-800/60 bg-amber-950/30 px-2.5 py-1 text-[11px] text-amber-300 hover:bg-amber-900/40 disabled:opacity-40"
                >
                  Re-index {retrievalStatus.data.documentsNeedingReindex}
                </button>
              )}
            {reindexing > 0 && (
              <span className="animate-pulse rounded-full border border-zinc-800 px-2.5 py-1 text-[11px] text-zinc-400">
                Re-indexing {reindexing}...
              </span>
            )}
            <button
              onClick={() => setShareOpen(true)}
              className="rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
            >
              Share
            </button>
            <button
              onClick={() => void handleExport()}
              className="rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
            >
              Export
            </button>
            <button
              onClick={handleDelete}
              disabled={deleteTopic.isPending}
              className="rounded-lg border border-red-900/50 px-2.5 py-1 text-[11px] text-red-400 hover:bg-red-950/40 disabled:opacity-40"
            >
              Delete
            </button>
          </div>
        </div>

        {(needsReindex > 0 || reindexing > 0) && (
          <p className="mt-2 text-[11px] text-amber-300/90">
            {needsReindex > 0
              ? `${needsReindex} document${needsReindex === 1 ? '' : 's'} used a different embedding setup; re-index to search them with the current model.`
              : `Re-indexing ${reindexing} document${reindexing === 1 ? '' : 's'}...`}
          </p>
        )}
      </header>

      {/* Learning modes. */}
      <nav
        className="flex items-center gap-1 overflow-x-auto border-b border-zinc-800/80 px-3 py-1.5"
        aria-label="Learning modes"
      >
        {TABS.map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            title={item.hint}
            aria-pressed={tab === item.id}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === item.id
                ? 'bg-nexus-600/20 text-nexus-100 ring-1 ring-nexus-600/40'
                : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {shareOpen && (
        <ShareDialog
          workspaceId={workspaceId}
          onClose={() => setShareOpen(false)}
        />
      )}

      {/* Learn keeps chat mounted so a stream survives tab switches. */}
      <div
        className={`min-h-0 flex-1 flex-col xl:flex-row ${
          tab === 'learn' ? 'flex' : 'hidden'
        }`}
      >
        <ChatPanel workspaceId={workspaceId} />
        <aside className="flex max-h-[45vh] w-full shrink-0 flex-col border-t border-zinc-800 bg-zinc-900/30 xl:max-h-none xl:w-80 xl:border-l xl:border-t-0">
          <div className="flex items-center justify-between px-4 pb-1 pt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Sources
            </p>
            <button
              onClick={onOpenSettings}
              className="text-[10px] text-zinc-600 hover:text-zinc-400"
              title="Document processing settings"
            >
              Settings
            </button>
          </div>
          <UploadDropzone workspaceId={workspaceId} />
          <DocumentList workspaceId={workspaceId} />
        </aside>
      </div>

      {tab === 'practice' && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <StudyPanel workspaceId={workspaceId} initialTab={initialStudyTab} />
        </div>
      )}
      {tab === 'voice' && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <VoiceChatPanel
            workspaceId={workspaceId}
            config={voiceConfig.data}
            onOpenChat={() => setTab('learn')}
          />
        </div>
      )}
      {tab === 'language' && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <LanguagePanel workspaceId={workspaceId} config={voiceConfig.data} />
        </div>
      )}
    </div>
  );
}
