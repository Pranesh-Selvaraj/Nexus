import { useRef, useState } from 'react';
import type { FormEvent } from 'react';

import type { WorkspaceArchive } from '@nexus/shared-types';

import { useToast } from '../../components/Toast';
import { trpc } from '../../lib/trpc';

interface Props {
  onOpenTopic: (topicId: string) => void;
  /** Opened through "New topic" on the dashboard. */
  autoCreate?: boolean;
}

/**
 * The topic gallery: every learning space with its size and due work, plus
 * creation and workspace import.
 */
export function TopicsPage({ onOpenTopic, autoCreate = false }: Props) {
  const utils = trpc.useUtils();
  const toast = useToast();
  const overview = trpc.dashboard.overview.useQuery(undefined);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(autoCreate);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);

  const create = trpc.workspace.create.useMutation({
    onSuccess: async (workspace) => {
      await utils.workspace.list.invalidate();
      await utils.dashboard.overview.invalidate();
      setCreating(false);
      setName('');
      setDescription('');
      onOpenTopic(workspace.id);
    },
    onError: (err) =>
      toast.push({
        kind: 'error',
        message: `Could not create topic: ${err.message}`,
      }),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    create.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
    });
  }

  async function importArchive(file: File | undefined) {
    if (!file) return;
    setImporting(true);
    try {
      let parsed: WorkspaceArchive;
      try {
        parsed = JSON.parse(await file.text()) as WorkspaceArchive;
      } catch {
        throw new Error('not valid JSON');
      }
      if (parsed.version !== 1 || !parsed.workspace?.name) {
        throw new Error('not a valid Nexus workspace archive');
      }
      const form = new FormData();
      form.append('archive', file);
      const response = await fetch('/api/workspace/import', {
        method: 'POST',
        body: form,
      });
      const body = (await response.json().catch(() => null)) as {
        workspace?: { id: string };
        error?: string;
      } | null;
      if (!response.ok || !body?.workspace) {
        throw new Error(body?.error ?? `Import failed (${response.status})`);
      }
      await utils.workspace.list.invalidate();
      await utils.dashboard.overview.invalidate();
      toast.push({ kind: 'success', message: 'Topic imported' });
      onOpenTopic(body.workspace.id);
    } catch (err) {
      toast.push({
        kind: 'error',
        message: `Import failed: ${err instanceof Error ? err.message : 'invalid file'}`,
      });
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  const topics = (overview.data?.topics ?? []).filter((topic) =>
    topic.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-5 py-8 md:px-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Your topics</h1>
            <p className="mt-1 max-w-xl text-sm text-zinc-400">
              One topic per thing you are learning. Add sources, ask questions,
              generate practice and review what matters.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search topics"
              className="w-44 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-nexus-500 focus:outline-none"
            />
            <button
              onClick={() => fileInput.current?.click()}
              disabled={importing}
              className="rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
            >
              {importing ? 'Importing...' : 'Import backup'}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(event) => void importArchive(event.target.files?.[0])}
            />
            <button
              onClick={() => setCreating(true)}
              className="rounded-xl bg-nexus-600 px-4 py-2 text-sm font-semibold text-white hover:bg-nexus-500"
            >
              + New topic
            </button>
          </div>
        </header>

        {creating && (
          <form
            onSubmit={submit}
            className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4"
          >
            <h2 className="text-sm font-semibold text-zinc-200">New topic</h2>
            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <label className="text-[11px] text-zinc-500">
                Topic name
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Spanish B1, Linear algebra, Art history"
                  maxLength={80}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-nexus-500 focus:outline-none"
                />
              </label>
              <label className="text-[11px] text-zinc-500">
                What do you want to learn? (optional)
                <input
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="A goal, a course, an exam..."
                  maxLength={200}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-nexus-500 focus:outline-none"
                />
              </label>
              <div className="flex items-end gap-2">
                <button
                  type="submit"
                  disabled={create.isPending || !name.trim()}
                  className="rounded-lg bg-nexus-600 px-4 py-2 text-sm font-semibold text-white hover:bg-nexus-500 disabled:opacity-40"
                >
                  {create.isPending ? 'Creating...' : 'Create'}
                </button>
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          </form>
        )}

        {overview.isLoading && (
          <p className="mt-8 text-sm text-zinc-500">Loading topics...</p>
        )}

        {!overview.isLoading && topics.length === 0 && (
          <div className="mt-8 rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/30 p-10 text-center">
            <h2 className="text-lg font-semibold text-zinc-200">
              {query
                ? 'No topic matches that search'
                : 'Your first topic awaits'}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-zinc-400">
              {query
                ? 'Try another word, or clear the search.'
                : 'Create a topic for whatever you want to learn, then add a PDF, a web page, a lecture recording or an image.'}
            </p>
          </div>
        )}

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {topics.map((topic) => (
            <article
              key={topic.id}
              className="group flex flex-col rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 transition-colors hover:border-nexus-700/60"
            >
              <button
                onClick={() => onOpenTopic(topic.id)}
                className="text-left"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="min-w-0 truncate text-sm font-semibold text-zinc-100">
                    {topic.name}
                  </h2>
                  {topic.dueCount > 0 && (
                    <span className="shrink-0 rounded-full bg-amber-950/60 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                      {topic.dueCount} due
                    </span>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 min-h-[2.2em] text-[11px] leading-relaxed text-zinc-500">
                  {topic.description ?? 'No description yet'}
                </p>
              </button>
              <div className="mt-3 flex items-center justify-between text-[11px] text-zinc-500">
                <span>
                  {topic.documentCount} source
                  {topic.documentCount === 1 ? '' : 's'}
                  {topic.processingCount > 0 && (
                    <span className="text-amber-400">
                      {' '}
                      · {topic.processingCount} processing
                    </span>
                  )}
                </span>
                <button
                  onClick={() => onOpenTopic(topic.id)}
                  className="rounded-lg bg-zinc-800 px-2.5 py-1 text-[11px] text-zinc-200 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                >
                  Open →
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
