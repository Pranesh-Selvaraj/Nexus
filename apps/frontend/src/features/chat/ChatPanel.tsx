import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import type {
  ChatHistoryMessage,
  MessageDTO,
  Source,
  Usage,
} from '@nexus/shared-types';

import { useToast } from '../../components/Toast';
import { trpc } from '../../lib/trpc';

// KaTeX + syntax highlighting are large; keep them out of the workspace chunk
// and load the renderer the first time an answer is displayed.
const Markdown = lazy(() =>
  import('../../components/Markdown').then((m) => ({ default: m.Markdown })),
);

/** Plain-text stand-in while the renderer chunk loads. */
function MarkdownFallback({ content }: { content: string }) {
  return <span className="whitespace-pre-wrap">{content}</span>;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  usage?: Usage | null;
  error?: boolean;
  stopped?: boolean;
}

interface Props {
  workspaceId: string;
}

interface PendingQuestion {
  workspaceId: string;
  message: string;
  conversationId?: string;
  history: ChatHistoryMessage[];
  regenerate?: boolean;
}

/** Tokens are flushed to state at most this often while streaming. */
const TOKEN_FLUSH_MS = 50;

export function ChatPanel({ workspaceId }: Props) {
  const utils = trpc.useUtils();
  const toast = useToast();
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<PendingQuestion | null>(null);
  const [status, setStatus] = useState('');

  // Streaming accumulation lives in refs (written/read only inside the
  // subscription's event handlers), while liveText/liveSources are the
  // render-safe mirrors (state) for the streaming bubble. Token updates are
  // batched so a fast stream does not re-render markdown per token.
  const streamMessageId = useRef<string | null>(null);
  const streamText = useRef('');
  const streamSources = useRef<Source[]>([]);
  const flushTimer = useRef<number | null>(null);
  const [liveText, setLiveText] = useState('');
  const [liveSources, setLiveSources] = useState<Source[]>([]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);

  const workspace = trpc.workspace.list.useQuery(undefined);
  const workspaceName =
    workspace.data?.find((w) => w.id === workspaceId)?.name ?? 'workspace';

  const conversations = trpc.chat.listByWorkspace.useQuery({ workspaceId });

  const historyMessages = trpc.chat.messages.useQuery(
    { conversationId: activeConversationId ?? '' },
    { enabled: activeConversationId !== null },
  );

  // Hydrate the view from persisted history whenever a conversation is
  // (re)opened. Mid-stream refetches are ignored so they can't clobber
  // the streaming bubble.
  const streamingRef = useRef(false);
  useEffect(() => {
    if (!activeConversationId || !historyMessages.data || streamingRef.current)
      return;
    setMessages(historyMessages.data.map(toLocalMessage));
  }, [activeConversationId, historyMessages.data]);
  useEffect(() => {
    streamingRef.current = pending !== null;
  }, [pending]);

  useEffect(
    () => () => {
      if (flushTimer.current !== null) window.clearTimeout(flushTimer.current);
    },
    [],
  );

  const deleteConversation = trpc.chat.delete.useMutation({
    onSuccess: (_, variables) => {
      if (variables.conversationId === activeConversationId) {
        setActiveConversationId(null);
        setMessages([]);
      }
      void conversations.refetch();
    },
    onError: (err) =>
      toast.push({ kind: 'error', message: `Delete failed: ${err.message}` }),
  });

  // Watch for the persisted conversation id when starting a fresh chat.
  const streamStartedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!pending) return;
    streamStartedFor.current = null;
  }, [pending]);

  function resetStreamState(): void {
    if (flushTimer.current !== null) {
      window.clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    streamMessageId.current = null;
    streamText.current = '';
    streamSources.current = [];
    setLiveText('');
    setLiveSources([]);
  }

  function scheduleLiveTextFlush(): void {
    if (flushTimer.current !== null) return;
    flushTimer.current = window.setTimeout(() => {
      flushTimer.current = null;
      setLiveText(streamText.current);
    }, TOKEN_FLUSH_MS);
  }

  const subInput: PendingQuestion | undefined = pending ?? {
    workspaceId,
    message: '',
    history: [],
  };

  trpc.chat.stream.useSubscription(subInput, {
    enabled: pending !== null,
    onData: (event) => {
      switch (event.type) {
        case 'conversation':
          streamStartedFor.current = event.conversationId;
          setActiveConversationId(event.conversationId);
          void conversations.refetch();
          break;
        case 'sources':
          streamSources.current = event.sources;
          setLiveSources(event.sources);
          setStatus(
            event.sources.length > 0
              ? `Found ${event.sources.length} source${event.sources.length === 1 ? '' : 's'}. Writing answer...`
              : 'No matching sources found. Writing answer...',
          );
          break;
        case 'token': {
          streamText.current += event.token;
          scheduleLiveTextFlush();
          break;
        }
        case 'done': {
          const id = streamMessageId.current;
          const content = streamText.current;
          const sources = streamSources.current;
          resetStreamState();
          setPending(null);
          setStatus('Answer complete');
          if (id) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === id && m.role === 'assistant'
                  ? { ...m, content, sources }
                  : m,
              ),
            );
          }
          const convId = activeConversationId ?? streamStartedFor.current;
          if (convId) {
            void utils.chat.messages.invalidate({ conversationId: convId });
          }
          void utils.document.listByWorkspace.invalidate({ workspaceId });
          void conversations.refetch();
          break;
        }
        case 'error': {
          const id = streamMessageId.current;
          const convId = activeConversationId ?? streamStartedFor.current;
          resetStreamState();
          setPending(null);
          setStatus('Answer failed');
          if (id) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === id && m.role === 'assistant'
                  ? { ...m, content: event.message, error: true }
                  : m,
              ),
            );
          }
          if (convId)
            void utils.chat.messages.invalidate({ conversationId: convId });
          break;
        }
      }
    },
  });

  useEffect(() => {
    if (!pinnedToBottom) return;
    scrollRef.current?.scrollIntoView({
      behavior: pending ? 'auto' : 'smooth',
      block: 'end',
    });
  }, [messages, liveText, pending, pinnedToBottom]);

  function handleScroll(): void {
    const el = scrollContainerRef.current;
    if (!el) return;
    setPinnedToBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
  }

  function handleSend() {
    const message = input.trim();
    if (!message || pending) return;

    const id = crypto.randomUUID();
    streamMessageId.current = id;
    streamText.current = '';
    streamSources.current = [];
    setLiveText('');
    setLiveSources([]);
    setStatus('Searching your documents...');
    setPinnedToBottom(true);
    setPending({
      workspaceId,
      message,
      conversationId: activeConversationId ?? undefined,
      // The server builds history from persisted messages; the field is kept
      // for wire compatibility only.
      history: [],
    });
    setInput('');
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: 'user', content: message },
      { id, role: 'assistant', content: '' },
    ]);
  }

  function stopGeneration() {
    if (!pending) return;
    const id = streamMessageId.current;
    const content = streamText.current;
    const sources = streamSources.current;
    resetStreamState();
    // Disabling the subscription unsubscribes over the WebSocket, which sets
    // the server's `cancelled` flag and stops generation.
    setPending(null);
    setStatus('Generation stopped');
    if (id) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id && m.role === 'assistant'
            ? {
                ...m,
                content: content || '_Generation stopped._',
                sources,
                stopped: true,
              }
            : m,
        ),
      );
    }
  }

  function regenerate() {
    if (pending || !activeConversationId) return;
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;

    const id = crypto.randomUUID();
    streamMessageId.current = id;
    streamText.current = '';
    streamSources.current = [];
    setLiveText('');
    setLiveSources([]);
    setStatus('Searching your documents...');
    setPending({
      workspaceId,
      message: lastUser.content,
      conversationId: activeConversationId,
      history: [],
      regenerate: true,
    });
    setMessages((prev) => {
      // Drop trailing assistant rows; the server replaces its stored answer.
      const next = [...prev];
      while (next.length > 0 && next[next.length - 1]?.role === 'assistant') {
        next.pop();
      }
      return [...next, { id, role: 'assistant', content: '' }];
    });
  }

  function copyMessage(message: Message) {
    void navigator.clipboard.writeText(message.content).then(() => {
      toast.push({ kind: 'success', message: 'Copied to clipboard' });
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function newChat() {
    setActiveConversationId(null);
    setMessages([]);
    setPending(null);
    resetStreamState();
    setStatus('');
  }

  const activeTitle = conversations.data?.find(
    (c) => c.id === activeConversationId,
  )?.title;

  const streaming = pending !== null;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        {/* Conversation history */}
        <aside className="flex w-60 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/40">
          <div className="border-b border-zinc-800 p-3">
            <button
              onClick={newChat}
              disabled={streaming}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-nexus-600 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-nexus-500 disabled:opacity-50"
            >
              <PlusIcon className="h-3.5 w-3.5" /> New chat
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            <p className="mb-1.5 px-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              History
            </p>
            {conversations.data?.length === 0 && (
              <p className="px-2 py-2 text-xs text-zinc-600">
                No past chats yet. Conversations are saved automatically.
              </p>
            )}
            <div className="space-y-1">
              {conversations.data?.map((conversation) => (
                <div key={conversation.id} className="group relative">
                  <button
                    onClick={() => setActiveConversationId(conversation.id)}
                    // Switching mid-stream would show the live answer in the
                    // wrong conversation and invalidate the wrong query.
                    disabled={streaming}
                    className={`flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors disabled:opacity-60 ${
                      activeConversationId === conversation.id
                        ? 'bg-nexus-600/20 text-nexus-200 ring-1 ring-nexus-600/40'
                        : 'text-zinc-300 hover:bg-zinc-800'
                    }`}
                  >
                    <span className="block truncate text-sm font-medium">
                      {conversation.title}
                    </span>
                    <span className="text-[11px] text-zinc-500">
                      {formatRelative(conversation.updatedAt)}
                      {' · '}
                      {conversation.messageCount} message
                      {conversation.messageCount === 1 ? '' : 's'}
                    </span>
                  </button>
                  <button
                    title="Delete conversation"
                    aria-label="Delete conversation"
                    disabled={streaming}
                    onClick={() => {
                      if (confirm(`Delete this conversation?`)) {
                        deleteConversation.mutate({
                          conversationId: conversation.id,
                        });
                      }
                    }}
                    className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded p-1 text-zinc-500 hover:bg-zinc-700 hover:text-red-400 group-hover:block disabled:opacity-40"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Chat */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
            <div>
              <h1 className="text-lg font-bold">
                {activeTitle ?? workspaceName}
              </h1>
              <p className="text-xs text-zinc-500">
                {activeConversationId
                  ? 'Saved conversation · grounded in your documents'
                  : 'Answers are grounded in your uploaded documents'}
              </p>
            </div>
            {messages.length > 0 && (
              <button
                onClick={newChat}
                disabled={streaming}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 disabled:opacity-40"
              >
                Clear chat
              </button>
            )}
          </div>

          {/* Screen-reader status for stream phases (not per token). */}
          <p className="sr-only" aria-live="polite">
            {status}
          </p>

          {/* Messages */}
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            role="log"
            className="flex-1 overflow-y-auto"
          >
            <div className="mx-auto max-w-3xl px-6 py-6">
              {messages.length === 0 && !streaming && (
                <div className="mt-16 text-center text-zinc-500">
                  <p className="text-sm">
                    {activeConversationId
                      ? 'This conversation is empty.'
                      : 'Ask anything about the documents in this workspace.'}
                  </p>
                  {!activeConversationId && (
                    <p className="mt-1 text-xs text-zinc-600">
                      Try: "Summarize the key points" or "What does the report
                      say about X?"
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-4">
                {messages.map((message, index) => (
                  <div
                    key={message.id}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                        message.role === 'user'
                          ? 'bg-nexus-600 text-white'
                          : message.error
                            ? 'border border-red-900/60 bg-red-950/30 text-red-300'
                            : 'border border-zinc-800 bg-zinc-900'
                      }`}
                    >
                      {message.role === 'assistant' ? (
                        <>
                          <div className="markdown-body">
                            {message.content ? (
                              <Suspense
                                fallback={
                                  <MarkdownFallback content={message.content} />
                                }
                              >
                                <Markdown content={message.content} />
                              </Suspense>
                            ) : (
                              <span className="text-zinc-500">Thinking...</span>
                            )}
                          </div>
                          {message.stopped && (
                            <p className="mt-1.5 text-[10px] uppercase tracking-wide text-zinc-500">
                              Stopped
                            </p>
                          )}
                          {message.sources && message.sources.length > 0 && (
                            <SourcesPanel sources={message.sources} />
                          )}
                          {message.usage && (
                            <p className="mt-1.5 text-[10px] text-zinc-600">
                              {message.usage.totalTokens} tokens (
                              {message.usage.promptTokens} in ·{' '}
                              {message.usage.completionTokens} out)
                            </p>
                          )}
                          {!streaming && (
                            <div className="mt-2 flex items-center gap-3 border-t border-zinc-800 pt-1.5 text-[11px] text-zinc-500">
                              <button
                                onClick={() => copyMessage(message)}
                                className="hover:text-zinc-300"
                              >
                                Copy
                              </button>
                              {message.error && (
                                <button
                                  onClick={regenerate}
                                  className="hover:text-zinc-300"
                                >
                                  Retry
                                </button>
                              )}
                              {!message.error &&
                                activeConversationId !== null &&
                                index === messages.length - 1 && (
                                  <button
                                    onClick={regenerate}
                                    className="hover:text-zinc-300"
                                  >
                                    Regenerate
                                  </button>
                                )}
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      )}
                    </div>
                  </div>
                ))}

                {/* Live streaming bubble */}
                {streaming && (
                  <div className="flex justify-start">
                    <div className="max-w-[85%] rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-relaxed">
                      {liveSources.length > 0 && (
                        <p className="mb-2 text-xs text-emerald-400">
                          Found {liveSources.length} relevant source
                          {liveSources.length === 1 ? '' : 's'}
                        </p>
                      )}
                      <div className="markdown-body">
                        {liveText ? (
                          <>
                            <Suspense
                              fallback={<MarkdownFallback content={liveText} />}
                            >
                              <Markdown content={liveText} />
                            </Suspense>
                            <span className="streaming-caret" />
                          </>
                        ) : (
                          <span className="animate-pulse text-zinc-500">
                            Searching your documents...
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div ref={scrollRef} />
            </div>

            {!pinnedToBottom && (
              <button
                onClick={() => {
                  setPinnedToBottom(true);
                  scrollRef.current?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'end',
                  });
                }}
                className="sticky bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-zinc-700 bg-zinc-900/95 px-3 py-1.5 text-xs text-zinc-300 shadow-lg hover:bg-zinc-800"
              >
                ↓ Jump to latest
              </button>
            )}
          </div>

          {/* Composer */}
          <div className="border-t border-zinc-800 p-4">
            <div className="mx-auto max-w-3xl">
              <div className="flex items-end gap-2 rounded-xl border border-zinc-700 bg-zinc-900 p-2 focus-within:border-nexus-500">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={2}
                  aria-label="Message"
                  placeholder={`Ask about the documents in "${workspaceName}"...`}
                  className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-zinc-600"
                />
                {streaming ? (
                  <button
                    onClick={stopGeneration}
                    aria-label="Stop generating"
                    title="Stop generating"
                    className="rounded-lg border border-zinc-600 p-2 text-zinc-300 transition-colors hover:bg-zinc-800"
                  >
                    <StopIcon className="h-4 w-4" />
                  </button>
                ) : (
                  <button
                    onClick={handleSend}
                    disabled={!input.trim()}
                    aria-label="Send message"
                    title="Send"
                    className="rounded-lg bg-nexus-600 p-2 text-white transition-colors hover:bg-nexus-500 disabled:opacity-40"
                  >
                    <SendIcon className="h-4 w-4" />
                  </button>
                )}
              </div>
              <p className="mt-1.5 text-center text-[10px] text-zinc-600">
                Enter to send · Shift+Enter for a new line
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function toLocalMessage(message: MessageDTO): Message {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    sources: message.sources ?? undefined,
    usage: message.usage,
    error: message.kind === 'error',
  };
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function SourcesPanel({ sources }: { sources: Source[] }) {
  return (
    <div className="mt-3 border-t border-zinc-800 pt-2">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Sources
      </p>
      <div className="space-y-1">
        {sources.map((source, i) => (
          <details
            key={source.id}
            className="group rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5"
          >
            <summary className="cursor-pointer list-none text-xs text-zinc-300">
              <span className="font-mono text-nexus-400">{i + 1}</span>
              <span className="mx-1.5 text-zinc-600">·</span>
              {source.title}
              {source.page != null && (
                <span className="ml-1.5 text-zinc-600">p.{source.page}</span>
              )}
              <span className="float-right text-zinc-600">
                {Math.round(source.similarity * 100)}%
              </span>
            </summary>
            <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-zinc-500 group-open:line-clamp-none line-clamp-4">
              {source.content}
            </p>
          </details>
        ))}
      </div>
    </div>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
    >
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
    >
      <path
        d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SendIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
    >
      <path
        d="m22 2-7 20-4-9-9-4z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M22 2 11 13" strokeLinecap="round" />
    </svg>
  );
}

function StopIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}
