import { lazy, Suspense, useEffect, useState } from 'react';

import type { UserDTO } from '@nexus/shared-types';

import { fetchMe } from './lib/auth';
import { onUnauthorized } from './lib/session';
import { trpc } from './lib/trpc';
import { WorkspaceSidebar } from './features/workspaces/WorkspaceSidebar';

// Route-level code splitting: each panel loads in its own chunk (Vite) and
// only when first needed, keeping the initial bundle small. The sidebar is
// part of the app shell and stays eager.
const LoginScreen = lazy(() =>
  import('./features/auth/LoginScreen').then((m) => ({
    default: m.LoginScreen,
  })),
);
const SettingsPanel = lazy(() =>
  import('./features/settings/SettingsPanel').then((m) => ({
    default: m.SettingsPanel,
  })),
);
const WorkspacePanel = lazy(() =>
  import('./features/workspaces/WorkspacePanel').then((m) => ({
    default: m.WorkspacePanel,
  })),
);

type GateState =
  | { status: 'checking' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: UserDTO };

export default function App() {
  const [gate, setGate] = useState<GateState>({ status: 'checking' });
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(
    null,
  );
  const [view, setView] = useState<'workspace' | 'settings'>('workspace');
  // Mobile: the sidebar is an off-canvas drawer instead of a fixed column.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Public config is available before login (the protected settings list is
  // not), so the shell renders correctly on the login screen too.
  const publicConfig = trpc.config.public.useQuery(undefined);
  const appName = publicConfig.data?.appName || 'Nexus';
  useEffect(() => {
    document.title = `${appName} - AI RAG Workspace`;
  }, [appName]);

  // Any UNAUTHORIZED error (expired/revoked session) drops back to login
  // instead of leaving every panel in a failed state.
  useEffect(() => onUnauthorized(() => setGate({ status: 'anonymous' })), []);

  useEffect(() => {
    let cancelled = false;
    void fetchMe().then((user) => {
      if (cancelled) return;
      setGate(
        user ? { status: 'authenticated', user } : { status: 'anonymous' },
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (gate.status === 'checking') {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-950 text-zinc-500">
        <span className="animate-pulse text-sm">Loading...</span>
      </div>
    );
  }

  if (gate.status === 'anonymous') {
    return (
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center bg-zinc-950 text-zinc-500">
            <span className="animate-pulse text-sm">Loading...</span>
          </div>
        }
      >
        <LoginScreen
          onAuthed={async () => {
            const user = await fetchMe();
            setGate(
              user
                ? { status: 'authenticated', user }
                : { status: 'anonymous' },
            );
          }}
        />
      </Suspense>
    );
  }

  const sidebarProps = {
    activeWorkspaceId,
    onSelect: (id: string) => {
      setActiveWorkspaceId(id);
      setView('workspace');
      setSidebarOpen(false);
    },
    user: gate.user,
    onLoggedOut: () => setGate({ status: 'anonymous' }),
    onWorkspaceDeleted: (workspaceId: string) => {
      if (workspaceId === activeWorkspaceId) setActiveWorkspaceId(null);
    },
    onOpenSettings: () => {
      setView('settings');
      setSidebarOpen(false);
    },
    settingsActive: view === 'settings',
    appName,
  };

  return (
    <div className="flex h-full bg-zinc-950 text-zinc-100">
      {/* Desktop sidebar */}
      <div className="hidden md:flex">
        <WorkspaceSidebar {...sidebarProps} />
      </div>

      {/* Mobile sidebar drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setSidebarOpen(false)}
            aria-hidden
          />
          <div className="relative flex h-full">
            <WorkspaceSidebar {...sidebarProps} />
          </div>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <div className="flex items-center gap-3 border-b border-zinc-800 px-3 py-2 md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            className="rounded-lg border border-zinc-700 p-2 text-zinc-300 hover:bg-zinc-800"
          >
            <MenuIcon className="h-4 w-4" />
          </button>
          <NexusLogo className="h-5 w-5 text-nexus-400" />
          <span className="truncate text-sm font-semibold">{appName}</span>
        </div>
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center text-zinc-500">
              <span className="animate-pulse text-sm">Loading...</span>
            </div>
          }
        >
          {view === 'settings' ? (
            <SettingsPanel />
          ) : activeWorkspaceId ? (
            <WorkspacePanel
              key={activeWorkspaceId}
              workspaceId={activeWorkspaceId}
            />
          ) : (
            <EmptyState />
          )}
        </Suspense>
      </main>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-zinc-500">
      <NexusLogo className="h-16 w-16" />
      <div className="text-center">
        <h2 className="text-lg font-semibold text-zinc-300">
          Welcome to Nexus
        </h2>
        <p className="mt-1 max-w-sm text-sm">
          Select or create a workspace to upload documents and start chatting
          with them.
        </p>
      </div>
    </div>
  );
}

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={className}
      aria-hidden
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

export function NexusLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="18" r="3" />
      <path d="M6 9v6a3 3 0 0 0 3 3h6" />
      <circle cx="18" cy="6" r="3" />
      <path d="M18 9v3" />
    </svg>
  );
}
