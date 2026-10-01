import { chatRouter } from './chat.router.js';
import { documentRouter } from './document.router.js';
import { settingsRouter } from './settings.router.js';
import { workspaceRouter } from './workspace.router.js';
import { t } from '../middleware/auth.js';
import { getSetting } from '../services/settings.service.js';

export const appRouter = t.router({
  health: t.procedure.query(() => ({
    status: 'ok' as const,
    timestamp: new Date().toISOString(),
  })),
  /** Non-sensitive client configuration (available before login). */
  config: t.router({
    public: t.procedure.query(async () => ({
      appName: await getSetting('ui.appName'),
      maxUploadMb: Number(await getSetting('server.maxUploadMb')) || 25,
    })),
  }),
  workspace: workspaceRouter,
  document: documentRouter,
  chat: chatRouter,
  settings: settingsRouter,
});

export type AppRouter = typeof appRouter;
