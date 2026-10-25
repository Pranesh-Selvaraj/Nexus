import { useEffect, useState } from 'react';

import type { ShareAskResult, SharedWorkspace } from '@nexus/shared-types';

/**
 * Public, read-only view of a shared workspace (L-13). Reached at
 * `/share/<token>`; no session and no cookies are involved, and the page can
 * only read documents and ask questions.
 */
export function SharedWorkspacePage({ token }: { token: string }) {
  const [workspace, setWorkspace] = useState<SharedWorkspace | null>(null);
  const [status, setStatus] = useState<
    'loading' | 'ready' | 'missing' | 'error'
  >('loading');
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<ShareAskResult | null>(null);
  const [askError, setAskError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/share/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) {
          setStatus('missing');
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as SharedWorkspace;
        setWorkspace(data);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    if (!question.trim() || asking) return;
    setAsking(true);
    setAskError(null);
    setAnswer(null);
    try {
      const res = await fetch(`/api/share/${encodeURIComponent(token)}/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: question.trim() }),
      });
      const body = (await res.json()) as ShareAskResult | { error?: string };
      if (!res.ok) {
        throw new Error(
          'error' in body && body.error ? body.error : `HTTP ${res.status}`,
        );
      }
      setAnswer(body as ShareAskResult);
    } catch (err) {
      setAskError(err instanceof Error ? err.message : String(err));
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="min-h-full bg-zinc-950 px-4 py-8 text-zinc-100">
      <div className="mx-auto max-w-3xl">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-nexus-300">
          Shared workspace · read only
        </p>

        {status === 'loading' && (
          <p className="mt-6 text-sm text-zinc-500">Loading...</p>
        )}
        {status === 'missing' && (
          <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
            <h1 className="text-lg font-semibold">
              This link is not available
            </h1>
            <p className="mt-2 text-sm text-zinc-400">
              It was revoked, expired, or never existed. Ask the person who
              shared it for a new link.
            </p>
          </div>
        )}
        {status === 'error' && (
          <p className="mt-6 text-sm text-red-400">
            Could not load the shared workspace. Try again later.
          </p>
        )}

        {status === 'ready' && workspace && (
          <>
            <h1 className="mt-2 text-2xl font-bold">{workspace.name}</h1>
            {workspace.description && (
              <p className="mt-1 text-sm text-zinc-400">
                {workspace.description}
              </p>
            )}
            <p className="mt-1 text-xs text-zinc-600">
              {workspace.documents.length} document
              {workspace.documents.length === 1 ? '' : 's'} · answers cite the
              sources below
            </p>

            <form onSubmit={(event) => void ask(event)} className="mt-6">
              <label className="block text-xs font-medium text-zinc-400">
                Ask a question about this workspace
                <div className="mt-1.5 flex gap-2">
                  <input
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    placeholder="What does this material say about…?"
                    maxLength={4000}
                    className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-nexus-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={asking || !question.trim()}
                    className="rounded-lg bg-nexus-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-nexus-500 disabled:opacity-40"
                  >
                    {asking ? 'Thinking…' : 'Ask'}
                  </button>
                </div>
              </label>
            </form>

            {askError && (
              <p className="mt-3 rounded-lg bg-red-950/40 px-3 py-2 text-sm text-red-400">
                {askError}
              </p>
            )}

            {answer && (
              <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
                  {answer.answer}
                </p>
                {answer.sources.length > 0 && (
                  <div className="mt-4 border-t border-zinc-800 pt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                      Sources
                    </p>
                    <ol className="mt-1.5 space-y-1">
                      {answer.sources.map((source, index) => (
                        <li
                          key={source.id}
                          className="flex items-baseline gap-2 text-xs text-zinc-400"
                        >
                          <span className="text-zinc-600">{index + 1}.</span>
                          <span className="min-w-0 truncate">
                            {source.title}
                            {source.page ? ` · p.${source.page}` : ''}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            )}

            <div className="mt-8">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Documents
              </h2>
              <ul className="mt-2 space-y-1.5">
                {workspace.documents.map((doc) => (
                  <li
                    key={doc.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2"
                  >
                    <span className="min-w-0 truncate text-sm text-zinc-200">
                      {doc.title}
                    </span>
                    <span className="shrink-0 text-[11px] text-zinc-500">
                      {doc.fileType ?? 'file'}
                      {doc.metadata?.wordCount
                        ? ` · ${doc.metadata.wordCount.toLocaleString()} words`
                        : ''}
                      {doc.status !== 'ready' ? ` · ${doc.status}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}

        <p className="mt-10 text-[11px] text-zinc-600">
          This is a read-only view shared through Nexus. Nothing here can be
          edited by visitors.
        </p>
      </div>
    </div>
  );
}
