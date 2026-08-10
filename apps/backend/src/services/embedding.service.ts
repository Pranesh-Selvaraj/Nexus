import OpenAI from 'openai';

export const EMBEDDING_DIMENSIONS = 1536;
const BATCH_SIZE = 100;

export const embeddingClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? 'missing',
  timeout: 60_000,
  maxRetries: 2,
});

const EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small';

export function assertOpenAIConfigured(): void {
  if (
    !process.env.OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY === 'sk-your-key-here'
  ) {
    throw new Error(
      'OPENAI_API_KEY is not configured. Set it in .env to enable embeddings and chat.',
    );
  }
}

/**
 * Embed a list of texts, chunking into groups of 100 per OpenAI request.
 * Returns vectors in the same order as the input texts.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  assertOpenAIConfigured();

  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await embeddingClient.embeddings.create({
      model: EMBEDDING_MODEL,
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