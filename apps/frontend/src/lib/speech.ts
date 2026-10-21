// ---------------------------------------------------------------------------
// Browser speech primitives: Web Speech API dictation and SpeechSynthesis
// read-aloud. Kept dependency-free and defensive: neither API is available in
// every browser, and SpeechSynthesis voice lists load asynchronously.
// ---------------------------------------------------------------------------

export interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

export interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternativeLike;
  [index: number]: SpeechRecognitionAlternativeLike;
}

export interface SpeechRecognitionResultListLike {
  readonly length: number;
  item(index: number): SpeechRecognitionResultLike;
  [index: number]: SpeechRecognitionResultLike;
}

export interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}

export interface SpeechRecognitionErrorEventLike {
  readonly error: string;
  readonly message?: string;
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface SpeechWindow extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

export function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const speechWindow = window as SpeechWindow;
  return (
    speechWindow.SpeechRecognition ??
    speechWindow.webkitSpeechRecognition ??
    null
  );
}

export function speechRecognitionSupported(): boolean {
  return getSpeechRecognitionConstructor() !== null;
}

export function speechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export interface DictationHandlers {
  /** Final transcription for a recognised segment. */
  onFinal: (text: string) => void;
  /** Live, not-yet-final text. */
  onInterim: (text: string) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}

export interface DictationSession {
  stop: () => void;
}

/**
 * Start Web Speech dictation. Returns null when the API is unavailable so the
 * caller can fall back to server transcription instead of throwing.
 */
export function startBrowserDictation(
  language: string,
  handlers: DictationHandlers,
): DictationSession | null {
  const Constructor = getSpeechRecognitionConstructor();
  if (!Constructor) return null;

  const recognition = new Constructor();
  recognition.lang = language && language !== 'auto' ? language : 'en-US';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (!result) continue;
      const alternative = result[0];
      const transcript = alternative?.transcript ?? '';
      if (result.isFinal) {
        const text = transcript.trim();
        if (text) handlers.onFinal(text);
      } else {
        interim += transcript;
      }
    }
    handlers.onInterim(interim.trim());
  };

  recognition.onerror = (event) => {
    handlers.onError(describeRecognitionError(event.error));
  };

  recognition.onend = () => {
    handlers.onInterim('');
    handlers.onEnd();
  };

  try {
    recognition.start();
  } catch {
    // start() throws if called twice; treat as an error and let the caller
    // reset its state.
    handlers.onError('Could not start the microphone');
    return null;
  }

  return {
    stop: () => {
      try {
        recognition.stop();
      } catch {
        // already stopped
      }
    },
  };
}

export function describeRecognitionError(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access was denied. Allow it in the browser and try again.';
    case 'no-speech':
      return 'No speech detected. Try again a little closer to the microphone.';
    case 'audio-capture':
      return 'No microphone was found.';
    case 'network':
      return 'The speech service is unreachable. Try server dictation instead.';
    case 'aborted':
      return 'Dictation stopped.';
    default:
      return `Dictation failed (${code}).`;
  }
}

// ---------------------------------------------------------------------------
// Browser text-to-speech
// ---------------------------------------------------------------------------

export interface BrowserSpeechHandlers {
  onSentence: (index: number) => void;
  onEnd: () => void;
  onError?: (message: string) => void;
}

export interface BrowserSpeechSession {
  pause: () => void;
  resume: () => void;
  stop: () => void;
}

/** Resolves when the async voice list is first available. */
export function getBrowserVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!speechSynthesisSupported()) return Promise.resolve([]);
  const existing = window.speechSynthesis.getVoices();
  if (existing.length > 0) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const finish = (): void => {
      window.speechSynthesis.onvoiceschanged = null;
      resolve(window.speechSynthesis.getVoices());
    };
    const timer = window.setTimeout(finish, 1500);
    window.speechSynthesis.onvoiceschanged = () => {
      window.clearTimeout(timer);
      finish();
    };
  });
}

/**
 * Speak sentences one utterance at a time so `onSentence` gives exact karaoke
 * highlighting without relying on word-boundary events (which many voices do
 * not emit). Pausing/resuming uses the global SpeechSynthesis queue.
 */
export function speakSentences(
  sentences: string[],
  options: { rate?: number; voice?: SpeechSynthesisVoice | null },
  handlers: BrowserSpeechHandlers,
): BrowserSpeechSession | null {
  if (!speechSynthesisSupported() || sentences.length === 0) return null;

  let stopped = false;
  let index = 0;

  const speakNext = (): void => {
    if (stopped) return;
    if (index >= sentences.length) {
      handlers.onEnd();
      return;
    }
    const current = index;
    const utterance = new SpeechSynthesisUtterance(sentences[current] ?? '');
    if (options.voice) utterance.voice = options.voice;
    utterance.rate = options.rate ?? 1;
    utterance.onstart = () => handlers.onSentence(current);
    utterance.onerror = (event) => {
      if (stopped || event.error === 'interrupted') return;
      handlers.onError?.(`Speech playback failed (${event.error}).`);
      handlers.onEnd();
    };
    utterance.onend = () => {
      if (stopped) return;
      index += 1;
      speakNext();
    };
    window.speechSynthesis.speak(utterance);
  };

  speakNext();

  return {
    pause: () => window.speechSynthesis.pause(),
    resume: () => window.speechSynthesis.resume(),
    stop: () => {
      stopped = true;
      window.speechSynthesis.cancel();
      handlers.onEnd();
    },
  };
}

/**
 * Sentence splitter mirroring the backend's text-utils so browser TTS and
 * server TTS highlight the same units.
 */
export function splitSentences(text: string, maxLength = 320): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  const sentences: string[] = [];
  for (const paragraph of normalized.split(/\n+/)) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    const parts = trimmed
      .split(/(?<=[.!?])\s+(?=[A-Z0-9"“'(])/)
      .map((part) => part.trim())
      .filter(Boolean);
    for (const part of parts) {
      if (part.length <= maxLength) {
        sentences.push(part);
        continue;
      }
      let current = '';
      for (const word of part.split(/\s+/)) {
        if (current && current.length + word.length + 1 > maxLength) {
          sentences.push(current);
          current = word;
        } else {
          current = current ? `${current} ${word}` : word;
        }
      }
      if (current) sentences.push(current);
    }
  }
  return sentences;
}
