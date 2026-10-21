import type {
  TranscriptionResult,
  TtsRequest,
  TtsResult,
} from '@nexus/shared-types';

// ---------------------------------------------------------------------------
// Audio HTTP client (cookie-authenticated, same-origin)
// ---------------------------------------------------------------------------

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    // Non-JSON error body (proxy/HTML) - fall through to the status text.
  }
  return `Request failed (${response.status})`;
}

async function ensureOk(response: Response): Promise<void> {
  if (!response.ok) throw new Error(await errorMessage(response));
}

/** Synthesize speech server-side and return cached metadata + a URL. */
export async function requestSpeech(input: TtsRequest): Promise<TtsResult> {
  const response = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(input),
  });
  await ensureOk(response);
  return (await response.json()) as TtsResult;
}

const MIME_EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

export function extensionForMime(mimeType: string): string {
  const base = mimeType.split(';')[0]?.trim() ?? '';
  return MIME_EXTENSIONS[base] ?? 'webm';
}

/** Upload a recorded clip for server transcription. */
export async function transcribeBlob(
  blob: Blob,
  options: { workspaceId?: string; language?: string; store?: boolean },
): Promise<TranscriptionResult> {
  const form = new FormData();
  form.append(
    'audio',
    blob,
    `recording.${extensionForMime(blob.type || 'audio/webm')}`,
  );
  if (options.workspaceId) form.append('workspaceId', options.workspaceId);
  if (options.language) form.append('language', options.language);
  if (options.store) form.append('store', 'true');
  const response = await fetch('/api/transcribe', {
    method: 'POST',
    credentials: 'same-origin',
    body: form,
  });
  await ensureOk(response);
  return (await response.json()) as TranscriptionResult;
}

export function audioUrl(audioId: string, download = false): string {
  return `/api/audio/${audioId}${download ? '?download=1' : ''}`;
}

// ---------------------------------------------------------------------------
// MediaRecorder wrapper with a live level meter and optional silence stop
// ---------------------------------------------------------------------------

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

export interface RecorderOptions {
  /** Normalised 0..1 input level, sampled per animation frame. */
  onLevel?: (level: number) => void;
  /** Stop automatically after this many ms of silence following speech. */
  silenceMs?: number;
  onSilence?: () => void;
}

const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
];

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const mimeType of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mimeType)) return mimeType;
  }
  return '';
}

/**
 * Records microphone audio, exposes a level meter for the waveform, and can
 * auto-stop after a silence window (VAD). All resources are released on stop
 * or cancel.
 */
export class AudioRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private frame: number | null = null;
  private speechStarted = false;
  private silenceStartedAt: number | null = null;
  private silenceFired = false;
  /** Set by stop()/cancel() so an in-flight start() disposes its stream. */
  private cancelled = false;
  private readonly options: RecorderOptions;

  constructor(options: RecorderOptions = {}) {
    this.options = options;
  }

  async start(): Promise<void> {
    if (this.recorder) return;
    this.cancelled = false;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // The user may have stopped (or the component unmounted) while the
    // permission prompt / device open was pending: release immediately so the
    // microphone is never left hot.
    if (this.cancelled) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    this.stream = stream;
    const mimeType = pickMimeType();
    this.recorder = new MediaRecorder(
      this.stream,
      mimeType ? { mimeType } : undefined,
    );
    this.chunks = [];
    this.startedAt = performance.now();
    this.speechStarted = false;
    this.silenceStartedAt = null;
    this.silenceFired = false;
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.start(250);
    this.startMeter();
  }

  private startMeter(): void {
    if (!this.stream || typeof AudioContext === 'undefined') return;
    const AudioContextCtor = window.AudioContext;
    this.audioContext = new AudioContextCtor();
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 512;
    source.connect(this.analyser);
    const data = new Uint8Array(this.analyser.frequencyBinCount);

    const tick = (): void => {
      if (!this.analyser) return;
      this.analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const sample of data) {
        const centered = (sample - 128) / 128;
        sum += centered * centered;
      }
      const rms = Math.sqrt(sum / data.length);
      const level = Math.min(1, rms * 3);
      this.options.onLevel?.(level);

      // VAD: require some speech before the silence window can trigger, so
      // ambient quiet right after starting never auto-stops immediately.
      if (level > 0.08) {
        this.speechStarted = true;
        this.silenceStartedAt = null;
      } else if (this.speechStarted && this.options.silenceMs) {
        const now = performance.now();
        if (this.silenceStartedAt === null) {
          this.silenceStartedAt = now;
        } else if (
          !this.silenceFired &&
          now - this.silenceStartedAt >= this.options.silenceMs
        ) {
          this.silenceFired = true;
          this.options.onSilence?.();
        }
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  stop(): Promise<RecordingResult> {
    const recorder = this.recorder;
    if (!recorder) {
      // No recorder yet (stop raced the getUserMedia await): mark the pending
      // start as cancelled so it disposes its stream when it resolves.
      this.cancelled = true;
      return Promise.resolve({
        blob: new Blob([], { type: 'audio/webm' }),
        mimeType: 'audio/webm',
        durationMs: 0,
      });
    }
    const durationMs = Math.round(performance.now() - this.startedAt);
    const mimeType = recorder.mimeType || 'audio/webm';

    return new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: mimeType });
        this.release();
        resolve({ blob, mimeType, durationMs });
      };
      try {
        recorder.stop();
      } catch {
        this.release();
        resolve({
          blob: new Blob(this.chunks, { type: mimeType }),
          mimeType,
          durationMs,
        });
      }
    });
  }

  cancel(): void {
    this.cancelled = true;
    try {
      this.recorder?.stop();
    } catch {
      // ignore
    }
    this.release();
  }

  get recording(): boolean {
    return this.recorder?.state === 'recording';
  }

  private release(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.analyser = null;
    void this.audioContext?.close().catch(() => undefined);
    this.audioContext = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.recorder = null;
  }
}

export function getUserMediaSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}
