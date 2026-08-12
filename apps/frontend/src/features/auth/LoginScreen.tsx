import { useState } from 'react';
import type { FormEvent } from 'react';

import { login } from '../../lib/auth';

interface Props {
  onAuthed: () => void;
}

export function LoginScreen({ onAuthed }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await login(email, password);
    setBusy(false);
    if (result.ok) {
      onAuthed();
    } else {
      setError(result.error ?? 'Login failed');
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-zinc-950 text-zinc-100">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-nexus-600">
            <span className="text-lg font-bold text-white">N</span>
          </div>
          <div>
            <h1 className="text-lg font-bold">Nexus</h1>
            <p className="text-xs text-zinc-500">Sign in to your workspace</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="mb-1 block text-xs font-medium text-zinc-400"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-nexus-500"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-xs font-medium text-zinc-400"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-nexus-500"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-red-950/40 px-3 py-2 text-xs text-red-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !email || !password}
            className="w-full rounded-lg bg-nexus-600 py-2 text-sm font-semibold text-white transition-colors hover:bg-nexus-500 disabled:opacity-40"
          >
            {busy ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
