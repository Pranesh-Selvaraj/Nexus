import { useState } from 'react';
import { useToast } from '../../components/Toast';
import { trpc } from '../../lib/trpc';

export function Notes({ workspaceId }: { workspaceId: string }) {
  const utils = trpc.useUtils();
  const toast = useToast();
  const notes = trpc.notes.notes.list.useQuery({ workspaceId });
  const highlights = trpc.notes.highlights.list.useQuery({ workspaceId });
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const invalidate = () => {
    void utils.notes.notes.list.invalidate({ workspaceId });
    void utils.notes.highlights.list.invalidate({ workspaceId });
  };

  const createNote = trpc.notes.notes.create.useMutation({
    onSuccess: () => {
      setTitle('');
      setContent('');
      invalidate();
    },
    onError: (err) =>
      toast.push({
        kind: 'error',
        message: `Save note failed: ${err.message}`,
      }),
  });
  const deleteNote = trpc.notes.notes.delete.useMutation({
    onSuccess: invalidate,
  });
  const deleteHighlight = trpc.notes.highlights.delete.useMutation({
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold">Notes</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (title.trim()) {
              createNote.mutate({
                workspaceId,
                title: title.trim(),
                contentMd: content,
              });
            }
          }}
          className="mt-3 space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4"
        >
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Note title"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-nexus-500"
          />
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Write in Markdown…"
            rows={3}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-nexus-500"
          />
          <button
            type="submit"
            disabled={!title.trim() || createNote.isPending}
            className="rounded-lg bg-nexus-600 px-4 py-2 text-sm font-semibold text-white hover:bg-nexus-500 disabled:opacity-40"
          >
            {createNote.isPending ? 'Saving…' : 'Save note'}
          </button>
        </form>

        <ul className="mt-4 space-y-2">
          {notes.data?.map((note) => (
            <li
              key={note.id}
              className="group rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{note.title}</p>
                  {note.contentMd && (
                    <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-zinc-500">
                      {note.contentMd}
                    </p>
                  )}
                  {note.tags.length > 0 && (
                    <p className="mt-1 text-[10px] text-zinc-600">
                      {note.tags.join(' · ')}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => deleteNote.mutate({ noteId: note.id })}
                  aria-label="Delete note"
                  className="rounded p-1 text-zinc-600 opacity-0 hover:bg-zinc-800 hover:text-red-400 group-hover:opacity-100"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
          {notes.data?.length === 0 && (
            <li className="text-xs text-zinc-600">
              No notes yet. Select a passage in chat and choose “Highlight”.
            </li>
          )}
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Highlights</h2>
        <ul className="mt-3 space-y-2">
          {highlights.data?.map((highlight) => (
            <li
              key={highlight.id}
              className="group rounded-xl border border-amber-900/30 bg-amber-950/10 px-4 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="border-l-2 border-amber-500/60 pl-3 text-sm text-zinc-300">
                    “{highlight.quotedText.slice(0, 300)}”
                  </p>
                  {highlight.note && (
                    <p className="mt-1.5 text-xs text-zinc-500">
                      {highlight.note}
                    </p>
                  )}
                </div>
                <button
                  onClick={() =>
                    deleteHighlight.mutate({ highlightId: highlight.id })
                  }
                  aria-label="Delete highlight"
                  className="rounded p-1 text-zinc-600 opacity-0 hover:bg-zinc-800 hover:text-red-400 group-hover:opacity-100"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
          {highlights.data?.length === 0 && (
            <li className="text-xs text-zinc-600">
              No highlights yet. Select text in a chat answer to save one.
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
