import type { UserDTO } from '@nexus/shared-types';

export interface AuthState {
  status: 'checking' | 'authenticated' | 'anonymous';
  user: UserDTO | null;
}

export async function fetchMe(): Promise<UserDTO | null> {
  const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
  if (!res.ok) return null;
  const body = (await res.json()) as { user: UserDTO };
  return body.user;
}

export async function login(
  email: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email, password }),
    });
    const body = (await res.json().catch(() => null)) as {
      error?: string;
      user?: UserDTO;
    } | null;
    if (!res.ok) {
      return {
        ok: false,
        error: body?.error ?? `Login failed (${res.status})`,
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not reach the server' };
  }
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
  }).catch(() => undefined);
}
