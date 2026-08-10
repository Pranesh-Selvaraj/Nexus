import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';

import { trpc } from '../../lib/trpc';

const ACCEPT = {
  'application/pdf': ['.pdf'],
  'text/plain': ['.txt', '.md', '.markdown'],
  'text/csv': ['.csv'],
  'application/json': ['.json'],
};

interface Props {
  workspaceId: string;
}

export function UploadDropzone({ workspaceId }: Props) {
  const utils = trpc.useContext();
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const onDrop = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setUploading(true);
      setMessage(null);

      const results = await Promise.allSettled(
        files.map(async (file) => {
          const form = new FormData();
          form.append('file', file);
          form.append('workspaceId', workspaceId);
          const response = await fetch('/api/upload', {
            method: 'POST',
            body: form,
          });
          if (!response.ok) {
            const body = (await response.json().catch(() => null)) as { error?: string } | null;
            throw new Error(body?.error ?? `Upload failed (${response.status})`);
          }
        }),
      );

      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length === 0) {
        setMessage({ kind: 'ok', text: `Queued ${files.length} file${files.length === 1 ? '' : 's'} for indexing.` });
      } else {
        const first = (failed[0] as PromiseRejectedResult).reason as Error;
        setMessage({ kind: 'err', text: first.message });
      }
      setUploading(false);
      void utils.document.listByWorkspace.invalidate({ workspaceId });
    },
    [workspaceId, utils],
  );

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop,
    accept: ACCEPT,
    multiple: true,
    disabled: uploading,
    maxSize: 25 * 1024 * 1024,
  });

  return (
    <div className="border-b border-zinc-800 p-3">
      <div
        {...getRootProps()}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-4 text-center transition-colors ${
          isDragActive
            ? 'border-nexus-500 bg-nexus-600/10'
            : isDragReject
              ? 'border-red-600 bg-red-950/20'
              : 'border-zinc-700 hover:border-zinc-500'
        }`}
      >
        <input {...getInputProps()} />
        <UploadIcon className="mx-auto mb-2 h-6 w-6 text-zinc-500" />
        {uploading ? (
          <p className="text-sm text-zinc-300">Uploading...</p>
        ) : isDragActive ? (
          <p className="text-sm text-nexus-300">Drop files here</p>
        ) : (
          <>
            <p className="text-sm font-medium text-zinc-300">
              Drag &amp; drop documents
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              or click to browse · PDF, TXT, MD, CSV, JSON
            </p>
          </>
        )}
      </div>

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
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path
        d="M12 16V4m0 0 4 4m-4-4-4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}