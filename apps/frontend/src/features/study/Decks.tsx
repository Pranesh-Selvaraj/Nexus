import { useState } from 'react';
import { useToast } from '../../components/Toast';
import { trpc } from '../../platform/trpc';

export function Decks({
  workspaceId,
  onReview,
}: {
  workspaceId: string;
  onReview: (deckId: string) => void;
}) {
  const utils = trpc.useUtils();
  const toast = useToast();
  const decks = trpc.study.decks.list.useQuery({ workspaceId });
  const documents = trpc.document.listByWorkspace.useQuery({ workspaceId });
  const [newDeck, setNewDeck] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [count, setCount] = useState('8');

  const invalidate = () => {
    void utils.study.decks.list.invalidate({ workspaceId });
    void utils.study.progress.invalidate({ workspaceId });
  };

  const createDeck = trpc.study.decks.create.useMutation({
    onSuccess: () => {
      setNewDeck('');
      invalidate();
    },
    onError: (err) =>
      toast.push({
        kind: 'error',
        message: `Create deck failed: ${err.message}`,
      }),
  });
  const deleteDeck = trpc.study.decks.delete.useMutation({
    onSuccess: invalidate,
    onError: (err) =>
      toast.push({ kind: 'error', message: `Delete failed: ${err.message}` }),
  });
  const generate = trpc.study.cards.generate.useMutation({
    onSuccess: (data) => {
      toast.push({
        kind: 'success',
        message: `Created ${data.created.length} flashcard${data.created.length === 1 ? '' : 's'}.`,
      });
      invalidate();
    },
    onError: (err) =>
      toast.push({
        kind: 'error',
        message: `Generation failed: ${err.message}`,
      }),
  });

  const exportQuery = trpc.study.cards.exportCsv.useQuery(
    { workspaceId },
    { enabled: false },
  );

  async function downloadCsv() {
    const result = await exportQuery.refetch();
    const payload = result.data;
    if (!payload) return;
    const blob = new Blob([payload.csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = payload.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold">Decks</h2>
        <ul className="mt-3 space-y-2">
          {decks.data?.map((deck) => (
            <li
              key={deck.id}
              className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{deck.name}</p>
                <p className="text-xs text-zinc-500">
                  {deck.cardCount} card{deck.cardCount === 1 ? '' : 's'} ·{' '}
                  {deck.dueCount} due
                  {deck.newCount > 0 ? ` · ${deck.newCount} new` : ''}
                </p>
              </div>
              <button
                onClick={() => onReview(deck.id)}
                disabled={deck.dueCount === 0}
                className="rounded-lg bg-nexus-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-nexus-500 disabled:opacity-40"
              >
                Review
              </button>
              <button
                onClick={() => {
                  if (confirm(`Delete deck "${deck.name}" and its cards?`)) {
                    deleteDeck.mutate({ deckId: deck.id });
                  }
                }}
                className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                title="Delete deck"
                aria-label="Delete deck"
              >
                ✕
              </button>
            </li>
          ))}
          {decks.data?.length === 0 && (
            <li className="rounded-xl border border-dashed border-zinc-800 px-4 py-6 text-center text-xs text-zinc-600">
              No decks yet. Generate cards from a document below.
            </li>
          )}
        </ul>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (newDeck.trim()) {
              createDeck.mutate({ workspaceId, name: newDeck.trim() });
            }
          }}
          className="mt-3 flex gap-2"
        >
          <input
            value={newDeck}
            onChange={(event) => setNewDeck(event.target.value)}
            placeholder="New deck name"
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-nexus-500"
          />
          <button
            type="submit"
            disabled={!newDeck.trim() || createDeck.isPending}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
          >
            Add deck
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <h3 className="text-sm font-semibold">
          Generate cards from a document
        </h3>
        <p className="mt-1 text-xs text-zinc-500">
          The chat model turns the document's indexed passages into flashcards.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <select
            value={documentId}
            onChange={(event) => setDocumentId(event.target.value)}
            aria-label="Document"
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
          <input
            type="number"
            min={1}
            max={30}
            value={count}
            onChange={(event) => setCount(event.target.value)}
            aria-label="Number of cards"
            className="w-20 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-nexus-500"
          />
          <button
            onClick={() =>
              generate.mutate({
                workspaceId,
                documentId,
                count: Math.min(30, Math.max(1, Number(count) || 8)),
              })
            }
            disabled={!documentId || generate.isPending}
            className="rounded-lg bg-nexus-600 px-4 py-2 text-sm font-semibold text-white hover:bg-nexus-500 disabled:opacity-40"
          >
            {generate.isPending ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </section>

      <section className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
        <div>
          <p className="text-sm font-medium">Export to Anki</p>
          <p className="text-xs text-zinc-500">
            Downloads a CSV (front, back) that Anki imports directly.
          </p>
        </div>
        <button
          onClick={() => void downloadCsv()}
          disabled={exportQuery.isFetching}
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
        >
          {exportQuery.isFetching ? 'Exporting…' : 'Export CSV'}
        </button>
      </section>
    </div>
  );
}
