import type { TtsResult, TtsVoice } from '@nexus/shared-types';
import { TTS_VOICES } from '@nexus/shared-types';

import { audioCacheKey, getCachedAudio, storeAudio } from './audio.service.js';
import { getOpenAIClient, getProviderConfig } from './openai-client.js';
import { getSetting, getSettingNumber } from './settings.service.js';
import { splitSentences } from './text-utils.js';

const PLACEHOLDER_KEY = 'sk-your-key-here';

function isRealKey(apiKey: string): boolean {
  return Boolean(apiKey) && apiKey !== PLACEHOLDER_KEY;
}

/** Server TTS is usable when the main provider or a dedicated TTS one is set. */
export async function ttsServerAvailable(): Promise<boolean> {
  const config = await getProviderConfig('tts');
  return Boolean(config.baseUrl) || isRealKey(config.apiKey);
}

export function resolveVoice(value: string | undefined): TtsVoice {
  return TTS_VOICES.includes(value as TtsVoice) ? (value as TtsVoice) : 'alloy';
}

export function clampSpeed(value: number | undefined, fallback = 1): number {
  if (value === undefined || Number.isNaN(value)) return fallback;
  return Math.min(2, Math.max(0.5, value));
}

export interface SynthesizeInput {
  text: string;
  userId: string;
  workspaceId?: string | null;
  voice?: string;
  speed?: number;
  format?: string;
}

/**
 * Synthesize speech for `text`, reusing the content-addressed cache. The
 * returned sentences are the karaoke units; the client distributes them over
 * the audio duration so highlighting needs no word-timestamp support from
 * the provider.
 */
export async function synthesizeSpeech(
  input: SynthesizeInput,
): Promise<TtsResult> {
  const text = input.text.trim();
  if (!text) throw new Error('Nothing to read aloud');

  const [model, defaultVoice, defaultSpeed, retentionDays] = await Promise.all([
    getSetting('voice.ttsModel'),
    getSetting('voice.ttsVoice'),
    getSettingNumber('voice.ttsSpeed'),
    getSettingNumber('voice.retentionDays'),
  ]);

  const voice = resolveVoice(input.voice || defaultVoice);
  const speed = clampSpeed(input.speed, clampSpeed(defaultSpeed));
  const format = (input.format || 'mp3').replace(/[^a-z0-9]/gi, '') || 'mp3';
  const sentences = splitSentences(text);

  const cacheKey = audioCacheKey({
    owner: input.userId,
    model: model || 'tts-1',
    voice,
    speed,
    format,
    text,
  });

  const cached = await getCachedAudio(cacheKey);
  if (cached) {
    return {
      audioId: cached.id,
      url: `/api/audio/${cached.id}`,
      mimeType: cached.mimeType,
      cached: true,
      voice,
      speed,
      sentences,
    };
  }

  const config = await getProviderConfig('tts');
  if (!config.baseUrl && !isRealKey(config.apiKey)) {
    throw new Error(
      'No text-to-speech provider configured. Set an API key or base URL for speech, or switch read-aloud to the browser voice in settings.',
    );
  }

  const client = await getOpenAIClient('tts');
  const response = await client.audio.speech.create({
    model: model || 'tts-1',
    voice,
    input: text,
    speed,
    response_format: format === 'wav' ? 'wav' : 'mp3',
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  const mimeType = response.headers.get('content-type') ?? 'audio/mpeg';

  const asset = await storeAudio({
    userId: input.userId,
    workspaceId: input.workspaceId ?? null,
    kind: 'tts',
    cacheKey,
    voice,
    speed,
    mimeType,
    buffer,
    durationMs: null,
    retentionDays,
  });

  return {
    audioId: asset.id,
    url: `/api/audio/${asset.id}`,
    mimeType: asset.mimeType,
    cached: false,
    voice,
    speed,
    sentences,
  };
}
