import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import {
  isImageFileType,
  VISION_MODES,
  type ChatHistoryMessage,
  type MessageDTO,
  type RetrievalDebug,
  type Source,
  type Usage,
  type VisionMode,
} from '@nexus/shared-types';

import { useToast } from '../../components/Toast';
import { documentImageUrl } from '../../lib/document-format';
import { trpc } from '../../lib/trpc';
import { ReadAloudPlayer } from '../voice/ReadAloudPlayer';
import { MicButton } from '../voice/MicButton';

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
  /** Image documents attached to a user turn (vision chat). */
  attachments?: { imageDocumentIds: string[] } | null;
  usage?: Usage | null;
  feedback?: 'up' | 'down' | null;
  retrieval?: RetrievalDebug | null;
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
  persona?: string;
  imageDocumentIds?: string[];
  visionMode?: VisionMode;
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
  const streamRetrieval = useRef<RetrievalDebug | null>(null);
  const [liveText, setLiveText] = useState('');
  const [liveSources, setLiveSources] = useState<Source[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [inspector, setInspector] = useState<RetrievalDebug | null>(null);
  // Text selection inside the message log, for the Ask/Highlight/Cards bar.
  const [selection, setSelection] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  // Voice capabilities/defaults (dictation engine, TTS provider, speech).
  const voiceConfig = trpc.voice.config.useQuery(undefined);
  // Selection text being read aloud from the floating toolbar.
  const [speakSelection, setSpeakSelection] = useState<string | null>(null);

  // Tutor persona for new answers: seeded from the stored default, then a
  // per-chat choice the user can change at any time.
  const personas = trpc.chat.personas.useQuery(undefined);
  const [persona, setPersona] = useState<string | null>(null);
  if (persona === null && personas.data && personas.data.length > 0) {
    setPersona(
      personas.data.find((item) => item.isDefault)?.id ??
        personas.data[0]?.id ??
        null,
    );
  }

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);

  // Vision: images attached to the next turn, plus the analysis mode used
  // when images are present. The picker only lists ready images from this
  // workspace (the server re-checks ownership and readiness per turn).
  const visionConfig = trpc.vision.config.useQuery(undefined);
  const [attachedImages, setAttachedImages] = useState<
    { id: string; title: string }[]
  >([]);
  const [visionMode, setVisionMode] = useState<VisionMode>('general');
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const imagesQuery = trpc.document.images.useQuery(
    { workspaceId },
    { enabled: imagePickerOpen },
  );
  const visionReady = Boolean(
    visionConfig.data?.enabled && visionConfig.data?.available,
  );

  function toggleAttachment(image: { id: string; title: string }): void {
    setAttachedImages((current) => {
      if (current.some((item) => item.id === image.id)) {
        return current.filter((item) => item.id !== image.id);
      }
      // Four images is the server-side cap; keep the UI in step with it.
      if (current.length >= 4) return current;
      return [...current, image];
    });
  }

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

  const feedbackMutation = trpc.chat.feedback.useMutation({
    onError: (err) =>
      toast.push({ kind: 'error', message: `Feedback failed: ${err.message}` }),
  });

  const createHighlight = trpc.notes.highlights.create.useMutation({
    onSuccess: () =>
      toast.push({ kind: 'success', message: 'Highlight saved' }),
    onError: (err) =>
      toast.push({
        kind: 'error',
        message: `Highlight failed: ${err.message}`,
      }),
  });
  const generateCards = trpc.study.cards.generate.useMutation({
    onSuccess: (data) => {
      toast.push({
        kind: 'success',
        message: `Created ${data.created.length} flashcard${data.created.length === 1 ? '' : 's'} — open Study to review.`,
      });
      void utils.study.progress.invalidate({ workspaceId });
      void utils.study.decks.list.invalidate({ workspaceId });
    },
    onError: (err) =>
      toast.push({ kind: 'error', message: `Cards failed: ${err.message}` }),
  });

  /**
   * Show the Ask/Highlight/Cards toolbar for any selection inside the
   * message log. Listens to selectionchange so keyboard selection works too
   * (mouseup alone missed programmatic and shift+arrow selections).
   */
  useEffect(() => {
    function onSelectionChange(): void {
      const sel = window.getSelection();
      const container = scrollContainerRef.current;
      const text = sel?.toString().trim() ?? '';
      if (!sel || !container || sel.rangeCount === 0 || text.length < 3) {
        setSelection(null);
        return;
      }
      const range = sel.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) {
        setSelection(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setSelection(null);
        return;
      }
      setSelection({
        text: text.slice(0, 4000),
        x: rect.left + rect.width / 2,
        y: rect.top,
      });
    }
    document.addEventListener('selectionchange', onSelectionChange);
    return () =>
      document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  function clearSelection(): void {
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  }

  /** Toggle thumbs up/down on an assistant answer. */
  function setFeedback(message: Message, value: 'up' | 'down'): void {
    const next = message.feedback === value ? null : value;
    setMessages((prev) =>
      prev.map((m) => (m.id === message.id ? { ...m, feedback: next } : m)),
    );
    feedbackMutation.mutate({ messageId: message.id, feedback: next });
  }

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
    streamRetrieval.current = null;
    setLiveText('');
    setLiveSources([]);
    setSearchQuery('');
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
    persona: persona ?? undefined,
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
          streamRetrieval.current = event.retrieval ?? null;
          setLiveSources(event.sources);
          setSearchQuery(event.query);
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
          const retrieval = streamRetrieval.current;
          resetStreamState();
          setPending(null);
          setStatus('Answer complete');
          if (id) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === id && m.role === 'assistant'
                  ? {
                      ...m,
                      id: event.messageId,
                      content,
                      sources,
                      retrieval,
                    }
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

  function handleSend(override?: string) {
    const message = (override ?? input).trim();
    if (!message || pending) return;
    // Attaching images needs a vision-capable provider; the server rejects
    // the turn anyway, so block it before streaming starts.
    if (attachedImages.length > 0 && !visionReady) {
      toast.push({
        kind: 'error',
        message:
          'Vision is not configured. Enable vision and set a vision-capable model in Settings.',
      });
      return;
    }

    const id = crypto.randomUUID();
    const imageDocumentIds = attachedImages.map((image) => image.id);
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
      persona: persona ?? undefined,
      imageDocumentIds:
        imageDocumentIds.length > 0 ? imageDocumentIds : undefined,
      visionMode: imageDocumentIds.length > 0 ? visionMode : undefined,
    });
    setInput('');
    setAttachedImages([]);
    setImagePickerOpen(false);
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: 'user',
        content: message,
        attachments:
          imageDocumentIds.length > 0 ? { imageDocumentIds } : undefined,
      },
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
      persona: persona ?? undefined,
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

  const mineVocabulary = trpc.language.vocabulary.mine.useMutation({
    onSuccess: (data) => {
      toast.push({
        kind: 'success',
        message: `Mined ${data.items.length} term${data.items.length === 1 ? '' : 's'} into your vocabulary.`,
      });
    },
    onError: (err) =>
      toast.push({ kind: 'error', message: `Mining failed: ${err.message}` }),
  });

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function askAboutSelection(): void {
    if (!selection) return;
    setInput((current) =>
      `${current}About this passage: “${selection.text}”\n\n`.trimStart(),
    );
    clearSelection();
    composerRef.current?.focus();
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
        {/* Conversation history (desktop); on smaller screens the header
            exposes a conversation picker instead. */}
        <aside className="hidden w-60 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/40 lg:flex">
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
          <div className="flex items-start justify-between gap-3 border-b border-zinc-800 px-4 py-3 md:px-6 md:py-4">
            <div className="min-w-0 flex-1">
              <h1
                className="truncate text-base font-bold md:text-lg"
                title={activeTitle ?? workspaceName}
              >
                {activeTitle ?? workspaceName}
              </h1>
              <p className="text-xs text-zinc-500">
                {activeConversationId
                  ? 'Saved conversation · grounded in your documents'
                  : 'Answers are grounded in your uploaded documents'}
              </p>
              {conversations.data && conversations.data.length > 0 && (
                <select
                  value={activeConversationId ?? ''}
                  disabled={streaming}
                  onChange={(event) => {
                    setActiveConversationId(event.target.value || null);
                  }}
                  aria-label="Conversation"
                  className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-300 outline-none focus:border-nexus-500 disabled:opacity-50 lg:hidden"
                >
                  <option value="">New chat</option>
                  {conversations.data.map((conversation) => (
                    <option key={conversation.id} value={conversation.id}>
                      {conversation.title}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {messages.length > 0 && (
              <button
                onClick={newChat}
                disabled={streaming}
                className="shrink-0 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 disabled:opacity-40"
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
            <div className="mx-auto max-w-3xl px-3 py-4 md:px-6 md:py-6">
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
                {messages.map((message, index) => {
                  // While streaming, the live bubble below represents the
                  // pending assistant turn; skip its empty placeholder so it
                  // does not render as a second "Thinking..." bubble.
                  if (
                    streaming &&
                    message.role === 'assistant' &&
                    message.content === ''
                  ) {
                    return null;
                  }
                  return (
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
                                    <MarkdownFallback
                                      content={message.content}
                                    />
                                  }
                                >
                                  <Markdown content={message.content} />
                                </Suspense>
                              ) : (
                                <span className="text-zinc-500">
                                  Thinking...
                                </span>
                              )}
                            </div>
                            {message.stopped && (
                              <p className="mt-1.5 text-[10px] uppercase tracking-wide text-zinc-500">
                                Stopped
                              </p>
                            )}
                            {message.sources && message.sources.length > 0 && (
                              <SourcesPanel
                                sources={message.sources}
                                onInspect={
                                  message.retrieval
                                    ? () =>
                                        setInspector(message.retrieval ?? null)
                                    : undefined
                                }
                              />
                            )}
                            {message.usage && (
                              <p className="mt-1.5 text-[10px] text-zinc-600">
                                {message.usage.totalTokens} tokens (
                                {message.usage.promptTokens} in ·{' '}
                                {message.usage.completionTokens} out)
                              </p>
                            )}
                            {!streaming && (
                              <div className="mt-2 border-t border-zinc-800 pt-1.5 text-[11px] text-zinc-500">
                                <div className="flex items-center gap-3">
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
                                  {message.retrieval && (
                                    <button
                                      onClick={() =>
                                        setInspector(message.retrieval ?? null)
                                      }
                                      className="hover:text-zinc-300"
                                    >
                                      Why?
                                    </button>
                                  )}
                                  {!message.error &&
                                    activeConversationId !== null && (
                                      <span className="ml-auto flex items-center gap-2">
                                        <button
                                          onClick={() =>
                                            setFeedback(message, 'up')
                                          }
                                          aria-label="Helpful answer"
                                          title="Helpful"
                                          className={
                                            message.feedback === 'up'
                                              ? 'text-emerald-400'
                                              : 'hover:text-zinc-300'
                                          }
                                        >
                                          👍
                                        </button>
                                        <button
                                          onClick={() =>
                                            setFeedback(message, 'down')
                                          }
                                          aria-label="Not helpful"
                                          title="Not helpful"
                                          className={
                                            message.feedback === 'down'
                                              ? 'text-red-400'
                                              : 'hover:text-zinc-300'
                                          }
                                        >
                                          👎
                                        </button>
                                      </span>
                                    )}
                                </div>
                                {message.content && !message.error && (
                                  <ReadAloudPlayer
                                    text={message.content}
                                    workspaceId={workspaceId}
                                    config={voiceConfig.data}
                                  />
                                )}
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            {message.attachments?.imageDocumentIds.length ? (
                              <div className="mb-2 flex flex-wrap gap-1.5">
                                {message.attachments.imageDocumentIds.map(
                                  (imageId) => (
                                    <a
                                      key={imageId}
                                      href={documentImageUrl(imageId)}
                                      target="_blank"
                                      rel="noreferrer noopener"
                                      className="block"
                                    >
                                      <img
                                        src={documentImageUrl(imageId)}
                                        alt="Attached image"
                                        className="max-h-40 rounded-lg border border-white/20 object-contain"
                                      />
                                    </a>
                                  ),
                                )}
                              </div>
                            ) : null}
                            <p className="whitespace-pre-wrap">
                              {message.content}
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Live streaming bubble */}
                {streaming && (
                  <div className="flex justify-start">
                    <div className="max-w-[85%] rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-relaxed">
                      {liveSources.length > 0 && (
                        <p className="mb-1 text-xs text-emerald-400">
                          Found {liveSources.length} relevant source
                          {liveSources.length === 1 ? '' : 's'}
                        </p>
                      )}
                      {searchQuery && searchQuery !== pending?.message && (
                        <p className="mb-2 text-[10px] text-zinc-500">
                          Searched for: “{searchQuery}”
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
          <div className="border-t border-zinc-800 p-3 md:p-4">
            <div className="mx-auto max-w-3xl">
              {personas.data && personas.data.length > 0 && (
                <div className="mb-2 flex items-center gap-2">
                  <label
                    htmlFor="persona-select"
                    className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500"
                  >
                    Mode
                  </label>
                  <select
                    id="persona-select"
                    value={persona ?? 'default'}
                    disabled={streaming}
                    onChange={(event) => setPersona(event.target.value)}
                    className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 outline-none focus:border-nexus-500 disabled:opacity-50"
                  >
                    {personas.data.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                  <span className="truncate text-[10px] text-zinc-600">
                    {personas.data.find((item) => item.id === persona)
                      ?.description ?? ''}
                  </span>
                </div>
              )}

              {/* Vision attachments: chips for the images on this turn plus
                  the analysis mode the answer should use. */}
              {attachedImages.length > 0 && (
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  {attachedImages.map((image) => (
                    <span
                      key={image.id}
                      className="relative flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 py-0.5 pl-0.5 pr-1.5"
                    >
                      <img
                        src={documentImageUrl(image.id)}
                        alt=""
                        className="h-8 w-8 rounded object-cover"
                      />
                      <span
                        className="max-w-28 truncate text-[11px] text-zinc-300"
                        title={image.title}
                      >
                        {image.title}
                      </span>
                      <button
                        onClick={() =>
                          setAttachedImages((current) =>
                            current.filter((item) => item.id !== image.id),
                          )
                        }
                        aria-label={`Remove ${image.title}`}
                        className="rounded px-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <label
                    htmlFor="vision-mode"
                    className="ml-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500"
                  >
                    Vision
                  </label>
                  <select
                    id="vision-mode"
                    value={visionMode}
                    disabled={streaming}
                    onChange={(event) =>
                      setVisionMode(event.target.value as VisionMode)
                    }
                    className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-300 outline-none focus:border-nexus-500 disabled:opacity-50"
                  >
                    {VISION_MODES.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                  <span className="truncate text-[10px] text-zinc-600">
                    {VISION_MODES.find((item) => item.id === visionMode)?.hint}
                  </span>
                </div>
              )}

              {imagePickerOpen && (
                <div className="mb-2 rounded-xl border border-zinc-700 bg-zinc-900 p-2">
                  <div className="mb-1.5 flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      Attach an image from this workspace
                    </p>
                    <button
                      onClick={() => setImagePickerOpen(false)}
                      className="text-[10px] text-zinc-500 hover:text-zinc-300"
                    >
                      Close
                    </button>
                  </div>
                  {imagesQuery.isLoading && (
                    <p className="px-1 py-2 text-[11px] text-zinc-600">
                      Loading images...
                    </p>
                  )}
                  {!imagesQuery.isLoading &&
                    (imagesQuery.data?.length ?? 0) === 0 && (
                      <p className="px-1 py-2 text-[11px] text-zinc-600">
                        No images yet. Upload a photo, a diagram or a painting
                        above and it will appear here once it is indexed.
                      </p>
                    )}
                  <div className="flex flex-wrap gap-1.5">
                    {imagesQuery.data?.slice(0, 12).map((image) => {
                      const selected = attachedImages.some(
                        (item) => item.id === image.id,
                      );
                      return (
                        <button
                          key={image.id}
                          onClick={() =>
                            toggleAttachment({
                              id: image.id,
                              title: image.title,
                            })
                          }
                          aria-pressed={selected}
                          title={image.title}
                          className={`overflow-hidden rounded-lg border text-left transition-colors ${
                            selected
                              ? 'border-nexus-500 ring-1 ring-nexus-500/60'
                              : 'border-zinc-700 hover:border-zinc-500'
                          }`}
                        >
                          <img
                            src={documentImageUrl(image.id)}
                            alt={image.title}
                            className="h-16 w-24 object-cover"
                          />
                          <span className="block max-w-24 truncate px-1 py-0.5 text-[10px] text-zinc-400">
                            {image.title}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="flex items-end gap-2 rounded-xl border border-zinc-700 bg-zinc-900 p-2 focus-within:border-nexus-500">
                <textarea
                  ref={composerRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={2}
                  aria-label="Message"
                  placeholder={`Ask about the documents in "${workspaceName}"...`}
                  className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-zinc-600"
                />
                {visionReady && (
                  <button
                    onClick={() => setImagePickerOpen((open) => !open)}
                    disabled={streaming}
                    aria-label="Attach an image"
                    aria-expanded={imagePickerOpen}
                    title="Attach an image from this workspace"
                    className={`rounded-lg border p-2 transition-colors disabled:opacity-40 ${
                      attachedImages.length > 0
                        ? 'border-nexus-500 bg-nexus-600/20 text-nexus-200'
                        : 'border-zinc-600 text-zinc-300 hover:bg-zinc-800'
                    }`}
                  >
                    <ImageIcon className="h-4 w-4" />
                  </button>
                )}
                <MicButton
                  workspaceId={workspaceId}
                  config={voiceConfig.data}
                  disabled={streaming}
                  onTranscript={(text) => {
                    setInput(text);
                    composerRef.current?.focus();
                    if (voiceConfig.data?.autoSend) handleSend(text);
                  }}
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
                    onClick={() => handleSend()}
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

      {selection && (
        <div
          className="fixed z-30 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-xl"
          style={{ left: selection.x, top: Math.max(8, selection.y - 10) }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <button
            onClick={() => {
              setSpeakSelection(selection.text);
              clearSelection();
            }}
            className="rounded px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            Speak
          </button>
          <button
            onClick={() => {
              mineVocabulary.mutate({
                workspaceId,
                text: selection.text,
                maxTerms: 5,
                createCards: true,
              });
              clearSelection();
            }}
            disabled={mineVocabulary.isPending}
            className="rounded px-2 py-1 text-xs text-emerald-300 hover:bg-zinc-800 disabled:opacity-40"
            title="Mine vocabulary from this selection"
          >
            Mine
          </button>
          <button
            onClick={askAboutSelection}
            className="rounded px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            Ask
          </button>
          <button
            onClick={() => {
              createHighlight.mutate({
                workspaceId,
                quotedText: selection.text,
              });
              clearSelection();
            }}
            disabled={createHighlight.isPending}
            className="rounded px-2 py-1 text-xs text-amber-300 hover:bg-zinc-800 disabled:opacity-40"
          >
            Highlight
          </button>
          <button
            onClick={() => {
              generateCards.mutate({
                workspaceId,
                text: selection.text,
                count: 5,
              });
              clearSelection();
            }}
            disabled={generateCards.isPending || selection.text.length < 20}
            className="rounded px-2 py-1 text-xs text-nexus-200 hover:bg-zinc-800 disabled:opacity-40"
            title={
              selection.text.length < 20
                ? 'Select a longer passage to make cards'
                : 'Generate flashcards from this passage'
            }
          >
            Cards
          </button>
        </div>
      )}

      {speakSelection && (
        <div className="fixed bottom-24 right-6 z-30">
          <ReadAloudPlayer
            key={speakSelection}
            text={speakSelection}
            workspaceId={workspaceId}
            config={voiceConfig.data}
            defaultOpen
            onClose={() => setSpeakSelection(null)}
          />
        </div>
      )}

      {inspector && (
        <RetrievalInspector
          debug={inspector}
          onClose={() => setInspector(null)}
        />
      )}
    </div>
  );
}

function toLocalMessage(message: MessageDTO): Message {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    sources: message.sources ?? undefined,
    attachments: message.attachments ?? undefined,
    usage: message.usage,
    feedback: message.feedback ?? null,
    retrieval: message.retrievalDebug ?? null,
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

function pct(value: number | undefined): string {
  return value == null ? '—' : `${Math.round(value * 100)}%`;
}

function SourcesPanel({
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

/** Modal explaining how the sources for an answer were selected. */
function RetrievalInspector({
  debug,
  onClose,
}: {
  debug: RetrievalDebug;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Retrieval inspector"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold">Retrieval inspector</h2>
            <p className="text-xs text-zinc-500">
              How this answer's sources were selected.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close inspector"
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          >
            ✕
          </button>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
          <Stat label="Profile" value={debug.profile} />
          <Stat
            label="Rewritten query"
            value={debug.rewritten ? 'yes' : 'no'}
          />
          <Stat label="Reranked" value={debug.reranked ? 'yes' : 'no'} />
          <Stat
            label="Vector candidates"
            value={String(debug.vectorCandidates)}
          />
          <Stat
            label="Keyword candidates"
            value={String(debug.keywordCandidates)}
          />
          <Stat
            label="Context budget"
            value={`${debug.usedTokens} / ${debug.tokenBudget} tokens`}
          />
          <Stat label="Min vector score" value={String(debug.minScore)} />
        </dl>

        {debug.rewritten && (
          <p className="mt-3 rounded-lg bg-zinc-950/60 px-3 py-2 text-xs text-zinc-400">
            <span className="text-zinc-500">Original:</span>{' '}
            {debug.originalQuery}
            <br />
            <span className="text-zinc-500">Searched for:</span>{' '}
            {debug.searchQuery}
          </p>
        )}

        <div className="mt-4">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Candidates ({debug.candidates.length})
          </p>
          <div className="space-y-1">
            {debug.candidates.map((candidate) => (
              <div
                key={candidate.id}
                className={`rounded-lg border px-3 py-2 text-xs ${
                  candidate.selected
                    ? 'border-nexus-700/60 bg-nexus-950/20'
                    : 'border-zinc-800 bg-zinc-950/40'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-zinc-500">
                    #{candidate.rank}
                    {candidate.rerankedRank != null &&
                    candidate.rerankedRank !== candidate.rank
                      ? ` → ${candidate.rerankedRank}`
                      : ''}
                  </span>
                  {candidate.selected && (
                    <span className="rounded bg-nexus-600/30 px-1.5 text-[10px] text-nexus-200">
                      selected
                    </span>
                  )}
                  <span className="truncate text-zinc-300">
                    {candidate.title}
                  </span>
                  {candidate.page != null && (
                    <span className="text-zinc-600">p.{candidate.page}</span>
                  )}
                  <span className="ml-auto shrink-0 text-zinc-500">
                    v {pct(candidate.vectorScore)} · k{' '}
                    {pct(candidate.keywordScore)} · f{' '}
                    {pct(candidate.fusedScore)}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-zinc-500">
                  {candidate.contentPreview}
                </p>
              </div>
            ))}
            {debug.candidates.length === 0 && (
              <p className="text-xs text-zinc-600">
                No candidates were retrieved for this question.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-zinc-300">{value}</dd>
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

function ImageIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m4 17 5-5 4 4 3-3 4 4" />
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
