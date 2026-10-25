/**
 * Vision capability: image descriptions at ingestion, image chat, and the
 * art/diagram/equation analysis modes.
 *
 * Vision is a provider capability, not a separate subsystem: it reuses the
 * OpenAI-compatible chat client (an `image_url` content part), with optional
 * dedicated base URL / key / model settings so a deployment can route images
 * to a different provider than text. When no vision-capable provider is
 * configured, image ingestion still works through OCR and the UI hides the
 * analysis affordances instead of failing at request time.
 */
import { createHash } from 'node:crypto';

import OpenAI from 'openai';

import type {
  AnalyzeImageResult,
  DocumentStructure,
  VisionConfig,
  VisionMode,
} from '@nexus/shared-types';
import { VISION_MODES } from '@nexus/shared-types';

import {
  defaultProviderHeaders,
  getOpenAIClient,
  getProviderConfig,
} from '../openai-client.js';
import { ocrAvailable } from './ocr.js';
import {
  getSetting,
  getSettingBoolean,
  getSettingNumber,
} from '../settings.service.js';

export const SUPPORTED_IMAGE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

/** Mode instructions appended to the vision prompt. */
export const VISION_INSTRUCTIONS: Record<VisionMode, string> = {
  general:
    'Describe this image for a study library: what it shows, any visible text, and the details a learner would ask about. Be concrete and avoid guessing.',
  art: [
    'Analyse this artwork as an art critic writing for a learner.',
    'Cover: subject and iconography, composition and focal point, colour and light, technique and medium (only if visible), style/period and plausible art-historical context, and what the work is doing emotionally.',
    'Separate observation from interpretation, name uncertainty explicitly, and finish with two short practice questions that would deepen the learner’s looking.',
  ].join(' '),
  diagram:
    'Read this diagram or schematic as an instructor. Identify the components, every label you can read, the direction of flows/arrows, and the relationships between parts. Then explain what the diagram is teaching and list anything ambiguous or unreadable.',
  equation:
    'Transcribe every equation in this image as LaTeX, then explain each symbol and the operation between lines. If a step is illegible, say which part you cannot read instead of inventing it.',
};

export interface VisionProviderResolution {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * Vision settings fall back to the chat provider field by field, so setting
 * only `vision.model` keeps the existing key/endpoint.
 */
export function resolveVisionProvider(input: {
  visionApiKey: string;
  visionBaseUrl: string;
  visionModel: string;
  chatApiKey: string;
  chatBaseUrl: string;
  chatModel: string;
}): VisionProviderResolution {
  return {
    apiKey: input.visionApiKey || input.chatApiKey,
    baseUrl: input.visionBaseUrl || input.chatBaseUrl,
    model: input.visionModel || input.chatModel,
  };
}

const PLACEHOLDER_KEY = 'sk-your-key-here';

function isRealKey(key: string): boolean {
  return Boolean(key) && key !== PLACEHOLDER_KEY;
}

async function visionProvider(): Promise<VisionProviderResolution> {
  const [visionApiKey, visionBaseUrl, visionModel, chatModel] =
    await Promise.all([
      getSetting('vision.apiKey'),
      getSetting('vision.baseUrl'),
      getSetting('vision.model'),
      getSetting('openai.model'),
    ]);
  const chat = await getProviderConfig('chat');
  return resolveVisionProvider({
    visionApiKey,
    visionBaseUrl,
    visionModel,
    chatApiKey: chat.apiKey,
    chatBaseUrl: chat.baseUrl,
    chatModel,
  });
}

/** True when the feature is enabled and a provider can serve images. */
export async function visionAvailable(): Promise<boolean> {
  if (!(await getSettingBoolean('vision.enabled'))) return false;
  const provider = await visionProvider();
  return Boolean(provider.baseUrl) || isRealKey(provider.apiKey);
}

/** Capability snapshot for the client (never includes keys). */
export async function visionConfig(): Promise<VisionConfig> {
  const [enabled, ocrEnabled, maxImageMb, provider] = await Promise.all([
    getSettingBoolean('vision.enabled'),
    getSettingBoolean('vision.ocrEnabled'),
    getSettingNumber('vision.maxImageMb'),
    visionProvider(),
  ]);
  const available =
    enabled && (Boolean(provider.baseUrl) || isRealKey(provider.apiKey));
  return {
    enabled,
    available,
    model: provider.model,
    ocrEnabled,
    ocrAvailable: await ocrAvailable(),
    maxImageMb,
    modes: VISION_MODES.map((mode) => mode.id),
  };
}

/** Reject images that would blow past the configured size or MIME allowlist. */
export function assertAnalyzableImage(
  buffer: Buffer,
  mime: string,
  maxImageMb: number,
): void {
  if (!SUPPORTED_IMAGE_MIME.has(mime)) {
    throw new Error(
      `Vision analysis supports PNG, JPEG, WebP and GIF images (got ${mime || 'unknown'})`,
    );
  }
  const maxBytes = maxImageMb * 1024 * 1024;
  if (buffer.byteLength > maxBytes) {
    throw new Error(
      `Image is ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB, above the ${maxImageMb} MB vision limit`,
    );
  }
  if (buffer.byteLength === 0) {
    throw new Error('Image is empty');
  }
}

/** data: URL for the provider's image_url part (never persisted). */
export function toDataUrl(buffer: Buffer, mime: string): string {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

/** Compose the instruction sent alongside an image. */
export function buildVisionPrompt(
  mode: VisionMode,
  options: { question?: string; ocrText?: string; title?: string } = {},
): string {
  const parts = [VISION_INSTRUCTIONS[mode]];
  if (options.title) parts.push(`Image: ${options.title}`);
  if (options.ocrText?.trim()) {
    parts.push(
      `Text recovered from the image by OCR (may contain errors; trust the image when they disagree):\n${options.ocrText.trim().slice(0, 6000)}`,
    );
  }
  if (options.question?.trim()) {
    parts.push(
      `The learner asks: ${options.question.trim()}\nAnswer that question first, then add anything important you noticed.`,
    );
  }
  return parts.join('\n\n');
}

/**
 * Bounded result cache: the same image + mode + question is a deterministic
 * request, and the UI lets users re-open an analysis without paying for it
 * again. Keys include the model so switching providers cannot serve a stale
 * answer from another model.
 */
const cache = new Map<string, { analysis: string; at: number }>();
const CACHE_MAX = 50;
const CACHE_TTL_MS = 60 * 60_000;

function cacheKey(
  buffer: Buffer,
  mode: VisionMode,
  question: string,
  model: string,
): string {
  return createHash('sha256')
    .update(buffer)
    .update(`|${mode}|${question}|${model}`)
    .digest('hex');
}

const visionClients = new Map<string, OpenAI>();

/**
 * A dedicated vision endpoint gets its own cached client. Without one the
 * shared chat client already points at the main provider, so reuse it (and
 * its connection pool / auth state) instead of building a duplicate.
 */
async function chatClient(provider: VisionProviderResolution): Promise<OpenAI> {
  if (!provider.baseUrl) return getOpenAIClient('chat');
  const key = `${provider.baseUrl}|${provider.apiKey}`;
  const existing = visionClients.get(key);
  if (existing) return existing;
  if (visionClients.size >= 5) visionClients.clear();
  const client = new OpenAI({
    apiKey: provider.apiKey || 'local',
    baseURL: provider.baseUrl,
    defaultHeaders: defaultProviderHeaders(),
    timeout: 120_000,
    maxRetries: 1,
  });
  visionClients.set(key, client);
  return client;
}

/** Drop cached analyses (tests and provider switches). */
export function clearVisionCache(): void {
  cache.clear();
}

export interface AnalyzeImageOptions {
  buffer: Buffer;
  mime: string;
  mode?: VisionMode;
  question?: string;
  ocrText?: string;
  title?: string;
  /** Skip the cache (used by ingestion, which wants a fresh description). */
  noCache?: boolean;
}

/** One vision request: image + mode instruction -> markdown analysis. */
export async function analyzeImage(
  options: AnalyzeImageOptions,
): Promise<{ analysis: string; model: string; cached: boolean }> {
  if (!(await visionAvailable())) {
    throw new Error(
      'Vision is not configured. Add a vision-capable provider (or enable vision and set a model) in Settings, or use OCR-only ingestion.',
    );
  }
  const maxImageMb = await getSettingNumber('vision.maxImageMb');
  assertAnalyzableImage(options.buffer, options.mime, maxImageMb);

  const provider = await visionProvider();
  const mode = options.mode ?? 'general';
  const question = options.question?.trim() ?? '';
  const key = cacheKey(options.buffer, mode, question, provider.model);
  if (!options.noCache) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return { analysis: hit.analysis, model: provider.model, cached: true };
    }
  }

  const client = await chatClient(provider);
  const prompt = buildVisionPrompt(mode, {
    question,
    ocrText: options.ocrText,
    title: options.title,
  });
  const completion = await client.chat.completions.create({
    model: provider.model,
    temperature: 0.2,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: { url: toDataUrl(options.buffer, options.mime) },
          },
        ],
      },
    ],
  });
  const analysis = completion.choices[0]?.message?.content?.trim() ?? '';
  if (!analysis) throw new Error('The vision model returned no analysis');

  if (cache.size >= CACHE_MAX) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  cache.set(key, { analysis, at: Date.now() });
  return { analysis, model: provider.model, cached: false };
}

/**
 * Description used at ingestion time. Kept separate from `analyzeImage` so
 * the library caption is stable and mode-independent (the chat/analysis modes
 * answer learner questions; this one describes the image for retrieval).
 */
export async function describeImageForIndex(
  buffer: Buffer,
  mime: string,
  title: string,
): Promise<{ description: string; model: string } | null> {
  if (!(await visionAvailable())) return null;
  const result = await analyzeImage({
    buffer,
    mime,
    mode: 'general',
    title,
    question:
      'Write a retrieval-friendly description: 2-4 short paragraphs plus a bullet list of key labels, objects and visible text. This text will be the searchable record of the image.',
    noCache: true,
  });
  return { description: result.analysis, model: result.model };
}

/** Assemble the stored analysis result for the router. */
export function toAnalyzeResult(input: {
  documentId: string;
  mode: VisionMode;
  analysis: string;
  model: string;
  ocrText: string;
  cached: boolean;
}): AnalyzeImageResult {
  return {
    documentId: input.documentId,
    mode: input.mode,
    analysis: input.analysis,
    model: input.model,
    ocrText: input.ocrText,
    cached: input.cached,
  };
}

/** Document metadata recorded for an image that produced searchable text. */
export function imageMetadata(input: {
  format: string;
  ocr: boolean;
  vision: boolean;
  sourceUrl?: string | null;
}): DocumentStructure {
  return {
    format: input.format,
    kind: 'image',
    ocr: input.ocr,
    vision: input.vision,
    sourceUrl: input.sourceUrl ?? null,
    pageCount: 1,
  };
}
