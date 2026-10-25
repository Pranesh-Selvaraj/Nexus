import { useState } from 'react';

import {
  WEBHOOK_EVENTS,
  type WebhookDTO,
  type WebhookEvent,
} from '@nexus/shared-types';

import { useToast } from '../../components/Toast';
import { trpc } from '../../lib/trpc';

const EVENT_LABELS: Record<WebhookEvent, string> = {
  'document.indexed': 'Document indexed',
  'document.failed': 'Indexing failed',
};

/**
 * Webhooks (P-5): a URL is POSTed a signed JSON payload when indexing finishes.
 * The signing secret is shown once; the list keeps the last delivery status so
 * a receiver that started failing is visible without reading worker logs.
 */
export function WebhooksCard() {
  const toast = useToast();
  const utils = trpc.useUtils();
  const hooks = trpc.webhook.list.useQuery();
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<WebhookEvent[]>(['document.indexed']);
  const [created, setCreated] = useState<{ id: string; secret: string } | null>(
    null,
  );

  const create = trpc.webhook.create.useMutation({
    onSuccess: (result) => {
      setCreated({ id: result.id, secret: result.secret });
      setUrl('');
      setEvents(['document.indexed']);
      void utils.webhook.list.invalidate();
    },
    onError: (err) =>
      toast.push({
        kind: 'error',
        message: `Could not add webhook: ${err.message}`,
      }),
  });

  const update = trpc.webhook.update.useMutation({
    onSuccess: () => void utils.webhook.list.invalidate(),
    onError: (err) => toast.push({ kind: 'error', message: err.message }),
  });

  const remove = trpc.webhook.delete.useMutation({
    onSuccess: () => void utils.webhook.list.invalidate(),
  });

  const test = trpc.webhook.test.useMutation({
    onSuccess: () => {
      toast.push({ kind: 'success', message: 'Test delivery queued' });
      // Give the worker a moment, then refresh the last-status columns.
      setTimeout(() => void utils.webhook.list.invalidate(), 1500);
    },
    onError: (err) => toast.push({ kind: 'error', message: err.message }),
  });

  function toggleEvent(event: WebhookEvent) {
    setEvents((current) =>
      current.includes(event)
        ? current.filter((item) => item !== event)
        : [...current, event],
    );
  }

  async function copySecret() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.secret);
      toast.push({ kind: 'success', message: 'Signing secret copied' });
    } catch {
      toast.push({ kind: 'error', message: 'Copy failed' });
    }
  }

  return (
    <section className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900/40">
      <h2 className="border-b border-zinc-800 px-5 py-3 text-sm font-semibold">
        Webhooks
      </h2>
      <div className="space-y-4 p-5">
        <p className="text-xs leading-relaxed text-zinc-500">
          Nexus POSTs a JSON event to your URL when indexing finishes. Each
          request carries <code>X-Nexus-Signature: sha256=&lt;hmac&gt;</code>{' '}
          (HMAC-SHA256 of the raw body with the secret shown at creation),{' '}
          <code>X-Nexus-Event</code> and <code>X-Nexus-Delivery</code>. Failed
          deliveries retry with backoff five times.
        </p>

        {created && (
          <div className="rounded-xl border border-emerald-800/60 bg-emerald-950/30 p-3">
            <p className="text-xs font-medium text-emerald-300">
              Copy this signing secret now — it is not shown again.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-zinc-950 px-3 py-2 text-xs text-emerald-200">
                {created.secret}
              </code>
              <button
                onClick={() => void copySecret()}
                className="rounded-lg border border-emerald-700 px-3 py-2 text-xs text-emerald-300 transition-colors hover:bg-emerald-900/40"
              >
                Copy
              </button>
              <button
                onClick={() => setCreated(null)}
                className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-400 transition-colors hover:bg-zinc-800"
              >
                Done
              </button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <label className="block text-xs font-medium text-zinc-400">
            Endpoint URL
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/hooks/nexus"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-nexus-500 focus:outline-none"
            />
          </label>
          <fieldset>
            <legend className="text-xs font-medium text-zinc-400">
              Events
            </legend>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {WEBHOOK_EVENTS.map((event) => (
                <label
                  key={event}
                  className="flex items-center gap-2 rounded-lg border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-300"
                >
                  <input
                    type="checkbox"
                    checked={events.includes(event)}
                    onChange={() => toggleEvent(event)}
                    className="h-3.5 w-3.5 accent-nexus-500"
                  />
                  {EVENT_LABELS[event]}
                </label>
              ))}
            </div>
          </fieldset>
          <button
            onClick={() => create.mutate({ url: url.trim(), events })}
            disabled={create.isPending || !url.trim() || events.length === 0}
            className="rounded-lg bg-nexus-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-nexus-500 disabled:opacity-40"
          >
            {create.isPending ? 'Adding...' : 'Add webhook'}
          </button>
        </div>

        <div className="border-t border-zinc-800 pt-3">
          {hooks.isLoading ? (
            <p className="text-xs text-zinc-500">Loading webhooks...</p>
          ) : (hooks.data?.length ?? 0) === 0 ? (
            <p className="text-xs text-zinc-500">
              No webhooks yet. Add one to react to indexing without polling.
            </p>
          ) : (
            <ul className="space-y-2">
              {hooks.data?.map((hook: WebhookDTO) => (
                <li
                  key={hook.id}
                  className="rounded-xl border border-zinc-800 px-3 py-2"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs text-zinc-200">
                        {hook.url}
                      </p>
                      <p className="mt-0.5 flex flex-wrap gap-1">
                        {hook.events.map((event) => (
                          <span
                            key={event}
                            className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400"
                          >
                            {event}
                          </span>
                        ))}
                      </p>
                      <p className="mt-1 text-[11px] text-zinc-600">
                        {hook.lastDeliveryAt
                          ? `Last delivery ${new Date(hook.lastDeliveryAt).toLocaleString()} · ${hook.lastStatus ?? 'error'}`
                          : 'No deliveries yet'}
                        {hook.lastError ? ` · ${hook.lastError}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() =>
                          update.mutate({ id: hook.id, enabled: !hook.enabled })
                        }
                        className={`rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors ${
                          hook.enabled
                            ? 'border-emerald-800 text-emerald-400 hover:bg-emerald-950/40'
                            : 'border-zinc-700 text-zinc-500 hover:bg-zinc-800'
                        }`}
                      >
                        {hook.enabled ? 'Enabled' : 'Disabled'}
                      </button>
                      <button
                        onClick={() => test.mutate({ id: hook.id })}
                        disabled={test.isPending}
                        className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800 disabled:opacity-40"
                      >
                        Send test
                      </button>
                      <button
                        onClick={() => remove.mutate({ id: hook.id })}
                        disabled={remove.isPending}
                        className="rounded-lg border border-red-900/60 px-2.5 py-1.5 text-[11px] text-red-400 transition-colors hover:bg-red-950/40 disabled:opacity-40"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
