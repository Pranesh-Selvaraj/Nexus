import { useState } from 'react';

import type { UserDTO } from '@nexus/shared-types';

import { NexusLogo } from '../../components/NexusLogo';
import { logout } from '../../lib/auth';
import { trpc } from '../../lib/trpc';

export type PortalPage = 'home' | 'topics' | 'topic' | 'settings';

interface Props {
  appName: string;
  user: UserDTO;
  page: PortalPage;
  topicId: string | null;
  onNavigate: (page: PortalPage) => void;
  onOpenTopic: (topicId: string) => void;
  onLoggedOut: () => void;
  onClose?: () => void;
}

/** Navigation for the learning portal: Home, Topics, quick topic access. */
export function PortalNav({
  appName,
  user,
  page,
  topicId,
  onNavigate,
  onOpenTopic,
  onLoggedOut,
  onClose,
}: Props) {
  const workspaces = trpc.workspace.list.useQuery(undefined);
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await logout();
    } finally {
      onLoggedOut();
    }
  }

  const itemClass = (active: boolean) =>
    `flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors ${
      active
        ? 'bg-nexus-600/15 text-nexus-100 ring-1 ring-nexus-600/30'
        : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
    }`;

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-zinc-800/80 bg-zinc-950">
      <div className="flex items-center justify-between px-4 py-4">
        <button
          onClick={() => onNavigate('home')}
          className="flex items-center gap-2 text-zinc-100"
          aria-label="Nexus home"
        >
          <NexusLogo className="h-6 w-6 text-nexus-400" />
          <span className="truncate text-sm font-semibold tracking-tight">
            {appName}
          </span>
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="rounded-lg border border-zinc-800 px-2 py-1 text-xs text-zinc-500 md:hidden"
          >
            Close
          </button>
        )}
      </div>

      <nav className="space-y-1 px-3" aria-label="Main">
        <button
          className={itemClass(page === 'home')}
          onClick={() => onNavigate('home')}
        >
          <span aria-hidden>⌂</span> Home
        </button>
        <button
          className={itemClass(page === 'topics')}
          onClick={() => onNavigate('topics')}
        >
          <span aria-hidden>▦</span> Topics
        </button>
      </nav>

      <div className="mt-5 flex min-h-0 flex-1 flex-col">
        <p className="px-4 text-[11px] font-semibold uppercase tracking-wider text-zinc-600">
          Your topics
        </p>
        <div className="mt-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-2">
          {workspaces.isLoading && (
            <p className="px-2 py-1 text-xs text-zinc-600">Loading...</p>
          )}
          {workspaces.data?.map((workspace) => {
            const active = page === 'topic' && topicId === workspace.id;
            return (
              <button
                key={workspace.id}
                onClick={() => onOpenTopic(workspace.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                  active
                    ? 'bg-zinc-800/80 text-zinc-100'
                    : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                }`}
              >
                <span className="min-w-0 truncate">{workspace.name}</span>
                <span className="shrink-0 text-[10px] text-zinc-600">
                  {workspace.documentCount}
                </span>
              </button>
            );
          })}
          {workspaces.data?.length === 0 && (
            <p className="px-2 py-1 text-xs leading-relaxed text-zinc-600">
              No topics yet. Create one to start learning.
            </p>
          )}
        </div>
      </div>

      <div className="border-t border-zinc-800/80 p-3">
        <button
          className={itemClass(page === 'settings')}
          onClick={() => onNavigate('settings')}
        >
          <span aria-hidden>⚙</span> Settings
        </button>
        <div className="mt-2 flex items-center gap-2 rounded-xl bg-zinc-900/60 px-2.5 py-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-300">
            {(user.name ?? user.email)[0]?.toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-zinc-200">
              {user.name ?? user.email}
            </p>
            <p className="truncate text-[10px] text-zinc-600">{user.email}</p>
          </div>
          <button
            onClick={() => void signOut()}
            disabled={signingOut}
            className="rounded-md border border-zinc-800 px-1.5 py-1 text-[10px] text-zinc-500 hover:bg-zinc-800 disabled:opacity-40"
            title="Sign out"
          >
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}
