import OpenAI from 'openai';

import type { TranscriptionResult } from '@nexus/shared-types';

import {
  defaultProviderHeaders,
  getOpenAIClient,
  getProviderConfig,
} from './openai-client.js';
import { getSetting, getSettingNumber } from './settings.service.js';
import { storeAudio } from './audio.service.js';

const PLACEHOLDER_KEY = 'sk-your-key-here';

function isRealKey(apiKey: string): boolean {
  return Boolean(apiKey) && apiKey !== PLACEHOLDER_KEY;
}

/**
 * A speech-to-text provider is usable when a dedicated STT endpoint/key is
 * configured, the main provider can serve audio, or a local faster-whisper
 * sidecar URL is set.
 */
export async function sttServerAvailable(): Promise<boolean> {
  const config = await getProviderConfig('stt');
  return (
    Boolean(config.baseUrl) ||
    isRealKey(config.apiKey) ||
    Boolean(process.env.WHISPER_LOCAL_URL)
  );
}

/** BCP-47 tag or undefined when detection is left to the provider. */
export function resolveSttLanguage(
  setting: string,
  requested?: string,
): string | undefined {
  const value = (requested || setting || '').trim();
  if (!value || value.toLowerCase() === 'auto') return undefined;
  return value;
}

export interface TranscribeInput {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  userId: string;
  workspaceId?: string | null;
  language?: string;
  /** Retain the recording as an audio asset (retention policy applies). */
  store?: boolean;
}

interface ProviderTranscription {
  text: string;
  provider: string;
}

async function transcribeWithProvider(
  input: TranscribeInput,
  model: string,
  language: string | undefined,
): Promise<ProviderTranscription> {
  const client = await getOpenAIClient('stt');
  const file = new File([new Uint8Array(input.buffer)], input.filename, {
    type: input.mimeType,
  });
  const response = await client.audio.transcriptions.create({
    file,
    model,
    ...(language ? { language } : {}),
  });
  const text = typeof response === 'string' ? response : response.text;
  return { text: text ?? '', provider: `server:${model}` };
}

/**
 * Optional local fallback: a faster-whisper / whisper.cpp server that speaks
 * the OpenAI transcription protocol. Called only when the primary provider
 * request fails, so a hosted provider remains the fast path.
 */
async function transcribeWithLocal(
  input: TranscribeInput,
  model: string,
  language: string | undefined,
): Promise<ProviderTranscription> {
  const baseUrl = process.env.WHISPER_LOCAL_URL as string;
  const client = new OpenAI({
    apiKey: 'local',
    baseURL: baseUrl,
    defaultHeaders: defaultProviderHeaders(),
    timeout: 120_000,
    maxRetries: 1,
  });
  const file = new File([new Uint8Array(input.buffer)], input.filename, {
    type: input.mimeType,
  });
  const response = await client.audio.transcriptions.create({
    // A local sidecar usually serves a different model id than the cloud
    // (e.g. medium vs whisper-1); allow it to be overridden explicitly.
    file,
    model: process.env.WHISPER_LOCAL_MODEL || model,
    ...(language ? { language } : {}),
  });
  const text = typeof response === 'string' ? response : response.text;
  return { text: text ?? '', provider: 'local:whisper' };
}

/**
 * Transcribe an uploaded recording. Provider is tried first; when it fails
 * and a local sidecar is configured, the sidecar is used so a flaky or
 * unreachable cloud provider does not break dictation.
 */
export async function transcribeAudio(
  input: TranscribeInput,
): Promise<TranscriptionResult> {
  const model = (await getSetting('voice.sttModel')) || 'whisper-1';
  const language = resolveSttLanguage(
    await getSetting('voice.sttLanguage'),
    input.language,
  );

  const config = await getProviderConfig('stt');
  const providerUsable = Boolean(config.baseUrl) || isRealKey(config.apiKey);
  const localUsable = Boolean(process.env.WHISPER_LOCAL_URL);

  if (!providerUsable && !localUsable) {
    throw new Error(
      'No speech-to-text provider configured. Set an API key or base URL for transcription (or WHISPER_LOCAL_URL for a local faster-whisper server), or switch dictation to the browser engine in settings.',
    );
  }

  let result: ProviderTranscription | null = null;
  let providerError: unknown = null;
  if (providerUsable) {
    try {
      result = await transcribeWithProvider(input, model, language);
    } catch (error) {
      providerError = error;
    }
  }
  if (!result && localUsable) {
    result = await transcribeWithLocal(input, model, language);
  }
  if (!result) {
    throw providerError instanceof Error
      ? providerError
      : new Error('Transcription failed');
  }

  const text = result.text.trim();
  if (!text) {
    throw new Error('No speech detected in the recording');
  }

  let audioId: string | null = null;
  if (input.store) {
    const retentionDays = await getSettingNumber('voice.retentionDays');
    const durationMs = estimateDurationMs(
      input.buffer.byteLength,
      input.mimeType,
    );
    const asset = await storeAudio({
      userId: input.userId,
      workspaceId: input.workspaceId ?? null,
      kind: 'stt',
      mimeType: input.mimeType,
      buffer: input.buffer,
      durationMs,
      retentionDays,
    });
    audioId = asset.id;
  }

  return {
    text,
    language: language ?? null,
    provider: result.provider,
    durationMs: estimateDurationMs(input.buffer.byteLength, input.mimeType),
    audioId,
  };
}

/**
 * Rough duration estimate used only for UI metadata. Deliberately cheap: no
 * decoder dependency, and the player treats it as an estimate.
 */
export function estimateDurationMs(
  byteLength: number,
  mimeType: string,
): number {
  // ~16 kB/s for 128 kbps compressed audio, ~32 kB/s for 16-bit 16 kHz WAV.
  const bytesPerSecond = mimeType.includes('wav') ? 32_000 : 16_000;
  return Math.max(0, Math.round((byteLength / bytesPerSecond) * 1000));
}
