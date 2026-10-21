import { useEffect, useRef, useState } from 'react';

import type { VoiceConfig } from '@nexus/shared-types';

import { useToast } from '../../components/Toast';
import { audioUrl, requestSpeech } from '../../lib/audio';
import { speakSentences, speechSynthesisSupported } from '../../lib/speech';
import { trpc } from '../../lib/trpc';
import { MicButton } from './MicButton';

interface Props {
  workspaceId: string;
  config: VoiceConfig | undefined;
  onOpenChat?: () => void;
}

interface Turn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  error?: boolean;
}

interface PendingTurn {
  message: string;
  conversationId?: string;
}

/**
 * Push-to-talk conversation with the tutor: speak, Nexus answers with the
 * (grounded) chat pipeline and reads the answer back. Transcripts are ordinary
 * persisted messages, so the conversation can be resumed as text in the Chat
 * tab. A latency HUD shows time-to-first-token and time-to-audio.
 */
export function VoiceChatPanel({ workspaceId, config, onOpenChat }: Props) {
  const toast = useToast();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [latency, setLatency] = useState<{
    ttftMs: number | null;
    audioMs: number | null;
  }>({ ttftMs: null, audioMs: null });

  const requestStart = useRef(0);
  const answer = useRef('');
  const firstTokenAt = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const conversationList = trpc.chat.listByWorkspace.useQuery(
    { workspaceId },
    { enabled: turns.length > 0 },
  );

  function stopAudio() {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    window.speechSynthesis?.cancel();
  }

  useEffect(() => () => stopAudio(), []);

  async function speak(text: string, spokenAt: number) {
    if (!text.trim()) return;
    if (config?.ttsProvider === 'server' && config.ttsServerAvailable) {
      try {
        const result = await requestSpeech({
          text,
          voice: config?.ttsVoice,
          speed: config?.ttsSpeed,
          workspaceId,
        });
        const audio = audioRef.current;
        if (!audio) return;
        audio.src = audioUrl(result.audioId);
        audio.onplaying = () => {
          setLatency((current) => ({
            ...current,
            audioMs: Math.round(performance.now() - spokenAt),
          }));
        };
        await audio.play();
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Speech failed';
        toast.push({ kind: 'error', message });
      }
    }
    if (speechSynthesisSupported()) {
      const sentences = text
        .split(/(?<=[.!?])\s+/)
        .map((sentence) => sentence.trim())
        .filter(Boolean);
      speakSentences(
        sentences,
        { rate: config?.ttsSpeed ?? 1 },
        {
          onSentence: () => undefined,
          onEnd: () => undefined,
        },
      );
      setLatency((current) => ({
        ...current,
        audioMs: Math.round(performance.now() - spokenAt),
      }));
    }
  }

  trpc.chat.stream.useSubscription(
    pending
      ? {
          workspaceId,
          message: pending.message,
          conversationId: pending.conversationId,
          history: [],
          persona: 'language',
        }
      : { workspaceId, message: '', history: [] },
    {
      enabled: pending !== null,
      onData: (event) => {
        switch (event.type) {
          case 'conversation':
            setConversationId(event.conversationId);
            break;
          case 'token':
            if (firstTokenAt.current === null) {
              firstTokenAt.current = performance.now();
              setLatency((current) => ({
                ...current,
                ttftMs: Math.round(
                  firstTokenAt.current! - requestStart.current,
                ),
              }));
            }
            answer.current += event.token;
            break;
          case 'done': {
            const text = answer.current.trim();
            answer.current = '';
            setPending(null);
            firstTokenAt.current = null;
            setTurns((prev) => [
              ...prev,
              {
                id: event.messageId,
                role: 'assistant',
                content: text || '(empty answer)',
              },
            ]);
            const spokenAt = performance.now();
            void speak(text, spokenAt);
            void conversationList.refetch();
            break;
          }
          case 'error':
            answer.current = '';
            setPending(null);
            firstTokenAt.current = null;
            setTurns((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: event.message,
                error: true,
              },
            ]);
            toast.push({ kind: 'error', message: event.message });
            break;
          case 'sources':
            break;
        }
      },
    },
  );

  function handleTranscript(text: string) {
    stopAudio();
    answer.current = '';
    firstTokenAt.current = null;
    requestStart.current = performance.now();
    setLatency({ ttftMs: null, audioMs: null });
    setTurns((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: 'user', content: text },
    ]);
    setPending({ message: text, conversationId: conversationId ?? undefined });
  }

  const busy = pending !== null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-zinc-800 px-4 py-2">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 text-xs text-zinc-500">
          <span className="font-semibold uppercase tracking-wider text-zinc-400">
            Voice chat
          </span>
          <span>
            TTFT:{' '}
            <span className="text-zinc-300">
              {latency.ttftMs == null ? '—' : `${latency.ttftMs} ms`}
            </span>
          </span>
          <span>
            Time to audio:{' '}
            <span className="text-zinc-300">
              {latency.audioMs == null ? '—' : `${latency.audioMs} ms`}
            </span>
          </span>
          {conversationId && (
            <button
              type="button"
              onClick={onOpenChat}
              className="ml-auto rounded border border-zinc-700 px-2 py-0.5 text-zinc-300 hover:bg-zinc-800"
            >
              Continue in Chat
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-3xl space-y-4">
          {turns.length === 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-center text-sm text-zinc-500">
              <p className="text-base text-zinc-300">Talk to your tutor</p>
              <p className="mt-2">
                Hold the microphone to ask a question; release to send. Nexus
                replies with the language-partner persona and reads the answer
                back.{' '}
                {config?.correctionPolicy === 'recap'
                  ? 'Corrections come as a short recap at the end.'
                  : config?.correctionPolicy === 'immediate'
                    ? 'Corrections are given as you go.'
                    : 'Corrections only when you ask.'}
              </p>
              {config?.targetLanguage && (
                <p className="mt-2 text-xs text-zinc-600">
                  Target language: {config.targetLanguage}
                </p>
              )}
            </div>
          )}

          {turns.map((turn) => (
            <div
              key={turn.id}
              className={`flex ${turn.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  turn.role === 'user'
                    ? 'bg-nexus-600 text-white'
                    : turn.error
                      ? 'border border-red-900/60 bg-red-950/30 text-red-300'
                      : 'border border-zinc-800 bg-zinc-900'
                }`}
              >
                {turn.content}
              </div>
            </div>
          ))}

          {busy && (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-500">
                <span className="animate-pulse">Listening back…</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-zinc-800 p-4">
        <div className="mx-auto flex max-w-3xl items-center justify-center gap-4">
          <MicButton
            workspaceId={workspaceId}
            config={config}
            onTranscript={handleTranscript}
            disabled={busy}
          />
          <p className="text-xs text-zinc-500">
            {busy
              ? 'Answering…'
              : 'Click to toggle, or hold to talk. Released audio is transcribed and answered.'}
          </p>
        </div>
      </div>
      <audio ref={audioRef} className="hidden" />
    </div>
  );
}
