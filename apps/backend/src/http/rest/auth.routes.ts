import { Router } from 'express';
import { config } from '../../platform/config.js';
import rateLimit from 'express-rate-limit';
import { eq } from 'drizzle-orm';
import { db } from '../../platform/db/index.js';
import { users } from '../../platform/db/schema/index.js';
import {
  authEnabled,
  LOCAL_USER_EMAIL,
  readSessionCookie,
  resolveUser,
} from '../../platform/auth/context.js';
import { sanitizeForLog } from '../../shared/multer.js';
import {
  createSession,
  deleteSession,
  hashPassword,
  SESSION_COOKIE,
  sessionTtlMs,
  verifyPassword,
} from '../../platform/auth/service.js';

/**
 * REST surface: auth. Handlers keep their original bodies; only the router
 * they mount on and the imports moved out of the composition root.
 */
export function authRoutes(): Router {
  const router = Router();

  // --- Authentication (optional, see middleware/auth.ts) -----------------
  // Cookie: httpOnly + SameSite=Lax; Secure only when explicitly enabled
  // (behind a TLS-terminating proxy).
  const secureCookie = config.auth.secureCookie;
  const sessionCookie = (token: string, maxAgeSec: number): string =>
    `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSec}${secureCookie ? '; Secure' : ''}`;

  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many login attempts, please retry later' },
  });

  /**
   * The unauthenticated login screen reads this once per visit; it is rate
   * limited on its own bucket so a slow typist cannot lock themselves out of
   * the login form, and so the endpoint cannot be used to probe a deployment.
   */
  const authConfigLimiter = rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests, please retry in a minute' },
  });

  /** Public auth capabilities so the login screen can offer registration. */
  router.get('/api/auth/config', authConfigLimiter, (_req, res) => {
    const registrationEnabled = config.auth.allowRegistration;
    res.json({
      authEnabled: authEnabled(),
      registrationEnabled,
      // On a closed instance the login screen can point at the local account.
      // That address is the documented default, never a credential, and it is
      // withheld as soon as self-service registration is open.
      localEmail:
        authEnabled() && !registrationEnabled ? LOCAL_USER_EMAIL : null,
    });
  });

  /**
   * Self-service account creation (opt-in with ALLOW_REGISTRATION=true).
   * Memberships decide what a new account can access: nothing, until an owner
   * adds it to a workspace.
   */
  router.post('/api/auth/register', loginLimiter, async (req, res) => {
    try {
      if (!authEnabled() || !config.auth.allowRegistration) {
        res.status(403).json({ error: 'Registration is disabled' });
        return;
      }
      const { email, password, name } = (req.body ?? {}) as {
        email?: unknown;
        password?: unknown;
        name?: unknown;
      };
      if (typeof email !== 'string' || typeof password !== 'string') {
        res.status(400).json({ error: 'Email and password are required' });
        return;
      }
      const normalized = email.trim().toLowerCase();
      // Linear scan: no backtracking regex on user input (js/polynomial-redos).
      const at = normalized.indexOf('@');
      const dot = normalized.lastIndexOf('.');
      const validEmail =
        at > 0 &&
        dot > at + 1 &&
        dot < normalized.length - 1 &&
        !normalized.includes(' ') &&
        normalized.indexOf('@', at + 1) === -1;
      if (!validEmail) {
        res.status(400).json({ error: 'Enter a valid email address' });
        return;
      }
      if (password.length < 8) {
        res
          .status(400)
          .json({ error: 'Choose a password of at least 8 characters' });
        return;
      }
      const displayName =
        typeof name === 'string' && name.trim()
          ? name.trim().slice(0, 80)
          : normalized.split('@')[0];
      const [user] = await db
        .insert(users)
        .values({
          email: normalized,
          name: displayName,
          passwordHash: await hashPassword(password),
        })
        .onConflictDoNothing({ target: users.email })
        .returning({ id: users.id, email: users.email, name: users.name });
      if (!user) {
        res.status(409).json({ error: 'An account with that email exists' });
        return;
      }
      const { token, expiresAt } = await createSession(user.id);
      res.setHeader(
        'Set-Cookie',
        sessionCookie(token, Math.floor((await sessionTtlMs()) / 1000)),
      );
      res.status(201).json({
        user: { id: user.id, email: user.email, name: user.name },
        expiresAt: expiresAt.toISOString(),
      });
    } catch (err) {
      console.error('[auth] register failed:', sanitizeForLog(err));
      res.status(500).json({ error: 'Registration failed' });
    }
  });

  router.post('/api/auth/login', loginLimiter, async (req, res) => {
    try {
      if (!authEnabled()) {
        res.status(403).json({ error: 'Authentication is disabled' });
        return;
      }
      const { email, password } = (req.body ?? {}) as {
        email?: unknown;
        password?: unknown;
      };
      if (typeof email !== 'string' || typeof password !== 'string') {
        res.status(400).json({ error: 'Email and password are required' });
        return;
      }

      const [user] = await db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          passwordHash: users.passwordHash,
        })
        .from(users)
        .where(eq(users.email, email.trim().toLowerCase()))
        .limit(1);
      if (!user || !(await verifyPassword(password, user.passwordHash))) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }

      const { token, expiresAt } = await createSession(user.id);
      res.setHeader(
        'Set-Cookie',
        sessionCookie(token, Math.floor((await sessionTtlMs()) / 1000)),
      );
      res.json({
        user: { id: user.id, email: user.email, name: user.name },
        expiresAt: expiresAt.toISOString(),
      });
    } catch (err) {
      console.error('[auth] login failed:', sanitizeForLog(err));
      res.status(500).json({ error: 'Login failed' });
    }
  });

  router.post('/api/auth/logout', async (req, res) => {
    const token = readSessionCookie(req.headers);
    await deleteSession(token);
    res.setHeader('Set-Cookie', sessionCookie('', 0));
    res.json({ ok: true });
  });

  router.get('/api/auth/me', async (req, res) => {
    const user = await resolveUser(readSessionCookie(req.headers));
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    res.json({ user });
  });

  return router;
}
