import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { fetchAuthConfig, login, register } from '../../lib/auth';

interface Props {
  onAuthed: () => void;
}

export function LoginScreen({ onAuthed }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [canRegister, setCanRegister] = useState(false);

  useEffect(() => {
    void fetchAuthConfig().then((config) =>
      setCanRegister(config.registrationEnabled),
    );
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result =
      mode === 'register'
        ? await register(email, password, name)
        : await login(email, password);
    setBusy(false);
    if (result.ok) {
      onAuthed();
    } else {
      setError(result.error ?? 'Sign in failed');
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
            <p className="text-xs text-zinc-500">
              {mode === 'register'
                ? 'Create an account to start learning'
                : 'Sign in to your learning portal'}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div>
              <label
                htmlFor="name"
                className="mb-1 block text-xs font-medium text-zinc-400"
              >
                Your name
              </label>
              <input
                id="name"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-nexus-500"
                placeholder="Alex"
              />
            </div>
          )}
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
              autoComplete={
                mode === 'register' ? 'new-password' : 'current-password'
              }
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
            {busy
              ? 'Please wait...'
              : mode === 'register'
                ? 'Create account'
                : 'Sign in'}
          </button>
        </form>

        {canRegister && (
          <p className="mt-4 text-center text-xs text-zinc-500">
            {mode === 'login' ? 'New here?' : 'Already have an account?'}{' '}
            <button
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login');
                setError(null);
              }}
              className="font-medium text-nexus-300 hover:text-nexus-200"
            >
              {mode === 'login' ? 'Create an account' : 'Sign in'}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
