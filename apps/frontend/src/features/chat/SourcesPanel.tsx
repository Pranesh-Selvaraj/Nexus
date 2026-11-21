import type { Source } from '@nexus/shared-types';
import { pct } from './utils';
import { isImageFileType } from '@nexus/shared-types';
import { documentImageUrl } from '../../lib/document-format';

export function SourcesPanel({
  sources,
  onInspect,
}: {
  sources: Source[];
  onInspect?: () => void;
}) {
  return (
    <div className="mt-3 border-t border-zinc-800 pt-2">
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Sources
        </p>
        {onInspect && (
          <button
            onClick={onInspect}
            className="text-[10px] text-nexus-300 hover:underline"
          >
            Why these sources?
          </button>
        )}
      </div>
      <div className="space-y-1">
        {sources.map((source, i) => (
          <details
            key={source.id}
            className="group rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5"
          >
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-zinc-300">
              <span className="shrink-0 font-mono text-nexus-400">{i + 1}</span>
              {source.cited && (
                <span
                  title="Cited in the answer"
                  className="shrink-0 text-emerald-400"
                >
                  ✓
                </span>
              )}
              <span className="shrink-0 text-zinc-600">·</span>
              <span className="min-w-0 flex-1 truncate">{source.title}</span>
              {source.page != null && (
                <span className="shrink-0 text-zinc-600">
                  p.{source.page}
                  {source.pageEnd != null && source.pageEnd !== source.page
                    ? `–${source.pageEnd}`
                    : ''}
                </span>
              )}
              <span className="shrink-0 text-zinc-600">
                {Math.round(source.similarity * 100)}%
              </span>
            </summary>
            {source.headingPath && source.headingPath.length > 0 && (
              <p className="mt-1 text-[10px] uppercase tracking-wide text-zinc-600">
                {source.headingPath.join(' › ')}
              </p>
            )}
            {isImageFileType(source.fileType) && (
              <div className="mt-1.5 flex items-start gap-2">
                <img
                  src={documentImageUrl(source.documentId)}
                  alt=""
                  className="h-16 w-16 shrink-0 rounded border border-zinc-800 object-cover"
                />
                <p className="text-[10px] text-zinc-600">
                  {source.attached
                    ? `Attached image - its indexed description is source ${i + 1}`
                    : `Image source ${i + 1}`}
                </p>
              </div>
            )}
            <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-zinc-500 group-open:line-clamp-none line-clamp-4">
              {source.content}
            </p>
            {(source.vectorScore != null ||
              source.keywordScore != null ||
              source.fusedScore != null) && (
              <p className="mt-1 text-[10px] text-zinc-600">
                vector {pct(source.vectorScore)} · keyword{' '}
                {pct(source.keywordScore)} · fused {pct(source.fusedScore)}
              </p>
            )}
          </details>
        ))}
      </div>
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-zinc-300">{value}</dd>
    </div>
  );
}
