import type { Request, RequestHandler, Response } from 'express';

import type { ApiScope } from '@nexus/shared-types';

import {
  hasScope,
  verifyApiKey,
  type ApiKeyIdentity,
} from '../services/api-key.service.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiKey?: ApiKeyIdentity;
    }
  }
}

/** Reads `Authorization: Bearer ndx_...` or the `X-API-Key` header. */
function readKey(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (typeof header === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match?.[1]) return match[1].trim();
  }
  const apiKey = req.headers['x-api-key'];
  return typeof apiKey === 'string' ? apiKey.trim() : undefined;
}

function reject(
  res: Response,
  status: 401 | 403 | 503,
  error: string,
  extra: Record<string, unknown> = {},
): void {
  if (status === 401) {
    // Standard challenge so well-behaved clients can retry with a key.
    res.setHeader('WWW-Authenticate', 'Bearer realm="nexus"');
  }
  res.status(status).json({ error, ...extra });
}

/**
 * Authenticate a REST request with an API key, without requiring a scope.
 * Used by endpoints that only need identity (e.g. `GET /api/v1/me`).
 */
export const authenticateApiKey: RequestHandler = (req, res, next) => {
  const raw = readKey(req);
  if (!raw) {
    reject(res, 401, 'Missing API key', {
      hint: 'Send Authorization: Bearer ndx_... or X-API-Key',
    });
    return;
  }

  void verifyApiKey(raw)
    .then((identity) => {
      if (!identity) {
        reject(res, 401, 'Invalid or revoked API key');
        return;
      }
      req.apiKey = identity;
      next();
    })
    .catch((err: unknown) => {
      // A database failure is a 503, never a silent 401.
      reject(res, 503, 'Could not verify the API key', {
        detail: err instanceof Error ? err.message : undefined,
      });
    });
};

/**
 * Authenticate and require one scope. 401 for anything that is not a live
 * key, 403 for a live key that lacks the scope; the two are deliberately
 * distinguishable because the key already proved who it is.
 */
export function requireApiKey(scope: ApiScope): RequestHandler {
  return (req, res, next) => {
    authenticateApiKey(req, res, (err?: unknown) => {
      if (err) {
        next(err);
        return;
      }
      const identity = req.apiKey;
      if (!identity) {
        reject(res, 401, 'Invalid or revoked API key');
        return;
      }
      if (!hasScope(identity, scope)) {
        reject(res, 403, 'API key is missing a required scope', {
          requiredScope: scope,
          grantedScopes: identity.scopes,
        });
        return;
      }
      next();
    });
  };
}
