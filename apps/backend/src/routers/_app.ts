import { apiKeyRouter } from './api-key.router.js';
import { artifactsRouter } from './artifacts.router.js';
import { chatRouter } from './chat.router.js';
import { documentRouter } from './document.router.js';
import { languageRouter } from './language.router.js';
import { notesRouter } from './notes.router.js';
import { quizRouter } from './quiz.router.js';
import { settingsRouter } from './settings.router.js';
import { studyRouter } from './study.router.js';
import { visionRouter } from './vision.router.js';
import { voiceRouter } from './voice.router.js';
import { webhookRouter } from './webhook.router.js';
import { workspaceRouter } from './workspace.router.js';
import { t } from '../middleware/auth.js';
import { visionConfig } from '../services/ingestion/vision.service.js';
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
      // Image limits/capabilities must be known before the first upload; the
      // settings list itself is auth-gated.
      vision: await visionConfig(),
    })),
  }),
  apiKey: apiKeyRouter,
  webhook: webhookRouter,
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
