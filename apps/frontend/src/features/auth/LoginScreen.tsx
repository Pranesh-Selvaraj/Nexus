import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';

import { NexusLogo } from '../../components/NexusLogo';
import { fetchAuthConfig, login, register } from '../../lib/auth';
import type { AuthConfig } from '../../lib/auth';

interface Props {
  onAuthed: () => void;
}

type Mode = 'login' | 'register';

const FALLBACK_CONFIG: AuthConfig = {
  authEnabled: true,
  registrationEnabled: false,
  localEmail: null,
};

const fieldClass =
  'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-colors focus:border-nexus-500 disabled:opacity-60';

const labelClass = 'mb-1 block text-xs font-medium text-zinc-400';

/**
 * The sign-in / sign-up screen. The two modes are always visible when the
 * instance allows registration; on a closed instance the screen says so and,
 * when the API exposes it, offers the local account in one click instead of
 * leaving the visitor to guess an email.
 */
export function LoginScreen({ onAuthed }: Props) {
  const [config, setConfig] = useState<AuthConfig>(FALLBACK_CONFIG);
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void fetchAuthConfig().then((next) => {
      setConfig(next);
      if (!next.registrationEnabled) setMode('login');
    });
  }, []);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  const registering = mode === 'register' && config.registrationEnabled;

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setPassword('');
    setShowPassword(false);
    requestAnimationFrame(() => emailRef.current?.focus());
  }

  function useLocalAccount() {
    if (!config.localEmail) return;
    setMode('login');
    setEmail(config.localEmail);
    setError(null);
    requestAnimationFrame(() => passwordRef.current?.focus());
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = registering
      ? await register(email, password, name)
      : await login(email, password);
    if (result.ok) {
      onAuthed();
      return;
    }
    setBusy(false);
    setError(result.error ?? 'Something went wrong. Try again.');
    // Never keep a rejected password in the field.
    if (result.status === 401) setPassword('');
  }

  function handlePasswordKey(event: KeyboardEvent<HTMLInputElement>) {
    setCapsLock(event.getModifierState?.('CapsLock') ?? false);
  }

  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden bg-zinc-950 px-4 text-zinc-100">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(620px 320px at 50% -8%, rgba(124,58,237,0.18), transparent 70%)',
        }}
      />

      <div className="relative w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-[13px] bg-gradient-to-br from-nexus-500 to-nexus-700 shadow-lg shadow-nexus-900/40">
            {/* The app tile: the braid at the proportion drawn in
                `assets/brand/nexus-tile.svg`. */}
            <NexusLogo className="h-4 w-[30px] text-white" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Nexus</h1>
          <p className="mt-1 text-xs text-zinc-500">
            {registering
              ? 'Create an account to start learning'
              : 'Sign in to your learning portal'}
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-2xl shadow-black/40 backdrop-blur">
          {config.registrationEnabled && (
            <div
              role="tablist"
              aria-label="Sign in or create an account"
              className="mb-5 grid grid-cols-2 gap-1 rounded-lg border border-zinc-800 bg-zinc-950/70 p-1"
            >
              {(
                [
                  ['login', 'Sign in'],
                  ['register', 'Create account'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={mode === value}
                  onClick={() => switchMode(value)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    mode === value
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {registering && (
              <div>
                <label htmlFor="name" className={labelClass}>
                  Your name <span className="text-zinc-600">(optional)</span>
                </label>
                <input
                  id="name"
                  autoComplete="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={busy}
                  className={fieldClass}
                  placeholder="Alex"
                />
              </div>
            )}

            <div>
              <label htmlFor="email" className={labelClass}>
                Email
              </label>
              <input
                id="email"
                ref={emailRef}
                type="email"
                required
                autoComplete="username"
                spellCheck={false}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={busy}
                className={fieldClass}
                placeholder="you@example.com"
              />
            </div>

            <div>
              <div className="flex items-baseline justify-between">
                <label htmlFor="password" className={labelClass}>
                  Password
                </label>
                {registering && (
                  <span className="mb-1 text-[11px] text-zinc-600">
                    at least 8 characters
                  </span>
                )}
              </div>
              <div className="relative">
                <input
                  id="password"
                  ref={passwordRef}
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={registering ? 8 : undefined}
                  autoComplete={
                    registering ? 'new-password' : 'current-password'
                  }
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyUp={handlePasswordKey}
                  onKeyDown={handlePasswordKey}
                  disabled={busy}
                  className={`${fieldClass} pr-16`}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((shown) => !shown)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-2 my-auto h-6 rounded px-2 text-[11px] font-medium text-zinc-500 transition-colors hover:text-zinc-200"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              {capsLock && (
                <p className="mt-1.5 text-[11px] text-amber-400">
                  Caps Lock is on
                </p>
              )}
            </div>

            {error && (
              <p
                role="alert"
                aria-live="polite"
                className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || !email || !password}
              aria-busy={busy}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-nexus-600 py-2 text-sm font-semibold text-white transition-colors hover:bg-nexus-500 disabled:opacity-40"
            >
              {busy && (
                <span
                  aria-hidden
                  className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"
                />
              )}
              {busy
                ? registering
                  ? 'Creating account…'
                  : 'Signing in…'
                : registering
                  ? 'Create account'
                  : 'Sign in'}
            </button>
          </form>

          <div className="mt-5 space-y-2 border-t border-zinc-800/70 pt-4 text-center text-[11px] leading-relaxed text-zinc-500">
            {config.registrationEnabled ? (
              <p>
                {registering ? 'Already have an account?' : 'No account yet?'}{' '}
                <button
                  type="button"
                  onClick={() => switchMode(registering ? 'login' : 'register')}
                  className="font-medium text-nexus-300 hover:text-nexus-200"
                >
                  {registering ? 'Sign in' : 'Create one'}
                </button>
              </p>
            ) : config.localEmail ? (
              <p>
                This is a single-user instance.{' '}
                <button
                  type="button"
                  onClick={useLocalAccount}
                  className="font-medium text-nexus-300 hover:text-nexus-200"
                >
                  Use {config.localEmail}
                </button>
              </p>
            ) : (
              <p>
                Registration is closed on this instance. Ask whoever runs it to
                add your email.
              </p>
            )}
            {!config.registrationEnabled && (
              <p className="text-zinc-600">
                Owners can open registration with{' '}
                <code className="rounded bg-zinc-800/80 px-1 py-0.5 font-mono text-[10px] text-zinc-400">
                  ALLOW_REGISTRATION=true
                </code>
              </p>
            )}
          </div>
        </div>

        <p className="mt-6 text-center text-[11px] text-zinc-600">
          Self-hosted · your sources, your data
        </p>
      </div>
    </div>
  );
}
