import { Markdown } from '../../components/LazyMarkdown';
import { ARTIFACT_KIND_LABELS } from './constants';
import { Suspense, useState } from 'react';
import type { ArtifactKind } from '@nexus/contracts';
import { useToast } from '../../components/Toast';
import { trpc } from '../../platform/trpc';

export function Artifacts({ workspaceId }: { workspaceId: string }) {
  const utils = trpc.useUtils();
  const toast = useToast();
  const artifacts = trpc.artifacts.list.useQuery({ workspaceId });
  const documents = trpc.document.listByWorkspace.useQuery({ workspaceId });
  const [documentId, setDocumentId] = useState('');
  const [kind, setKind] = useState<ArtifactKind>('summary');

  const generate = trpc.artifacts.generate.useMutation({
    onSuccess: () => {
      toast.push({ kind: 'success', message: 'Artifact created' });
      void utils.artifacts.list.invalidate({ workspaceId });
    },
    onError: (err) =>
      toast.push({ kind: 'error', message: `Artifact failed: ${err.message}` }),
  });
  const remove = trpc.artifacts.delete.useMutation({
    onSuccess: () => void utils.artifacts.list.invalidate({ workspaceId }),
  });

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <h3 className="text-sm font-semibold">Generate a study artifact</h3>
        <p className="mt-1 text-xs text-zinc-500">
          Turn a document into a summary, a study guide, a glossary or a Mermaid
          mind map. Artifacts are saved in this workspace's studio.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <select
            aria-label="Artifact document"
            value={documentId}
            onChange={(event) => setDocumentId(event.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-nexus-500"
          >
            <option value="">Select a document…</option>
            {documents.data
              ?.filter((doc) => doc.status === 'ready')
              .map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.title}
                </option>
              ))}
          </select>
          <select
            aria-label="Artifact kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as ArtifactKind)}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-nexus-500"
          >
            {(Object.keys(ARTIFACT_KIND_LABELS) as ArtifactKind[]).map(
              (artifactKind) => (
                <option key={artifactKind} value={artifactKind}>
                  {ARTIFACT_KIND_LABELS[artifactKind]}
                </option>
              ),
            )}
          </select>
          <button
            onClick={() => generate.mutate({ workspaceId, documentId, kind })}
            disabled={!documentId || generate.isPending}
            className="rounded-lg bg-nexus-600 px-4 py-2 text-sm font-semibold text-white hover:bg-nexus-500 disabled:opacity-40"
          >
            {generate.isPending ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Studio</h2>
        <ul className="mt-3 space-y-2">
          {artifacts.data?.map((artifact) => (
            <li
              key={artifact.id}
              className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
            >
              <div className="flex items-center gap-2">
                <span className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                  {ARTIFACT_KIND_LABELS[artifact.kind]}
                </span>
                <p className="min-w-0 flex-1 truncate text-sm font-medium">
                  {artifact.title}
                </p>
                <button
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(artifact.contentMd)
                      .then(() =>
                        toast.push({ kind: 'success', message: 'Copied' }),
                      );
                  }}
                  className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                >
                  Copy
                </button>
                <button
                  onClick={() => remove.mutate({ artifactId: artifact.id })}
                  aria-label="Delete artifact"
                  className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                >
                  ✕
                </button>
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-nexus-300">
                  View
                </summary>
                <div className="markdown-body mt-2 max-h-96 overflow-y-auto rounded-lg bg-zinc-950/60 p-3">
                  <Suspense
                    fallback={
                      <pre className="whitespace-pre-wrap text-xs text-zinc-400">
                        {artifact.contentMd}
                      </pre>
                    }
                  >
                    <Markdown content={artifact.contentMd} />
                  </Suspense>
                </div>
              </details>
            </li>
          ))}
          {artifacts.data?.length === 0 && (
            <li className="text-xs text-zinc-600">
              No artifacts yet. Generate one from a document above.
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
