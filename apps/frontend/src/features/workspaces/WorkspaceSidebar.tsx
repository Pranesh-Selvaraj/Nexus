import { useState } from 'react';
import type { FormEvent } from 'react';

import type { WorkspaceDTO } from '@nexus/shared-types';

import { NexusLogo } from '../../App';
import { trpc } from '../../lib/trpc';

interface Props {
  activeWorkspaceId: string | null;
  onSelect: (workspaceId: string) => void;
}

export function WorkspaceSidebar({ activeWorkspaceId, onSelect }: Props) {
  const utils = trpc.useUtils();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const workspaces = trpc.workspace.list.useQuery(undefined);
  const createWorkspace = trpc.workspace.create.useMutation({
    onSuccess: (created) => {
      void utils.workspace.list.invalidate();
      setCreating(false);
      setNewName('');
      onSelect(created.id);
    },
  });
  const deleteWorkspace = trpc.workspace.delete.useMutation({
    onSuccess: () => void utils.workspace.list.invalidate(),
  });

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    createWorkspace.mutate({ name });
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/40">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-4">
        <NexusLogo className="h-7 w-7 text-nexus-400" />
        <span className="text-lg font-bold tracking-tight">Nexus</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Workspaces
        </p>

        <div className="space-y-1">
          {workspaces.data?.map((ws: WorkspaceDTO) => (
            <div key={ws.id} className="group relative">
              <button
                onClick={() => onSelect(ws.id)}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  activeWorkspaceId === ws.id
                    ? 'bg-nexus-600/20 text-nexus-200 ring-1 ring-nexus-600/40'
                    : 'text-zinc-300 hover:bg-zinc-800'
                }`}
              >
                <span className="block truncate font-medium">{ws.name}</span>
                <span className="text-xs text-zinc-500">
                  {ws.documentCount} document{ws.documentCount === 1 ? '' : 's'}
                </span>
              </button>
              <button
                title="Delete workspace"
                onClick={() => {
                  if (
                    confirm(
                      `Delete workspace "${ws.name}" and all its documents?`,
                    )
                  ) {
                    deleteWorkspace.mutate({ workspaceId: ws.id });
                  }
                }}
                className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded p-1 text-zinc-500 hover:bg-zinc-700 hover:text-red-400 group-hover:block"
              >
                <TrashIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}

          {workspaces.data?.length === 0 && (
            <p className="px-2 py-3 text-xs text-zinc-600">
              No workspaces yet. Create one below.
            </p>
          )}
        </div>
      </div>

      <div className="border-t border-zinc-800 p-3">
        {creating ? (
          <form onSubmit={handleCreate} className="space-y-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Workspace name"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-nexus-500"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={createWorkspace.isPending || !newName.trim()}
                className="flex-1 rounded-lg bg-nexus-600 py-1.5 text-xs font-semibold text-white hover:bg-nexus-500 disabled:opacity-50"
              >
                {createWorkspace.isPending ? 'Creating...' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-700 py-2 text-sm text-zinc-400 transition-colors hover:border-nexus-500 hover:text-nexus-300"
          >
            <PlusIcon className="h-4 w-4" /> New workspace
          </button>
        )}

        <div className="mt-3 flex items-center gap-2 border-t border-zinc-800 pt-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-nexus-700 text-xs font-bold text-white">
            N
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">Local mode</p>
            <p className="truncate text-xs text-zinc-500">
              Single user · data stays in postgres
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
    >
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
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
