import OpenAI from 'openai';

import { getSetting } from './settings.service.js';

const BATCH_SIZE = 100;

const EMBEDDING_MODEL_FALLBACK = 'text-embedding-3-small';

/** Resolve the effective OpenAI credentials/options (settings > env). */
async function openAIConfig(): Promise<{
  apiKey: string;
  model: string;
  baseUrl: string | undefined;
}> {
  const apiKey = await getSetting('openai.apiKey');
  const model = await getSetting('openai.embeddingModel');
  const baseUrl = (await getSetting('openai.baseUrl')) || undefined;
  return { apiKey, model: model || EMBEDDING_MODEL_FALLBACK, baseUrl };
}

/**
 * Local providers (Ollama, LM Studio, ...) don't need an API key - it is
 * only required when talking to OpenAI's cloud (no base URL).
 */
export async function assertOpenAIConfigured(): Promise<void> {
  const { apiKey, baseUrl } = await openAIConfig();
  if (!baseUrl && (!apiKey || apiKey === 'sk-your-key-here')) {
    throw new Error(
      'No API key configured. Set OPENAI_API_KEY, or set an API base URL for a local provider, in .env or the settings panel.',
    );
  }
}

/** Vector dimensions expected for stored embeddings (settings-driven). */
export async function getEmbeddingDimensions(): Promise<number> {
  return Number(await getSetting('embedding.dimensions')) || 1536;
}

/**
 * Embed a list of texts, chunking into groups of 100 per OpenAI request.
 * Returns vectors in the same order as the input texts. The client is
 * constructed per call so settings changes apply without a restart.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  await assertOpenAIConfigured();
  const { apiKey, model, baseUrl } = await openAIConfig();

  // Local providers accept any key; OpenAI SDK requires a non-empty string.
  const client = new OpenAI({
    apiKey: apiKey || 'local',
    baseURL: baseUrl,
    timeout: 60_000,
    maxRetries: 2,
  });

  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await client.embeddings.create({
      model,
      input: batch,
      // The SDK defaults to base64-encoded embeddings (OpenAI-only). Local
      // providers return plain floats, so request float explicitly.
      encoding_format: 'float',
    });
    if (response.data.length !== batch.length) {
      throw new Error(
        `Embedding count mismatch: expected ${batch.length}, got ${response.data.length}`,
      );
    }
    for (const item of response.data) {
      vectors.push(item.embedding);
    }
  }
  return vectors;
}

export async function embedText(text: string): Promise<number[]> {
  const [vector] = await embedTexts([text]);
  if (!vector) throw new Error('Embedding request returned no vectors');
  return vector;
}
