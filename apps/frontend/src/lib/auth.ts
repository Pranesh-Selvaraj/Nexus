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

export async function login(
  email: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    return { ok: false, error: body?.error ?? `Login failed (${res.status})` };
  } catch {
    return { ok: false, error: 'Could not reach the server' };
  }
}

export async function register(
  email: string,
  password: string,
  name: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    return {
      ok: false,
      error: body?.error ?? `Registration failed (${res.status})`,
    };
  } catch {
    return { ok: false, error: 'Could not reach the server' };
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
}

export async function fetchAuthConfig(): Promise<AuthConfig> {
  try {
    const res = await fetch('/api/auth/config', {
      credentials: 'same-origin',
    });
    if (!res.ok) throw new Error('config failed');
    return (await res.json()) as AuthConfig;
  } catch {
    return { authEnabled: false, registrationEnabled: false };
  }
}
