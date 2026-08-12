import { chatRouter } from './chat.router.js';
import { documentRouter } from './document.router.js';
import { settingsRouter } from './settings.router.js';
import { workspaceRouter } from './workspace.router.js';
import { t } from '../middleware/auth.js';

export const appRouter = t.router({
  health: t.procedure.query(() => ({
    status: 'ok' as const,
    timestamp: new Date().toISOString(),
  })),
  workspace: workspaceRouter,
  document: documentRouter,
  chat: chatRouter,
  settings: settingsRouter,
});

export type AppRouter = typeof appRouter;
