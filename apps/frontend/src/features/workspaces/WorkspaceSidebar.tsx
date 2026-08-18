import { useState } from 'react';
import type { FormEvent } from 'react';

import { useRef } from 'react';
import type {
  UserDTO,
  WorkspaceArchive,
  WorkspaceDTO,
} from '@nexus/shared-types';

import { logout } from '../../lib/auth';
import { NexusLogo } from '../../App';
import { trpc } from '../../lib/trpc';

interface Props {
  activeWorkspaceId: string | null;
  onSelect: (workspaceId: string) => void;
  user: UserDTO;
  onLoggedOut: () => void;
  onOpenSettings: () => void;
  settingsActive: boolean;
  appName: string;
}

export function WorkspaceSidebar({
  activeWorkspaceId,
  onSelect,
  user,
  onLoggedOut,
  onOpenSettings,
  settingsActive,
  appName,
}: Props) {
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const importWorkspace = trpc.workspace.import.useMutation({
    onSuccess: (ws) => {
      onSelect(ws.id);
      void utils.workspace.list.invalidate();
    },
    onError: (err) => {
      window.alert(`Import failed: ${err.message}`);
    },
  });

  async function handleImportFile(file: File | undefined) {
    if (!file) return;
    try {
      const archive = (await file.text()) as unknown;
      const parsed = JSON.parse(archive as string) as WorkspaceArchive;
      if (parsed.version !== 1 || !parsed.workspace?.name) {
        throw new Error('Not a valid Nexus workspace archive');
      }
      importWorkspace.mutate({ archive: parsed });
    } catch (err) {
      window.alert(
        `Import failed: ${err instanceof Error ? err.message : 'invalid file'}`,
      );
    }
  }
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
        <span className="text-lg font-bold tracking-tight">{appName}</span>
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

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={importWorkspace.isPending}
          className={`mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors disabled:opacity-40 ${
            importWorkspace.isPending
              ? 'text-zinc-500'
              : 'text-zinc-400 hover:bg-zinc-800'
          }`}
        >
          <UploadIcon className="h-4 w-4" />
          {importWorkspace.isPending
            ? 'Importing workspace...'
            : 'Import workspace'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            void handleImportFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />

        <button
          onClick={onOpenSettings}
          className={`mt-3 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
            settingsActive
              ? 'bg-nexus-600/20 text-nexus-200 ring-1 ring-nexus-600/40'
              : 'text-zinc-400 hover:bg-zinc-800'
          }`}
        >
          <SettingsIcon className="h-4 w-4" /> Settings
        </button>

        <div className="mt-3 flex items-center gap-2 border-t border-zinc-800 pt-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-nexus-700 text-xs font-bold text-white">
            N
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {user.name ?? user.email}
            </p>
            <p className="truncate text-xs text-zinc-500">{user.email}</p>
          </div>
          <button
            title="Sign out"
            onClick={() => {
              void logout().finally(onLoggedOut);
            }}
            className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            <LogoutIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}

function UploadIcon({ className }: { className?: string }) {
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
        d="M12 16V4m0 0 4 4m-4-4-4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
      aria-hidden
    >
      <circle cx="12" cy="12" r="3" />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LogoutIcon({ className }: { className?: string }) {
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
        d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
