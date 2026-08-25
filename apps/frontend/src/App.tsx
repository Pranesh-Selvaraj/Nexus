import { lazy, Suspense, useEffect, useState } from 'react';

import type { UserDTO } from '@nexus/shared-types';

import { fetchMe } from './lib/auth';
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

  const settings = trpc.settings.list.useQuery(undefined);
  const appName =
    settings.data?.find((s) => s.key === 'ui.appName')?.value || 'Nexus';
  useEffect(() => {
    document.title = `${appName} - AI RAG Workspace`;
  }, [appName]);

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

  return (
    <div className="flex h-full bg-zinc-950 text-zinc-100">
      <WorkspaceSidebar
        activeWorkspaceId={activeWorkspaceId}
        onSelect={(id) => {
          setActiveWorkspaceId(id);
          setView('workspace');
        }}
        user={gate.user}
        onLoggedOut={() => setGate({ status: 'anonymous' })}
        onOpenSettings={() => setView('settings')}
        settingsActive={view === 'settings'}
        appName={appName}
      />
      <main className="flex min-w-0 flex-1 flex-col">
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
