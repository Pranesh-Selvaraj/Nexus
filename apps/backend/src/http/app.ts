import { createExpressMiddleware } from '@trpc/server/adapters/express';
import cors from 'cors';
import express from 'express';

import { createExpressContext } from '../platform/auth/context.js';
import { config } from '../platform/config.js';
import { apiV1Router } from './rest/v1.routes.js';
import { appRouter } from './trpc.js';
import { requestLogger } from '../platform/observability/logger.js';
import { metricsMiddleware } from '../platform/observability/metrics.js';
import { archiveRoutes } from './rest/archive.routes.js';
import { authRoutes } from './rest/auth.routes.js';
import { exportRoutes } from './rest/export.routes.js';
import { ingestRoutes } from './rest/ingest.routes.js';
import { mediaRoutes } from './rest/media.routes.js';
import { opsRoutes } from './rest/ops.routes.js';
import { shareRoutes } from './rest/share.routes.js';
import { uploadRoutes } from './rest/upload.routes.js';

/**
 * Build the Express application: middleware, REST surfaces, the public v1 API
 * and the tRPC bridge. No I/O and no process concerns live here — the server,
 * sockets and shutdown are wired in `main.ts`.
 */
export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');

  // Structured request logs with an id echoed as X-Request-Id (P-1).
  app.use(requestLogger);
  // Route/status/duration metrics; scraped from GET /metrics.
  app.use(metricsMiddleware);
  // Behind the nginx reverse proxy (docker-compose.prod.yml) - lets
  // express-rate-limit read X-Forwarded-For from loopback proxies only.
  app.set('trust proxy', 'loopback');

  app.use(cors({ origin: config.frontendOrigins }));
  app.use(express.json({ limit: '1mb' }));

  app.use(authRoutes());
  app.use(uploadRoutes());
  app.use(ingestRoutes());
  app.use(mediaRoutes());
  app.use(archiveRoutes());
  app.use(shareRoutes());
  app.use(exportRoutes());

  // multer errors -> JSON 400 instead of HTML stack (size limit, filter, ...)
  app.use(
    '/api',
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(400).json({ error: err.message });
    },
  );

  // Public REST API (P-5). API-key authenticated only: session cookies are not
  // read here, so an integration request cannot be triggered by a cross-site
  // form post.
  app.use('/api/v1', apiV1Router());

  app.use(opsRoutes());

  app.use(
    '/trpc',
    createExpressMiddleware({
      router: appRouter,
      createContext: createExpressContext,
    }),
  );

  return app;
}
