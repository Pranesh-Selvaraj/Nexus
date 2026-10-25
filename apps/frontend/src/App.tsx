import { lazy, Suspense, useEffect, useState } from 'react';

import type { UserDTO } from '@nexus/shared-types';

import { NexusLogo } from './components/NexusLogo';
import { fetchMe } from './lib/auth';
import { onUnauthorized } from './lib/session';
import { trpc } from './lib/trpc';
import { PortalNav, type PortalPage } from './features/shell/PortalNav';

const HomePage = lazy(() =>
  import('./features/home/HomePage').then((m) => ({ default: m.HomePage })),
);
const TopicsPage = lazy(() =>
  import('./features/topics/TopicsPage').then((m) => ({
    default: m.TopicsPage,
  })),
);
const TopicPage = lazy(() =>
  import('./features/topics/TopicPage').then((m) => ({ default: m.TopicPage })),
);
const SettingsPanel = lazy(() =>
  import('./features/settings/SettingsPanel').then((m) => ({
    default: m.SettingsPanel,
  })),
);
const LoginScreen = lazy(() =>
  import('./features/auth/LoginScreen').then((m) => ({
    default: m.LoginScreen,
  })),
);
const SharedWorkspacePage = lazy(() =>
  import('./features/share/SharedWorkspacePage').then((m) => ({
    default: m.SharedWorkspacePage,
  })),
);

export { NexusLogo };

type GateState =
  | { status: 'checking' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: UserDTO };

export default function App() {
  const [gate, setGate] = useState<GateState>({ status: 'checking' });
  const [page, setPage] = useState<PortalPage>('home');
  const [topicId, setTopicId] = useState<string | null>(null);
  const [topicIntent, setTopicIntent] = useState<{
    tab: 'learn' | 'practice' | 'voice' | 'language';
    studyTab?: 'dashboard' | 'review';
  }>({ tab: 'learn' });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [topicsAutoCreate, setTopicsAutoCreate] = useState(false);

  const publicConfig = trpc.config.public.useQuery(undefined);
  const appName = publicConfig.data?.appName || 'Nexus';
  useEffect(() => {
    document.title = `${appName} - Learning portal`;
  }, [appName]);

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

  // Public capability link: the shared page renders outside the auth shell.
  const shareToken = /^\/share\/([^/]+)\/?$/.exec(
    window.location.pathname,
  )?.[1];
  if (shareToken) {
    return (
      <Suspense fallback={<BootSplash />}>
        <SharedWorkspacePage token={decodeURIComponent(shareToken)} />
      </Suspense>
    );
  }

  if (gate.status === 'checking') return <BootSplash />;

  if (gate.status === 'anonymous') {
    return (
      <Suspense fallback={<BootSplash />}>
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

  function openTopic(
    id: string,
    intent: {
      tab: 'learn' | 'practice' | 'voice' | 'language';
      studyTab?: 'dashboard' | 'review';
    } = {
      tab: 'learn',
    },
  ) {
    setTopicId(id);
    setTopicIntent(intent);
    setPage('topic');
    setSidebarOpen(false);
  }

  const navProps = {
    appName,
    user: gate.user,
    page,
    topicId,
    onNavigate: (next: PortalPage) => {
      setPage(next);
      setSidebarOpen(false);
    },
    onOpenTopic: (id: string) => openTopic(id),
    onLoggedOut: () => setGate({ status: 'anonymous' }),
  };

  return (
    <div className="flex h-full bg-zinc-950 text-zinc-100">
      <div className="hidden md:flex">
        <PortalNav {...navProps} />
      </div>

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setSidebarOpen(false)}
            aria-hidden
          />
          <div className="relative flex h-full">
            <PortalNav {...navProps} onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-zinc-800/80 px-3 py-2 md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg border border-zinc-800 px-2.5 py-1.5 text-sm text-zinc-300"
            aria-label="Open menu"
          >
            ☰
          </button>
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            <NexusLogo className="h-4 w-4 text-nexus-400" />
            {appName}
          </span>
        </div>

        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center text-zinc-500">
              <span className="animate-pulse text-sm">Loading...</span>
            </div>
          }
        >
          {page === 'home' && (
            <HomePage
              onOpenTopic={(id) => openTopic(id)}
              onStartReview={(id) =>
                openTopic(id, { tab: 'practice', studyTab: 'review' })
              }
              onOpenTopics={() => {
                setTopicsAutoCreate(false);
                setPage('topics');
              }}
              onCreateTopic={() => {
                setTopicsAutoCreate(true);
                setPage('topics');
              }}
            />
          )}
          {page === 'topics' && (
            <TopicsPage
              autoCreate={topicsAutoCreate}
              onOpenTopic={(id) => openTopic(id)}
            />
          )}
          {page === 'topic' && topicId && (
            <TopicPage
              key={`${topicId}:${topicIntent.tab}:${topicIntent.studyTab ?? ''}`}
              workspaceId={topicId}
              initialTab={topicIntent.tab}
              initialStudyTab={topicIntent.studyTab}
              onBack={() => setPage('topics')}
              onDeleted={() => {
                setTopicId(null);
                setPage('topics');
              }}
              onOpenSettings={() => setPage('settings')}
            />
          )}
          {page === 'settings' && <SettingsPanel />}
        </Suspense>
      </main>
    </div>
  );
}

function BootSplash() {
  return (
    <div className="flex h-full items-center justify-center bg-zinc-950 text-zinc-500">
      <span className="animate-pulse text-sm">Loading...</span>
    </div>
  );
}
