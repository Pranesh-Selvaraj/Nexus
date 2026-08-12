import { useState } from 'react';

import { WorkspacePanel } from './features/workspaces/WorkspacePanel';
import { WorkspaceSidebar } from './features/workspaces/WorkspaceSidebar';

export default function App() {
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(
    null,
  );

  return (
    <div className="flex h-full bg-zinc-950 text-zinc-100">
      <WorkspaceSidebar
        activeWorkspaceId={activeWorkspaceId}
        onSelect={setActiveWorkspaceId}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        {activeWorkspaceId ? (
          <WorkspacePanel
            key={activeWorkspaceId}
            workspaceId={activeWorkspaceId}
          />
        ) : (
          <EmptyState />
        )}
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
