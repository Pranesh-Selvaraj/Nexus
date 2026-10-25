import { lazy, Suspense, useState } from 'react';

import type { DocumentDTO } from '@nexus/shared-types';
import { VISION_MODES, type VisionMode } from '@nexus/shared-types';

import { trpc } from '../../lib/trpc';
import { documentImageUrl, formatLabel } from '../../lib/document-format';

// The renderer pulls in KaTeX + highlighting; keep it in its own chunk.
const Markdown = lazy(() =>
  import('../../components/Markdown').then((m) => ({ default: m.Markdown })),
);

interface Props {
  workspaceId: string;
  doc: DocumentDTO;
  onClose: () => void;
}

/**
 * Vision studio: analyse one library image in a chosen mode (describe, art
 * critique, diagram, equations) and keep the result on screen. OCR text is
 * shown separately when tesseract produced it, because exact labels and
 * formulas are what the learner usually wants to copy.
 */
export function ImageAnalysisPanel({ workspaceId, doc, onClose }: Props) {
  const [mode, setMode] = useState<VisionMode>('general');
  const [question, setQuestion] = useState('');
  const analyze = trpc.vision.analyze.useMutation();
  const result = analyze.data;
  const modeInfo = VISION_MODES.find((item) => item.id === mode);

  function run(): void {
    analyze.mutate({
      workspaceId,
      documentId: doc.id,
      mode,
      question: question.trim() || undefined,
    });
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Analyse ${doc.title}`}
    >
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-zinc-800 bg-zinc-950 shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-zinc-800 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-zinc-100">
              {doc.title}
            </h2>
            <p className="text-[11px] text-zinc-500">
              {formatLabel(doc.fileType) ?? 'Image'} · visual analysis
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close image analysis"
            className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <img
            src={documentImageUrl(doc.id)}
            alt={doc.title}
            className="mx-auto max-h-56 w-auto rounded-lg border border-zinc-800 object-contain"
          />

          <div className="mt-4 flex flex-wrap gap-1.5">
            {VISION_MODES.map((item) => (
              <button
                key={item.id}
                onClick={() => setMode(item.id)}
                aria-pressed={mode === item.id}
                className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                  mode === item.id
                    ? 'border-nexus-500 bg-nexus-600/20 text-nexus-200'
                    : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          {modeInfo && (
            <p className="mt-1.5 text-[11px] text-zinc-500">{modeInfo.hint}</p>
          )}

          <label
            htmlFor="vision-question"
            className="mt-3 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500"
          >
            Ask about this image (optional)
          </label>
          <input
            id="vision-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') run();
            }}
            placeholder="e.g. What does the label on the left arrow say?"
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-nexus-500"
          />

          <button
            onClick={run}
            disabled={analyze.isPending}
            className="mt-3 w-full rounded-lg bg-nexus-600 py-2 text-xs font-semibold text-white transition-colors hover:bg-nexus-500 disabled:opacity-50"
          >
            {analyze.isPending ? 'Analysing...' : 'Run analysis'}
          </button>

          {analyze.isError && (
            <p className="mt-3 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
              {analyze.error.message}
            </p>
          )}

          {result && (
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  {VISION_MODES.find((item) => item.id === result.mode)
                    ?.label ?? 'Analysis'}
                </p>
                <p className="truncate text-[10px] text-zinc-600">
                  {result.model}
                  {result.cached ? ' · cached' : ''}
                </p>
              </div>
              <div className="markdown-body rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-sm leading-relaxed">
                <Suspense
                  fallback={
                    <span className="whitespace-pre-wrap">
                      {result.analysis}
                    </span>
                  }
                >
                  <Markdown content={result.analysis} />
                </Suspense>
              </div>
              {result.ocrText && (
                <details className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                  <summary className="cursor-pointer text-[11px] text-zinc-400">
                    OCR text ({result.ocrText.length.toLocaleString()} chars)
                  </summary>
                  <p className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-500">
                    {result.ocrText}
                  </p>
                </details>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
