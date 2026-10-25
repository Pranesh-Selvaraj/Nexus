import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';

import { trpc } from '../../lib/trpc';

/**
 * Formats accepted by the picker. The server decides the real type from the
 * bytes (magic-number validation) - this list only makes the file dialog
 * useful and keeps obviously unsupported names out of the request.
 */
const ACCEPT = {
  'application/pdf': ['.pdf'],
  'application/epub+zip': ['.epub'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    '.docx',
  ],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': [
    '.pptx',
  ],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
    '.xlsx',
  ],
  'application/vnd.oasis.opendocument.text': ['.odt'],
  'application/rtf': ['.rtf'],
  'application/zip': ['.zip'],
  'text/plain': ['.txt', '.md', '.markdown', '.srt', '.vtt'],
  'text/csv': ['.csv'],
  'application/json': ['.json'],
  'text/html': ['.html', '.htm'],
  'image/*': [
    '.png',
    '.jpg',
    '.jpeg',
    '.webp',
    '.gif',
    '.tif',
    '.tiff',
    '.bmp',
  ],
  'audio/*': ['.mp3', '.wav', '.ogg', '.oga', '.m4a', '.flac', '.aac'],
  'video/*': ['.webm', '.mp4', '.mov'],
};

const FORMAT_HINT =
  'PDF · EPUB · DOCX · PPTX · XLSX · ODT · RTF · HTML · ZIP · text · subtitles · audio/video · images';

interface Props {
  workspaceId: string;
}

export function UploadDropzone({ workspaceId }: Props) {
  const utils = trpc.useUtils();
  const publicConfig = trpc.config.public.useQuery(undefined);
  // One source of truth for the limit: the same setting the server enforces.
  const maxUploadMb = publicConfig.data?.maxUploadMb ?? 25;
  const vision = publicConfig.data?.vision;
  const [uploading, setUploading] = useState(false);
  const [url, setUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<{
    kind: 'ok' | 'err';
    text: string;
  } | null>(null);

  const refreshLibrary = useCallback(() => {
    void utils.document.listByWorkspace.invalidate({ workspaceId });
    void utils.document.images.invalidate({ workspaceId });
    void utils.workspace.list.invalidate();
  }, [utils, workspaceId]);

  const onDrop = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setUploading(true);
      setMessage(null);

      const results = await Promise.allSettled(
        files.map(async (file) => {
          const form = new FormData();
          // The workspaceId part must precede the file part: multer parses
          // parts sequentially, and later fields are not available while the
          // file is being written. (The backend also relocates the file after
          // validation, but this keeps the staging dir deterministic.)
          form.append('workspaceId', workspaceId);
          form.append('file', file);
          const response = await fetch('/api/upload', {
            method: 'POST',
            body: form,
          });
          if (!response.ok) {
            const body = (await response.json().catch(() => null)) as {
              error?: string;
            } | null;
            throw new Error(
              body?.error ?? `Upload failed (${response.status})`,
            );
          }
          return (await response.json()) as { duplicate?: boolean };
        }),
      );

      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length === 0) {
        const duplicates = results.filter(
          (r) => r.status === 'fulfilled' && r.value?.duplicate,
        ).length;
        setMessage({
          kind: 'ok',
          text:
            duplicates > 0
              ? `Queued ${files.length - duplicates} file${files.length - duplicates === 1 ? '' : 's'}; ${duplicates} already in this workspace.`
              : `Queued ${files.length} file${files.length === 1 ? '' : 's'} for indexing.`,
        });
      } else {
        const first = (failed[0] as PromiseRejectedResult).reason as Error;
        setMessage({ kind: 'err', text: first.message });
      }
      setUploading(false);
      refreshLibrary();
      // Don't leave the success notice on screen forever.
      window.setTimeout(() => setMessage(null), 6_000);
    },
    [workspaceId, refreshLibrary],
  );

  async function ingestUrl(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || importing) return;
    setImporting(true);
    setMessage(null);
    try {
      const response = await fetch('/api/ingest/url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId, url: trimmed }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        kind?: 'article' | 'video';
        title?: string;
        wordCount?: number;
        duplicate?: boolean;
      } | null;
      if (!response.ok) {
        throw new Error(body?.error ?? `Import failed (${response.status})`);
      }
      setUrl('');
      if (body?.duplicate) {
        setMessage({
          kind: 'ok',
          text: `“${body.title ?? 'That page'}” is already in this workspace.`,
        });
      } else {
        setMessage({
          kind: 'ok',
          text:
            body?.kind === 'video'
              ? `Queued the video transcript (${body?.wordCount ?? 0} words) for indexing.`
              : `Queued the article (${body?.wordCount ?? 0} words) for indexing.`,
        });
      }
      refreshLibrary();
    } catch (error) {
      setMessage({
        kind: 'err',
        text: error instanceof Error ? error.message : 'Import failed',
      });
    } finally {
      setImporting(false);
    }
  }

  const { getRootProps, getInputProps, isDragActive, isDragReject } =
    useDropzone({
      onDrop,
      onDropRejected: (rejections) => {
        const code = rejections[0]?.errors[0]?.code;
        setMessage({
          kind: 'err',
          text:
            code === 'file-too-large'
              ? `File exceeds the ${maxUploadMb} MB upload limit`
              : (rejections[0]?.errors[0]?.message ?? 'File rejected'),
        });
      },
      accept: ACCEPT,
      multiple: true,
      disabled: uploading,
      maxSize: maxUploadMb * 1024 * 1024,
    });

  return (
    <div className="border-b border-zinc-800 p-3">
      <div
        {...getRootProps()}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-3 text-center transition-colors ${
          isDragActive
            ? 'border-nexus-500 bg-nexus-600/10'
            : isDragReject
              ? 'border-red-600 bg-red-950/20'
              : 'border-zinc-700 hover:border-zinc-500'
        }`}
      >
        <input {...getInputProps()} />
        {uploading ? (
          <p className="text-sm text-zinc-300">Uploading...</p>
        ) : isDragActive ? (
          <p className="text-sm text-nexus-300">Drop files here</p>
        ) : (
          <>
            <div className="flex items-center justify-center gap-2">
              <UploadIcon className="h-4 w-4 text-zinc-500" />
              <p className="text-sm font-medium text-zinc-300">
                Drop files or click to browse
              </p>
            </div>
            <p
              className="mt-1 line-clamp-2 text-[10px] leading-4 text-zinc-500"
              title={FORMAT_HINT}
            >
              PDF, EPUB, DOCX, PPTX, XLSX, ODT, RTF, HTML, ZIP, text, subtitles,
              audio/video, images · up to {maxUploadMb} MB
              {vision ? ` · images up to ${vision.maxImageMb} MB` : ''}
            </p>
          </>
        )}
      </div>

      {/* URL / YouTube ingestion: extracted server-side behind the SSRF guard,
          then indexed like any other document. */}
      <form onSubmit={(event) => void ingestUrl(event)} className="mt-2">
        <div className="flex items-center gap-1.5">
          <label htmlFor="ingest-url" className="sr-only">
            Import a web page or YouTube video
          </label>
          <input
            id="ingest-url"
            type="url"
            inputMode="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="Paste an article or YouTube URL"
            disabled={importing}
            className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-nexus-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={importing || !url.trim()}
            className="shrink-0 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-40"
          >
            {importing ? 'Importing...' : 'Add URL'}
          </button>
        </div>
      </form>

      {message && (
        <p
          className={`mt-2 rounded-lg px-3 py-2 text-xs ${
            message.kind === 'ok'
              ? 'bg-emerald-950/40 text-emerald-400'
              : 'bg-red-950/40 text-red-400'
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
    >
      <path
        d="M12 16V4m0 0 4 4m-4-4-4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
        strokeLinecap="round"
      />
    </svg>
  );
}
