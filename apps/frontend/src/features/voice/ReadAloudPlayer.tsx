import { useEffect, useMemo, useRef, useState } from 'react';

import type { TtsResult, TtsVoice, VoiceConfig } from '@nexus/shared-types';
import { TTS_VOICES } from '@nexus/shared-types';

import { useToast } from '../../components/Toast';
import { audioUrl, requestSpeech } from '../../lib/audio';
import {
  getBrowserVoices,
  speakSentences,
  splitSentences,
  speechSynthesisSupported,
} from '../../lib/speech';
import type { BrowserSpeechSession } from '../../lib/speech';

interface Props {
  text: string;
  workspaceId?: string;
  config: VoiceConfig | undefined;
  /** Button label; defaults to "Read aloud". */
  label?: string;
  /** Rendered inside a floating selection toolbar. */
  compact?: boolean;
  /** Start with the player expanded (used by the selection toolbar). */
  defaultOpen?: boolean;
  /** Called when the player is closed (lets the parent drop floating state). */
  onClose?: () => void;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/**
 * Read-aloud control with sentence highlighting. Server synthesis returns a
 * cached audio URL; the sentence boundaries are distributed over the clip's
 * real duration, so highlighting stays in sync without provider timestamps.
 * Falls back to the browser voice when server speech is unavailable.
 */
export function ReadAloudPlayer({
  text,
  workspaceId,
  config,
  label = 'Read aloud',
  compact = false,
  defaultOpen = false,
  onClose,
}: Props) {
  const toast = useToast();
  const [open, setOpen] = useState(defaultOpen);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [speed, setSpeed] = useState(config?.ttsSpeed ?? 1);
  const [voice, setVoice] = useState<TtsVoice>(config?.ttsVoice ?? 'alloy');
  const [tts, setTts] = useState<TtsResult | null>(null);
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>(
    [],
  );

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const browserSession = useRef<BrowserSpeechSession | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Mirrors `speed` synchronously: a restart scheduled right after a speed
  // change must synthesise at the NEW speed, but the `play` closure it calls
  // still holds the previous render's state value.
  const speedRef = useRef(speed);

  const sentences = useMemo(
    () => tts?.sentences ?? splitSentences(text),
    [tts, text],
  );
  const serverEngine =
    config?.ttsProvider === 'server' && config?.ttsServerAvailable === true;
  // Browser is only used when server speech is unavailable or failed for this
  // player instance. The override is set from event handlers, never effects.
  const [engineOverride, setEngineOverride] = useState<'browser' | null>(null);
  const engine: 'server' | 'browser' =
    engineOverride ?? (serverEngine ? 'server' : 'browser');

  useEffect(() => {
    if (open) void getBrowserVoices().then(setBrowserVoices);
  }, [open]);

  // Expanding the player below the message actions can leave it below the
  // chat viewport's fold; bring it into view without moving the whole page.
  useEffect(() => {
    if (open) containerRef.current?.scrollIntoView({ block: 'nearest' });
  }, [open]);

  useEffect(
    () => () => {
      browserSession.current?.stop();
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
    },
    [],
  );

  function stopPlayback() {
    browserSession.current?.stop();
    browserSession.current = null;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setPlaying(false);
    setCurrentIndex(0);
  }

  async function startServer() {
    const result = await requestSpeech({
      text,
      voice,
      speed: speedRef.current,
      workspaceId,
    });
    setTts(result);
    const audio = audioRef.current;
    if (audio) {
      audio.src = audioUrl(result.audioId);
      audio.playbackRate = 1;
      await audio.play();
      setPlaying(true);
    }
  }

  function startBrowser() {
    if (!speechSynthesisSupported()) {
      toast.push({
        kind: 'error',
        message: 'This browser has no speech voices.',
      });
      return;
    }
    const preferred =
      browserVoices.find((item) =>
        item.name.toLowerCase().includes('google'),
      ) ??
      browserVoices[0] ??
      null;
    const session = speakSentences(
      sentences,
      { rate: speedRef.current, voice: preferred },
      {
        onSentence: (index) => {
          setCurrentIndex(index);
          setPlaying(true);
        },
        onEnd: () => {
          setPlaying(false);
          setCurrentIndex(0);
          browserSession.current = null;
        },
        onError: (message) => toast.push({ kind: 'error', message }),
      },
    );
    browserSession.current = session;
  }

  async function play() {
    if (playing) {
      if (engine === 'server') audioRef.current?.pause();
      else browserSession.current?.pause();
      setPlaying(false);
      return;
    }
    // Resume server audio where it stopped.
    if (engine === 'server' && tts && audioRef.current) {
      await audioRef.current.play();
      setPlaying(true);
      return;
    }
    if (engine === 'browser' && browserSession.current) {
      browserSession.current.resume();
      setPlaying(true);
      return;
    }

    setLoading(true);
    try {
      if (engine === 'server') {
        await startServer();
      } else {
        startBrowser();
      }
    } catch (err) {
      // Server speech failed: degrade to the browser voice instead of dead-ending.
      const message = err instanceof Error ? err.message : 'Speech failed';
      if (engine === 'server' && speechSynthesisSupported()) {
        toast.push({
          kind: 'error',
          message: `${message} Using the browser voice instead.`,
        });
        setEngineOverride('browser');
        startBrowser();
      } else {
        toast.push({ kind: 'error', message });
      }
    } finally {
      setLoading(false);
    }
  }

  function handleTimeUpdate() {
    const audio = audioRef.current;
    if (!audio || !audio.duration || Number.isNaN(audio.duration)) return;
    const progress = audio.currentTime / audio.duration;
    const totalChars = sentences.reduce(
      (sum, sentence) => sum + sentence.length,
      0,
    );
    if (totalChars === 0) return;
    let accumulated = 0;
    for (let index = 0; index < sentences.length; index++) {
      accumulated += sentences[index]?.length ?? 0;
      if (progress <= accumulated / totalChars) {
        setCurrentIndex(index);
        return;
      }
    }
    setCurrentIndex(sentences.length - 1);
  }

  function changeSpeed(next: number) {
    speedRef.current = next;
    setSpeed(next);
    // Server clips are synthesised at the requested speed, so changing it
    // requires re-synthesis - applying playbackRate on top would compound the
    // speed. Browser utterances carry their rate per utterance and are simply
    // restarted.
    if (engine === 'server') {
      if (playing) {
        stopPlayback();
        setTts(null);
        window.setTimeout(() => void play(), 50);
      }
      return;
    }
    if (playing) {
      stopPlayback();
      window.setTimeout(() => void play(), 50);
    }
  }

  function changeVoice(next: TtsVoice) {
    setVoice(next);
    if (engine === 'server') {
      // A different voice is a different cache entry and different audio.
      stopPlayback();
      setTts(null);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          // Re-read the settings defaults each time the player opens so a
          // configuration change is reflected without a state-syncing effect.
          const defaultSpeed = config?.ttsSpeed ?? 1;
          speedRef.current = defaultSpeed;
          setSpeed(defaultSpeed);
          setVoice(config?.ttsVoice ?? 'alloy');
          setOpen(true);
        }}
        className={
          compact
            ? 'rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800'
            : 'hover:text-zinc-300'
        }
        title="Read this aloud"
      >
        {label}
      </button>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`mt-2 rounded-lg border border-zinc-700 bg-zinc-900/80 p-2 text-xs ${
        compact ? 'w-72' : 'w-full'
      }`}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void play()}
          disabled={loading}
          aria-label={playing ? 'Pause read-aloud' : 'Play read-aloud'}
          className="rounded bg-nexus-600 px-2 py-1 font-semibold text-white hover:bg-nexus-500 disabled:opacity-50"
        >
          {loading ? '…' : playing ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          onClick={stopPlayback}
          className="rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-800"
        >
          Stop
        </button>

        <label className="flex items-center gap-1 text-zinc-400">
          Speed
          <select
            value={speed}
            onChange={(event) => changeSpeed(Number(event.target.value))}
            className="rounded border border-zinc-700 bg-zinc-950 px-1 py-0.5 text-[11px] text-zinc-200 outline-none"
          >
            {SPEEDS.map((value) => (
              <option key={value} value={value}>
                {value}×
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1 text-zinc-400">
          Voice
          <select
            value={engine === 'server' ? voice : ''}
            onChange={(event) => changeVoice(event.target.value as TtsVoice)}
            disabled={engine === 'browser'}
            className="max-w-28 rounded border border-zinc-700 bg-zinc-950 px-1 py-0.5 text-[11px] text-zinc-200 outline-none disabled:opacity-50"
          >
            {engine === 'server' ? (
              TTS_VOICES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))
            ) : (
              <option value="">Browser default</option>
            )}
          </select>
        </label>

        {engine === 'server' && tts && (
          <a
            href={audioUrl(tts.audioId, true)}
            className="text-nexus-200 hover:underline"
            download
          >
            Download
          </a>
        )}

        <button
          type="button"
          onClick={() => {
            stopPlayback();
            setOpen(false);
            onClose?.();
          }}
          className="ml-auto text-zinc-500 hover:text-zinc-300"
          aria-label="Close player"
        >
          ✕
        </button>
      </div>

      <ol className="mt-2 max-h-28 space-y-1 overflow-y-auto">
        {sentences.map((sentence, index) => (
          <li
            key={`${index}-${sentence.slice(0, 12)}`}
            className={
              index === currentIndex && (playing || currentIndex > 0)
                ? 'rounded bg-nexus-600/20 px-1 text-nexus-100'
                : 'px-1 text-zinc-500'
            }
          >
            {sentence}
          </li>
        ))}
      </ol>

      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => {
          setPlaying(false);
          setCurrentIndex(0);
        }}
        onError={() => setPlaying(false)}
        className="hidden"
      />
      <p className="mt-1 text-[10px] text-zinc-600">
        {engine === 'server' ? 'Server voice (cached)' : 'Browser voice'}
      </p>
    </div>
  );
}
