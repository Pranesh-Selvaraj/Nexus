import { useState } from 'react';

import {
  API_SCOPES,
  API_SCOPE_LABELS,
  type ApiKeyDTO,
  type ApiScope,
} from '@nexus/shared-types';

import { useToast } from '../../components/Toast';
import { trpc } from '../../lib/trpc';

const DEFAULT_SCOPES: ApiScope[] = ['search', 'ask', 'documents:read'];

/**
 * API keys (P-5). A key is shown exactly once, right after creation, because
 * only its hash is stored. The list shows the prefix, scopes and last use so
 * a key can be recognised and revoked without ever revealing it again.
 */
export function ApiKeysCard() {
  const toast = useToast();
  const utils = trpc.useUtils();
  const keys = trpc.apiKey.list.useQuery();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiScope[]>(DEFAULT_SCOPES);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const createKey = trpc.apiKey.create.useMutation({
    onSuccess: (result) => {
      setCreatedKey(result.key);
      setName('');
      setScopes(DEFAULT_SCOPES);
      void utils.apiKey.list.invalidate();
    },
    onError: (err) =>
      toast.push({
        kind: 'error',
        message: `Could not create key: ${err.message}`,
      }),
  });

  const revokeKey = trpc.apiKey.revoke.useMutation({
    onSuccess: (result) => {
      setRevoking(null);
      void utils.apiKey.list.invalidate();
      if (!result.revoked) {
        toast.push({ kind: 'error', message: 'Key was already revoked' });
      }
    },
    onError: (err) =>
      toast.push({
        kind: 'error',
        message: `Could not revoke key: ${err.message}`,
      }),
  });

  function toggleScope(scope: ApiScope) {
    setScopes((current) =>
      current.includes(scope)
        ? current.filter((item) => item !== scope)
        : [...current, scope],
    );
  }

  async function copyKey() {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey);
      toast.push({ kind: 'success', message: 'API key copied' });
    } catch {
      toast.push({
        kind: 'error',
        message: 'Copy failed — select the key manually',
      });
    }
  }

  return (
    <section className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900/40">
      <h2 className="border-b border-zinc-800 px-5 py-3 text-sm font-semibold">
        API keys
      </h2>
      <div className="space-y-4 p-5">
        <p className="text-xs leading-relaxed text-zinc-500">
          Scoped keys for scripts and integrations:{' '}
          <code>GET /api/v1/search</code>, <code>POST /api/v1/ask</code> and{' '}
          <code>GET /api/v1/documents</code>. The key is shown once and stored
          only as a hash; revoke it here if it leaks.
        </p>

        {createdKey && (
          <div className="rounded-xl border border-emerald-800/60 bg-emerald-950/30 p-3">
            <p className="text-xs font-medium text-emerald-300">
              Copy this key now — it will not be shown again.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-zinc-950 px-3 py-2 text-xs text-emerald-200">
                {createdKey}
              </code>
              <button
                onClick={() => void copyKey()}
                className="rounded-lg border border-emerald-700 px-3 py-2 text-xs text-emerald-300 transition-colors hover:bg-emerald-900/40"
              >
                Copy
              </button>
              <button
                onClick={() => setCreatedKey(null)}
                className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-400 transition-colors hover:bg-zinc-800"
              >
                Done
              </button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <label className="block text-xs font-medium text-zinc-400">
            Key name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. notes sync script"
              maxLength={80}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-nexus-500 focus:outline-none"
            />
          </label>

          <fieldset>
            <legend className="text-xs font-medium text-zinc-400">
              Permissions
            </legend>
            <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {API_SCOPES.map((scope) => (
                <label
                  key={scope}
                  className="flex items-center gap-2 rounded-lg border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-300"
                >
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    onChange={() => toggleScope(scope)}
                    className="h-3.5 w-3.5 accent-nexus-500"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{scope}</span>
                    <span className="block truncate text-[11px] text-zinc-500">
                      {API_SCOPE_LABELS[scope]}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <button
            onClick={() => createKey.mutate({ name: name.trim(), scopes })}
            disabled={
              createKey.isPending ||
              name.trim().length === 0 ||
              scopes.length === 0
            }
            className="rounded-lg bg-nexus-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-nexus-500 disabled:opacity-40"
          >
            {createKey.isPending ? 'Creating...' : 'Create key'}
          </button>
        </div>

        <div className="border-t border-zinc-800 pt-3">
          {keys.isLoading ? (
            <p className="text-xs text-zinc-500">Loading keys...</p>
          ) : (keys.data?.length ?? 0) === 0 ? (
            <p className="text-xs text-zinc-500">
              No API keys yet. Create one to let a script search or ask
              questions.
            </p>
          ) : (
            <ul className="space-y-2">
              {keys.data?.map((key: ApiKeyDTO) => (
                <li
                  key={key.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-zinc-200">
                      {key.name}
                      {key.revokedAt && (
                        <span className="ml-2 rounded bg-red-950/50 px-1.5 py-0.5 text-[10px] uppercase text-red-400">
                          revoked
                        </span>
                      )}
                    </p>
                    <p className="truncate font-mono text-[11px] text-zinc-500">
                      ndx_{key.prefix}_…
                    </p>
                    <p className="mt-0.5 flex flex-wrap gap-1">
                      {key.scopes.map((scope) => (
                        <span
                          key={scope}
                          className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400"
                        >
                          {scope}
                        </span>
                      ))}
                    </p>
                    <p className="mt-1 text-[11px] text-zinc-600">
                      {key.lastUsedAt
                        ? `Last used ${new Date(key.lastUsedAt).toLocaleString()}`
                        : 'Never used'}
                    </p>
                  </div>
                  {!key.revokedAt &&
                    (revoking === key.id ? (
                      <span className="flex items-center gap-1.5">
                        <button
                          onClick={() => revokeKey.mutate({ id: key.id })}
                          disabled={revokeKey.isPending}
                          className="rounded-lg bg-red-700 px-2.5 py-1.5 text-[11px] font-medium text-white disabled:opacity-40"
                        >
                          {revokeKey.isPending ? 'Revoking...' : 'Confirm'}
                        </button>
                        <button
                          onClick={() => setRevoking(null)}
                          className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-[11px] text-zinc-400"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setRevoking(key.id)}
                        className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800"
                      >
                        Revoke
                      </button>
                    ))}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
