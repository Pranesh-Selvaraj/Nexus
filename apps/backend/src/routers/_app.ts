import { chatRouter } from './chat.router';
import { documentRouter } from './document.router';
import { workspaceRouter } from './workspace.router';
import { t } from '../middleware/auth';

export const appRouter = t.router({
  health: t.procedure.query(() => ({
    status: 'ok' as const,
    timestamp: new Date().toISOString(),
  })),
  workspace: workspaceRouter,
  document: documentRouter,
  chat: chatRouter,
});

export type AppRouter = typeof appRouter;
