import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type {
  ChatHistoryMessage,
  MessageDTO,
  Source,
} from '@nexus/shared-types';

import { trpc } from '../../lib/trpc';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  error?: boolean;
}

interface Props {
  workspaceId: string;
}

interface PendingQuestion {
  workspaceId: string;
  message: string;
  conversationId?: string;
  history: ChatHistoryMessage[];
}

export function ChatPanel({ workspaceId }: Props) {
  const utils = trpc.useContext();
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<PendingQuestion | null>(null);

  // Streaming accumulation lives in refs (written/read only inside the
  // subscription's event handlers), while liveText/liveSources are the
  // render-safe mirrors (state) for the streaming bubble.
  const streamMessageId = useRef<string | null>(null);
  const streamText = useRef('');
  const streamSources = useRef<Source[]>([]);
  const [liveText, setLiveText] = useState('');
  const [liveSources, setLiveSources] = useState<Source[]>([]);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const workspace = trpc.workspace.list.useQuery();
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

  const deleteConversation = trpc.chat.delete.useMutation({
    onSuccess: (_, variables) => {
      if (variables.conversationId === activeConversationId) {
        setActiveConversationId(null);
        setMessages([]);
      }
      void conversations.refetch();
    },
  });

  // Watch for the persisted conversation id when starting a fresh chat.
  const streamStartedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!pending) return;
    streamStartedFor.current = null;
  }, [pending]);

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
          break;
        case 'token': {
          streamText.current += event.token;
          setLiveText(streamText.current);
          break;
        }
        case 'done': {
          const id = streamMessageId.current;
          const content = streamText.current;
          const sources = streamSources.current;
          streamMessageId.current = null;
          streamText.current = '';
          streamSources.current = [];
          setLiveText('');
          setLiveSources([]);
          setPending(null);
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
          streamMessageId.current = null;
          streamText.current = '';
          streamSources.current = [];
          setLiveText('');
          setLiveSources([]);
          setPending(null);
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
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, liveText]);

  function handleSend() {
    const message = input.trim();
    if (!message || pending) return;

    const history = messages
      .slice(-10)
      .map(({ role, content }) => ({ role, content }));
    const id = crypto.randomUUID();

    streamMessageId.current = id;
    streamText.current = '';
    streamSources.current = [];
    setLiveText('');
    setLiveSources([]);
    setPending({
      workspaceId,
      message,
      conversationId: activeConversationId ?? undefined,
      history,
    });
    setInput('');
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: 'user', content: message },
      { id, role: 'assistant', content: '' },
    ]);
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
    streamMessageId.current = null;
    streamText.current = '';
    streamSources.current = [];
    setLiveText('');
    setLiveSources([]);
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
                    className={`flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors ${
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
                    onClick={() => {
                      if (confirm(`Delete this conversation?`)) {
                        deleteConversation.mutate({
                          conversationId: conversation.id,
                        });
                      }
                    }}
                    className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded p-1 text-zinc-500 hover:bg-zinc-700 hover:text-red-400 group-hover:block"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Chat */}
        <div className="flex min-w-0 flex-1 flex-col">
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
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800"
              >
                Clear chat
              </button>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto">
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
                {messages.map((message) => (
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
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {message.content}
                              </ReactMarkdown>
                            ) : (
                              <span className="text-zinc-500">Thinking...</span>
                            )}
                          </div>
                          {message.sources && message.sources.length > 0 && (
                            <SourcesPanel sources={message.sources} />
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
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {liveText}
                            </ReactMarkdown>
                            <span className="streaming-caret" />
                          </>
                        ) : (
                          <span className="text-zinc-500 animate-pulse">
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
                  placeholder={`Ask about the documents in "${workspaceName}"...`}
                  className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-zinc-600"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || streaming}
                  className="rounded-lg bg-nexus-600 p-2 text-white transition-colors hover:bg-nexus-500 disabled:opacity-40"
                  title={streaming ? 'Answer in progress' : 'Send'}
                >
                  {streaming ? (
                    <SpinnerIcon className="h-4 w-4" />
                  ) : (
                    <SendIcon className="h-4 w-4" />
                  )}
                </button>
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
            className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5"
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
            <p className="mt-1.5 line-clamp-4 whitespace-pre-wrap text-xs leading-relaxed text-zinc-500">
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

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={`animate-spin ${className ?? ''}`}
    >
      <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
    </svg>
  );
}
