import { randomUUID } from 'node:crypto';

import type { RequestHandler } from 'express';
import pino from 'pino';

/**
 * Structured logger (P-1). Every HTTP request gets a request id (provided by
 * the caller via `X-Request-Id` or generated), the id is echoed back, and the
 * fields that can carry secrets - authorization headers, cookies, tokens,
 * keys - are redacted before a line is written.
 *
 * Long-standing modules still use `console.*` in places; new code should log
 * through this logger with the request id (or job id) in context.
 */
export const logger = pino({
  name: 'nexus-api',
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'nexus-api' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.apiKey',
      '*.key',
      '*.token',
      '*.secret',
    ],
    censor: '[redacted]',
  },
});

function readRequestId(headers: Record<string, unknown>): string | undefined {
  const provided = headers['x-request-id'];
  const value = Array.isArray(provided) ? provided[0] : provided;
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 128)
    : undefined;
}

/**
 * Request logging with ids. Health checks and metrics scrapes are skipped so
 * the log stays a record of real traffic instead of a heartbeat.
 */
export const requestLogger: RequestHandler = (req, res, next) => {
  const requestId = readRequestId(req.headers) ?? randomUUID();
  res.setHeader('x-request-id', requestId);
  res.locals.requestId = requestId;
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    if (req.path.startsWith('/healthz') || req.path.startsWith('/metrics')) {
      return;
    }
    const fields = {
      requestId,
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs: Math.round(durationMs),
      remoteAddress: req.ip,
    };
    if (res.statusCode >= 500) logger.error(fields, 'request failed');
    else if (res.statusCode >= 400) logger.warn(fields, 'request rejected');
    else logger.info(fields, 'request completed');
  });

  next();
};
