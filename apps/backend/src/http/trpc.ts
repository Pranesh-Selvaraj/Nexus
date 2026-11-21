import { adminRouter } from '../modules/settings/admin.router.js';
import { apiKeyRouter } from '../modules/api-keys/router.js';
import { artifactsRouter } from '../modules/study/artifacts.router.js';
import { chatRouter } from '../modules/chat/router.js';
import { dashboardRouter } from '../modules/dashboard/router.js';
import { documentRouter } from '../modules/documents/router.js';
import { languageRouter } from '../modules/language/router.js';
import { membersRouter } from '../modules/workspaces/members.router.js';
import { notesRouter } from '../modules/study/notes.router.js';
import { packsRouter } from '../modules/packs/router.js';
import { quizRouter } from '../modules/study/quiz.router.js';
import { settingsRouter } from '../modules/settings/router.js';
import { shareRouter } from '../modules/workspaces/share.router.js';
import { storageRouter } from '../modules/settings/storage.router.js';
import { studyRouter } from '../modules/study/router.js';
import { visionRouter } from '../modules/vision/router.js';
import { voiceRouter } from '../modules/voice/router.js';
import { webhookRouter } from '../modules/webhooks/router.js';
import { workspaceRouter } from '../modules/workspaces/router.js';
import { t } from '../platform/auth/context.js';
import { visionConfig } from '../modules/ingestion/vision.service.js';
import { getSetting } from '../modules/settings/settings.service.js';

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
      // Image limits/capabilities must be known before the first upload; the
      // settings list itself is auth-gated.
      vision: await visionConfig(),
    })),
  }),
  admin: adminRouter,
  apiKey: apiKeyRouter,
  webhook: webhookRouter,
  storage: storageRouter,
  share: shareRouter,
  dashboard: dashboardRouter,
  members: membersRouter,
  packs: packsRouter,
  workspace: workspaceRouter,
  document: documentRouter,
  chat: chatRouter,
  study: studyRouter,
  quiz: quizRouter,
  artifacts: artifactsRouter,
  notes: notesRouter,
  settings: settingsRouter,
  voice: voiceRouter,
  vision: visionRouter,
  language: languageRouter,
});

export type AppRouter = typeof appRouter;
