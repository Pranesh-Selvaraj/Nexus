export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

/** Current user, or null when anonymous (also when auth is disabled). */
export async function fetchMe(): Promise<SessionUser | null> {
  const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
  if (!res.ok) return null;
  const body = (await res.json()) as { user?: SessionUser };
  return body.user ?? null;
}

export interface AuthResult {
  ok: boolean;
  error?: string;
  status?: number;
}

/** Turn an API status into something a person can act on. */
function authError(
  status: number,
  action: 'login' | 'register',
  body: { error?: string } | null,
): string {
  if (status === 400) return body?.error ?? 'Check the form and try again.';
  if (status === 401) return 'That email and password do not match.';
  if (status === 403) {
    return action === 'register'
      ? 'Registration is closed on this instance.'
      : 'Authentication is disabled on this instance.';
  }
  if (status === 409)
    return body?.error ?? 'An account with that email already exists.';
  if (status === 429) return 'Too many attempts — wait a minute and try again.';
  if (status >= 500) return 'The server hit an error. Check the API logs.';
  return (
    body?.error ?? `${action === 'register' ? 'Sign up' : 'Sign in'} failed.`
  );
}

export async function login(
  email: string,
  password: string,
): Promise<AuthResult> {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) return { ok: true, status: res.status };
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    return {
      ok: false,
      status: res.status,
      error: authError(res.status, 'login', body),
    };
  } catch {
    return {
      ok: false,
      error: 'Could not reach the server. Is the API running?',
    };
  }
}

export async function register(
  email: string,
  password: string,
  name: string,
): Promise<AuthResult> {
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    });
    if (res.ok) return { ok: true, status: res.status };
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    return {
      ok: false,
      status: res.status,
      error: authError(res.status, 'register', body),
    };
  } catch {
    return {
      ok: false,
      error: 'Could not reach the server. Is the API running?',
    };
  }
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
  });
}

export interface AuthConfig {
  authEnabled: boolean;
  registrationEnabled: boolean;
  /** Local account offered as a hint on closed (single-user) instances. */
  localEmail: string | null;
}

export async function fetchAuthConfig(): Promise<AuthConfig> {
  try {
    const res = await fetch('/api/auth/config', {
      credentials: 'same-origin',
    });
    if (!res.ok) throw new Error('config failed');
    return (await res.json()) as AuthConfig;
  } catch {
    return { authEnabled: false, registrationEnabled: false, localEmail: null };
  }
}
