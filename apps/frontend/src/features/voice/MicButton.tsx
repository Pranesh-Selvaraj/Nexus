import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import type { VoiceConfig } from '@nexus/shared-types';

import { useToast } from '../../components/Toast';
import {
  AudioRecorder,
  getUserMediaSupported,
  transcribeBlob,
} from '../../lib/audio';
import {
  speechRecognitionSupported,
  startBrowserDictation,
} from '../../lib/speech';
import type { DictationSession } from '../../lib/speech';

type MicState = 'idle' | 'listening' | 'transcribing' | 'error';

interface Props {
  workspaceId: string;
  config: VoiceConfig | undefined;
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

const PUSH_TO_TALK_MS = 400;
const AUTO_STOP_SILENCE_MS = 3000;

/**
 * Composer microphone. Click to toggle dictation, or press and hold for
 * push-to-talk. Uses the browser Speech API when selected and available, and
 * falls back to recording + server transcription otherwise.
 */
export function MicButton({
  workspaceId,
  config,
  onTranscript,
  disabled,
}: Props) {
  const toast = useToast();
  const [state, setState] = useState<MicState>('idle');
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const browserSession = useRef<DictationSession | null>(null);
  const recorder = useRef<AudioRecorder | null>(null);
  const finalText = useRef('');
  const interimText = useRef('');
  const pressedAt = useRef(0);
  // True when the current press began while already listening, so a quick
  // release stops (click-to-stop) instead of keeping the session open.
  const pressedWhileListening = useRef(false);
  const autoStopTimer = useRef<number | null>(null);
  // Holds the latest `finish` so the auto-stop timeout never calls a stale
  // closure (and can be defined before `finish`).
  const finishRef = useRef<() => void>(() => undefined);

  const mode: 'browser' | 'server' =
    config?.sttMode === 'server' || !speechRecognitionSupported()
      ? 'server'
      : 'browser';

  const clearAutoStop = useCallback(() => {
    if (autoStopTimer.current !== null) {
      window.clearTimeout(autoStopTimer.current);
      autoStopTimer.current = null;
    }
  }, []);

  const armAutoStop = useCallback(() => {
    if (!config?.autoSend) return;
    clearAutoStop();
    autoStopTimer.current = window.setTimeout(() => {
      finishRef.current?.();
    }, AUTO_STOP_SILENCE_MS);
  }, [config?.autoSend, clearAutoStop]);

  const publish = useCallback(
    (text: string) => {
      const value = text.trim();
      if (value) onTranscript(value);
    },
    [onTranscript],
  );

  // Browser recognition delivers final results just before `end`. Publish
  // exactly once from there (with a timeout fallback in `finish`) so a final
  // chunk that lands after the user pressed stop is not discarded.
  const publishedRef = useRef(false);
  const publishCollected = useCallback(() => {
    if (publishedRef.current) return;
    publishedRef.current = true;
    const combined = `${finalText.current} ${interimText.current}`.trim();
    finalText.current = '';
    interimText.current = '';
    publish(combined);
  }, [publish]);

  const finish = useCallback(() => {
    clearAutoStop();
    if (mode === 'browser') {
      browserSession.current?.stop();
      browserSession.current = null;
      setLevel(0);
      setState('idle');
      // `onend` publishes; this covers browsers that do not fire it.
      window.setTimeout(publishCollected, 300);
      return;
    }
    const activeRecorder = recorder.current;
    recorder.current = null;
    setLevel(0);
    if (!activeRecorder) {
      setState('idle');
      return;
    }
    setState('transcribing');
    void activeRecorder
      .stop()
      .then(async (result) => {
        if (result.blob.size === 0) {
          setState('idle');
          return;
        }
        const transcription = await transcribeBlob(result.blob, {
          workspaceId,
          language:
            config?.sttLanguage && config.sttLanguage !== 'auto'
              ? config.sttLanguage
              : undefined,
        });
        setState('idle');
        publish(transcription.text);
      })
      .catch((err: unknown) => {
        const message =
          err instanceof Error ? err.message : 'Transcription failed';
        setState('error');
        setError(message);
        toast.push({ kind: 'error', message });
      });
  }, [
    clearAutoStop,
    config,
    mode,
    publish,
    publishCollected,
    toast,
    workspaceId,
  ]);

  // `finish` is referenced by the auto-stop timeout before it is defined; keep
  // a ref so the timeout always calls the latest version.
  useEffect(() => {
    finishRef.current = finish;
  }, [finish]);

  const start = useCallback(() => {
    if (disabled) return;
    setError(null);
    finalText.current = '';
    interimText.current = '';
    publishedRef.current = false;
    if (mode === 'browser') {
      const session = startBrowserDictation(config?.sttLanguage ?? 'auto', {
        onFinal: (text) => {
          finalText.current = `${finalText.current} ${text}`.trim();
          armAutoStop();
        },
        onInterim: (text) => {
          interimText.current = text;
          if (text) armAutoStop();
        },
        onError: (message) => {
          setError(message);
          setState('error');
          toast.push({ kind: 'error', message });
        },
        onEnd: () => {
          setState((current) => (current === 'listening' ? 'idle' : current));
          publishCollected();
        },
      });
      if (!session) {
        const message =
          'Browser dictation is not available here. Switch to server dictation in Settings → Voice.';
        setError(message);
        setState('error');
        toast.push({ kind: 'error', message });
        return;
      }
      browserSession.current = session;
      setState('listening');
      return;
    }

    if (!getUserMediaSupported()) {
      const message = 'This browser cannot record audio.';
      setError(message);
      setState('error');
      toast.push({ kind: 'error', message });
      return;
    }
    const active = new AudioRecorder({
      onLevel: setLevel,
      silenceMs: config?.autoSend ? AUTO_STOP_SILENCE_MS : undefined,
      onSilence: () => finishRef.current(),
    });
    recorder.current = active;
    setState('listening');
    void active.start().catch((err: unknown) => {
      // Release the microphone even though the recorder never started:
      // getUserMedia may already have opened the track before MediaRecorder
      // construction failed (privacy + resource leak).
      active.cancel();
      recorder.current = null;
      const message =
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Microphone access was denied. Allow it in the browser and try again.'
          : 'Could not start recording.';
      setError(message);
      setState('error');
      toast.push({ kind: 'error', message });
    });
  }, [
    armAutoStop,
    config?.autoSend,
    config?.sttLanguage,
    disabled,
    mode,
    publishCollected,
    toast,
  ]);

  const stop = useCallback(() => {
    if (state === 'listening') finish();
  }, [finish, state]);

  useEffect(
    () => () => {
      clearAutoStop();
      browserSession.current?.stop();
      recorder.current?.cancel();
    },
    [clearAutoStop],
  );

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    pressedAt.current = performance.now();
    if (state === 'listening') {
      pressedWhileListening.current = true;
      return;
    }
    if (state === 'transcribing') return;
    pressedWhileListening.current = false;
    start();
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (state !== 'listening') return;
    const held = performance.now() - pressedAt.current;
    // A press that started while already listening is a click-to-stop; a
    // press that started the session stops only after a long hold
    // (push-to-talk release), otherwise it remains listening in toggle mode.
    if (pressedWhileListening.current || held >= PUSH_TO_TALK_MS) {
      stop();
    }
  }

  const listening = state === 'listening';
  const transcribing = state === 'transcribing';
  const label = listening
    ? 'Stop dictation'
    : transcribing
      ? 'Transcribing…'
      : error
        ? `Dictation error: ${error}`
        : 'Dictate (click to toggle, hold to talk)';

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onContextMenu={(event) => event.preventDefault()}
        disabled={disabled || transcribing}
        aria-label={label}
        aria-pressed={listening}
        title={label}
        className={`relative rounded-lg border p-2 transition-colors disabled:opacity-40 ${
          listening
            ? 'border-red-500/60 bg-red-950/50 text-red-300'
            : error
              ? 'border-red-900/60 text-red-400 hover:bg-zinc-800'
              : 'border-zinc-600 text-zinc-300 hover:bg-zinc-800'
        }`}
      >
        {transcribing ? (
          <span className="block h-4 w-4 animate-spin rounded-full border-2 border-zinc-500 border-t-transparent" />
        ) : (
          <MicIcon className="h-4 w-4" />
        )}
      </button>
      {listening && (
        <span className="flex h-5 items-end gap-0.5" aria-hidden>
          {[0, 1, 2, 3, 4].map((bar) => (
            <span
              key={bar}
              className="w-0.5 rounded-full bg-red-400 transition-all"
              style={{
                height: `${Math.max(3, level * 18 * (1 - Math.abs(2 - bar) / 4))}px`,
              }}
            />
          ))}
        </span>
      )}
    </div>
  );
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className={className}
      aria-hidden
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
    </svg>
  );
}
