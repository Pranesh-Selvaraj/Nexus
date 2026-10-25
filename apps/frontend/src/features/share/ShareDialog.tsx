import { useState } from 'react';

import { useToast } from '../../components/Toast';
import { trpc } from '../../lib/trpc';

interface Props {
  workspaceId: string;
  onClose: () => void;
}

/**
 * Read-only share links (L-13). A link is a capability URL: the token is shown
 * once at creation and only its hash is stored, so existing links cannot be
 * re-displayed — revoke and create a new one if it was lost.
 */
export function ShareDialog({ workspaceId, onClose }: Props) {
  const toast = useToast();
  const utils = trpc.useUtils();
  const links = trpc.share.list.useQuery({ workspaceId });
  const [label, setLabel] = useState('');
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const create = trpc.share.create.useMutation({
    onSuccess: (result) => {
      setCreatedUrl(result.url);
      setCopied(false);
      setLabel('');
      void utils.share.list.invalidate({ workspaceId });
    },
    onError: (err) =>
      toast.push({
        kind: 'error',
        message: `Could not create link: ${err.message}`,
      }),
  });
  const revoke = trpc.share.revoke.useMutation({
    onSuccess: () => {
      void utils.share.list.invalidate({ workspaceId });
      toast.push({ kind: 'info', message: 'Share link revoked' });
    },
    onError: (err) => toast.push({ kind: 'error', message: err.message }),
  });

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      toast.push({ kind: 'error', message: 'Copy failed' });
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Share workspace"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-zinc-700 bg-zinc-900 p-5 sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Share this workspace</h2>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              Anyone with the link can read the documents and ask questions,
              without an account. Links cannot modify anything and can be
              revoked at any time.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800"
          >
            Close
          </button>
        </div>

        {createdUrl && (
          <div className="mt-4 rounded-xl border border-emerald-800/60 bg-emerald-950/30 p-3">
            <p className="text-xs font-medium text-emerald-300">
              Copy this link now — it is shown only once.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input
                readOnly
                value={createdUrl}
                aria-label="Share link"
                onFocus={(event) => event.currentTarget.select()}
                className="min-w-0 flex-1 rounded-lg bg-zinc-950 px-3 py-2 text-xs text-emerald-200"
              />
              <button
                onClick={() => void copy(createdUrl)}
                className="rounded-lg border border-emerald-700 px-3 py-2 text-xs text-emerald-300 hover:bg-emerald-900/40"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
          <label className="block text-xs font-medium text-zinc-400">
            Label (optional)
            <input
              value={label}
              maxLength={80}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="e.g. for the study group"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-nexus-500 focus:outline-none"
            />
          </label>
          <label className="block text-xs font-medium text-zinc-400">
            Expires
            <select
              value={expiresInDays}
              onChange={(event) => setExpiresInDays(Number(event.target.value))}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
            >
              <option value={7}>in 7 days</option>
              <option value={30}>in 30 days</option>
              <option value={90}>in 90 days</option>
              <option value={0}>never</option>
            </select>
          </label>
        </div>
        <button
          onClick={() =>
            create.mutate({
              workspaceId,
              label: label.trim() || undefined,
              expiresInDays: expiresInDays || undefined,
            })
          }
          disabled={create.isPending}
          className="mt-2 rounded-lg bg-nexus-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-nexus-500 disabled:opacity-40"
        >
          {create.isPending ? 'Creating...' : 'Create read-only link'}
        </button>

        <div className="mt-5 border-t border-zinc-800 pt-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Existing links
          </p>
          {links.isLoading && (
            <p className="mt-2 text-xs text-zinc-500">Loading...</p>
          )}
          {(links.data?.length ?? 0) === 0 && !links.isLoading && (
            <p className="mt-2 text-xs text-zinc-500">No share links yet.</p>
          )}
          <ul className="mt-2 space-y-1.5">
            {links.data?.map((link) => (
              <li
                key={link.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs text-zinc-200">
                    {link.label ?? 'Untitled link'}
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    Created {new Date(link.createdAt).toLocaleDateString()}
                    {link.expiresAt
                      ? ` · expires ${new Date(link.expiresAt).toLocaleDateString()}`
                      : ' · no expiry'}
                    {link.revokedAt
                      ? ' · revoked'
                      : !link.active
                        ? ' · expired'
                        : ''}
                  </p>
                </div>
                {link.active ? (
                  <button
                    onClick={() => revoke.mutate({ id: link.id })}
                    disabled={revoke.isPending}
                    className="shrink-0 rounded-lg border border-red-900/60 px-2.5 py-1.5 text-[11px] text-red-400 hover:bg-red-950/40 disabled:opacity-40"
                  >
                    Revoke
                  </button>
                ) : (
                  <span className="shrink-0 text-[11px] text-zinc-600">
                    inactive
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
