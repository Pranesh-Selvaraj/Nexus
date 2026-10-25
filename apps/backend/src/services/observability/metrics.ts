import { timingSafeEqual } from 'node:crypto';

import type { Request, RequestHandler, Response } from 'express';
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';

import { embeddingQueue } from '../../queues/index.js';
import { logger } from './logger.js';

/**
 * Prometheus metrics (P-1). The registry is process-local and the endpoint
 * reports the API process; queue depth is sampled at scrape time so the
 * worker's own metrics (when it exposes them) are not required for a first
 * read on backlog.
 */
export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'nexus_' });

export const httpRequests = new Counter({
  name: 'nexus_http_requests_total',
  help: 'HTTP requests by method, route and status',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [registry],
});

export const httpDuration = new Histogram({
  name: 'nexus_http_request_duration_seconds',
  help: 'HTTP request duration by method and route',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [registry],
});

/** Time from request start to the first streamed token. */
export const chatTtft = new Histogram({
  name: 'nexus_chat_ttft_seconds',
  help: 'Time to first token for streamed chat answers',
  buckets: [0.1, 0.25, 0.5, 1, 2, 4, 8, 15, 30],
  registers: [registry],
});

export const chatTokens = new Counter({
  name: 'nexus_chat_tokens_total',
  help: 'Provider tokens reported by chat streams',
  labelNames: ['kind'] as const,
  registers: [registry],
});

export const retrievalDuration = new Histogram({
  name: 'nexus_retrieval_duration_seconds',
  help: 'Retrieval stage duration for one chat/search turn',
  labelNames: ['stage'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});

export const ingestDuration = new Histogram({
  name: 'nexus_ingest_duration_seconds',
  help: 'Time to parse, chunk and persist one ingested document',
  labelNames: ['kind'] as const,
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
  registers: [registry],
});

export const queueDepth = new Gauge({
  name: 'nexus_queue_jobs',
  help: 'Embedding queue jobs by state, sampled at scrape time',
  labelNames: ['queue', 'state'] as const,
  registers: [registry],
});

const QUEUE_STATES = [
  'waiting',
  'active',
  'delayed',
  'failed',
  'completed',
  'paused',
] as const;

async function sampleQueue(): Promise<void> {
  try {
    const counts = await embeddingQueue.getJobCounts(...QUEUE_STATES);
    for (const state of QUEUE_STATES) {
      queueDepth.set({ queue: 'embedding', state }, Number(counts[state] ?? 0));
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'queue metrics sample failed',
    );
  }
}

/** Route label: the matched Express pattern, never a raw id-bearing URL. */
function routeLabel(req: Request): string {
  const pattern = req.route?.path;
  if (typeof pattern === 'string') {
    return `${req.baseUrl ?? ''}${pattern}` || pattern;
  }
  return req.baseUrl || 'unmatched';
}

export const metricsMiddleware: RequestHandler = (req, res, next) => {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const labels = {
      method: req.method,
      route: routeLabel(req),
      status: String(res.statusCode),
    };
    httpRequests.inc(labels);
    httpDuration.observe(
      labels,
      Number(process.hrtime.bigint() - startedAt) / 1e9,
    );
  });
  next();
};

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Reads a bearer token from `Authorization: Bearer <token>`. */
function bearer(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(header?.trim() ?? '');
  return match?.[1]?.trim();
}

/**
 * `/metrics` in Prometheus text format. When `METRICS_TOKEN` is set the
 * endpoint requires `Authorization: Bearer <token>` (or `?token=`), so a
 * publicly reachable deployment does not leak traffic and queue internals.
 */
export async function metricsHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const expected = process.env.METRICS_TOKEN;
  if (expected) {
    const queryToken =
      typeof req.query.token === 'string' ? req.query.token : undefined;
    const provided = bearer(req.headers.authorization) ?? queryToken;
    if (!provided || !tokenMatches(provided, expected)) {
      res.status(401).json({ error: 'Metrics token required' });
      return;
    }
  }
  await sampleQueue();
  res.setHeader('content-type', registry.contentType);
  res.send(await registry.metrics());
}
