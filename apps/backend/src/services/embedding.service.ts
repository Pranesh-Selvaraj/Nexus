import OpenAI from 'openai';

import { getSetting } from './settings.service.js';

export const EMBEDDING_DIMENSIONS = 1536;
const BATCH_SIZE = 100;

const EMBEDDING_MODEL_FALLBACK = 'text-embedding-3-small';

/** Resolve the effective OpenAI credentials/options (settings > env). */
async function openAIConfig(): Promise<{ apiKey: string; model: string }> {
  const apiKey = await getSetting('openai.apiKey');
  const model = await getSetting('openai.embeddingModel');
  return { apiKey, model: model || EMBEDDING_MODEL_FALLBACK };
}

export async function assertOpenAIConfigured(): Promise<void> {
  const { apiKey } = await openAIConfig();
  if (!apiKey || apiKey === 'sk-your-key-here') {
    throw new Error(
      'OPENAI_API_KEY is not configured. Set it in .env or the settings panel to enable embeddings and chat.',
    );
  }
}

/**
 * Embed a list of texts, chunking into groups of 100 per OpenAI request.
 * Returns vectors in the same order as the input texts. The client is
 * constructed per call so settings changes apply without a restart.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  await assertOpenAIConfigured();
  const { apiKey, model } = await openAIConfig();

  const client = new OpenAI({ apiKey, timeout: 60_000, maxRetries: 2 });

  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await client.embeddings.create({
      model,
      input: batch,
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
