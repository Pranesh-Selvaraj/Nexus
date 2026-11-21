import { Router } from 'express';

import { pool } from '../../platform/db/index.js';
import { redisConnection } from '../../platform/queue.js';
import { metricsHandler } from '../../platform/observability/metrics.js';

interface DependencyStatus {
  db: boolean;
  redis: boolean;
}

let healthCache: { at: number; status: DependencyStatus } | null = null;

/**
 * Probe Postgres and Redis with memoized results (refreshed every 5s) so an
 * orchestrator can tell "process up" from "actually healthy".
 */
export async function checkDependencies(): Promise<DependencyStatus> {
  const now = Date.now();
  if (healthCache && now - healthCache.at < 5_000) {
    return healthCache.status;
  }

  let db = false;
  try {
    await pool.query('SELECT 1');
    db = true;
  } catch {
    // probe failed - reported below
  }

  let redis = false;
  try {
    const pong = await redisConnection.ping();
    redis = pong === 'PONG';
  } catch {
    // probe failed - reported below
  }

  healthCache = { at: now, status: { db, redis } };
  return healthCache.status;
}

/** Operational endpoints: Prometheus metrics and the dependency health check. */
export function opsRoutes(): Router {
  const router = Router();

  // Optionally protected by METRICS_TOKEN when the API is publicly reachable.
  router.get('/metrics', (req, res) => {
    void metricsHandler(req, res);
  });

  router.get('/healthz', async (_req, res) => {
    const deps = await checkDependencies();
    const healthy = deps.db && deps.redis;
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      db: deps.db ? 'up' : 'down',
      redis: deps.redis ? 'up' : 'down',
    });
  });

  return router;
}
