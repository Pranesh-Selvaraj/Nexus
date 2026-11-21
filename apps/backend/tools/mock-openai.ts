/**
 * Deterministic OpenAI-compatible stub for CI.
 *
 * Serves the three endpoints Nexus touches (embeddings, chat completions,
 * models) with stable fake data, so CI exercises the REAL ingestion →
 * embedding → retrieval → chat pipeline without an API key or network.
 *
 *   POST /v1/embeddings          -> 1536-dim deterministic vectors
 *   POST /v1/chat/completions    -> streaming (SSE) or plain JSON
 *   GET  /v1/models              -> model list
 *
 * Usage: pnpm --filter @nexus/backend mock:openai   (listens on 3310)
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_OPENAI_PORT ?? 3310);
const EMBEDDING_DIMS = 1536;

/** Deterministic pseudo-random vector from a string seed (0..1 range). */
function seededVector(seed: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const vec: number[] = [];
  let state = h >>> 0;
  for (let i = 0; i < EMBEDDING_DIMS; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    vec.push(state / 0xffffffff);
  }
  return vec;
}

function json(res: import('node:http').ServerResponse, body: unknown): void {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(
  req: import('node:http').IncomingMessage,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

/** Consume and discard a request body (multipart audio cannot be JSON). */
function drain(req: import('node:http').IncomingMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    req.on('data', () => undefined);
    req.on('end', () => resolve());
    req.on('error', reject);
  });
}

/**
 * Minimal mono 16-bit PCM WAV of a quiet tone. Long enough (~0.8 s) that the
 * frontend's duration-based sentence highlighting has time to advance.
 */
function stubWav(seconds = 0.8, sampleRate = 8000): Buffer {
  const samples = Math.floor(seconds * sampleRate);
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples; i++) {
    buffer.writeInt16LE(Math.round(Math.sin(i / 12) * 2000), 44 + i * 2);
  }
  return buffer;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      json(res, {
        object: 'list',
        data: [
          { id: 'stub-chat-model', object: 'model' },
          { id: 'stub-embedding-model', object: 'model' },
        ],
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/embeddings') {
      const body = await readBody(req);
      const input = body.input;
      const texts = Array.isArray(input) ? input : [input ?? ''];
      json(res, {
        object: 'list',
        model: body.model,
        data: texts.map((t, index) => ({
          object: 'embedding',
          index,
          embedding: seededVector(String(t)),
        })),
        usage: { prompt_tokens: 10, total_tokens: 10 },
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/audio/transcriptions') {
      // The body is multipart audio, which this stub deliberately does not
      // parse: the real pipeline sends it to the provider and only the text
      // matters to the callers. A fixed transcript keeps tests deterministic.
      await drain(req);
      json(res, {
        text: 'What does Nexus combine for retrieval, and how are flashcards scheduled?',
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/audio/speech') {
      await readBody(req);
      const audio = stubWav();
      res.writeHead(200, {
        'content-type': 'audio/wav',
        'content-length': String(audio.byteLength),
      });
      res.end(audio);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      const body = await readBody(req);
      const model = String(body.model ?? 'stub-chat-model');

      // Flatten text content parts so multimodal requests (image_url + text)
      // are matched by their instruction just like plain text ones.
      const contentText = (content: unknown): string => {
        if (typeof content === 'string') return content;
        if (!Array.isArray(content)) return '';
        return content
          .map((part) => {
            if (part && typeof part === 'object' && 'text' in part) {
              return String((part as { text?: unknown }).text ?? '');
            }
            return '';
          })
          .join('\n');
      };
      const hasImage = Array.isArray(body.messages)
        ? body.messages.some(
            (message: { content?: unknown }) =>
              Array.isArray(message?.content) &&
              message.content.some(
                (part: { type?: string }) => part?.type === 'image_url',
              ),
          )
        : false;
      const promptText = Array.isArray(body.messages)
        ? body.messages
            .map((message: { content?: unknown }) =>
              contentText(message?.content),
            )
            .join('\n')
        : '';

      // Deterministic vision answers: the backend's mode instructions are
      // distinctive, so the stub can echo back which mode ran. Ingestion's
      // description prompt (retrieval-friendly) gets its own text so an
      // indexed image has stable, searchable content.
      if (hasImage) {
        const visionAnswer = /retrieval-friendly description/i.test(promptText)
          ? 'Stub image description: a two-panel diagram of hybrid retrieval. The left panel shows vector similarity, the right panel shows keyword search, and a central arrow labelled fusion joins them into one ranked list.'
          : /art critic/i.test(promptText)
            ? 'Composition: an asymmetric still life with the focal point low-left and a strong diagonal of light. Palette: warm ochres against cool greys. Technique: visible impasto, likely oil. Context: influenced by post-impressionism. Observation, then interpretation: the tilted table reads as instability rather than error. [1]'
            : /diagram or schematic/i.test(promptText)
              ? 'Components: two input boxes (vectors, keywords), a fusion block, and one ranked output list. Labels read "embed", "BM25", "RRF". Arrows flow left to right and converge on the output. The diagram teaches that hybrid retrieval fuses two signals. [1]'
              : /Transcribe every equation/i.test(promptText)
                ? 'Equations: `RRF(d) = \\sum_{r \\in R} \\frac{1}{k + r(d)}` — R is the set of ranked lists, r(d) is the rank of document d in list r, k is the smoothing constant. [1]'
                : 'Stub vision answer: the image shows a hand-drawn diagram of hybrid retrieval with the labels vectors, keywords and fused ranking. [1]';
        if (body.stream) {
          res.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
          });
          const delayMs = Number(process.env.MOCK_STREAM_DELAY_MS ?? 5);
          for (const word of visionAnswer.split(' ')) {
            res.write(
              `data: ${JSON.stringify({
                id: 'chatcmpl-stub-vision',
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [
                  {
                    index: 0,
                    delta: { content: `${word} ` },
                    finish_reason: null,
                  },
                ],
              })}\n\n`,
            );
            await new Promise((r) => setTimeout(r, delayMs));
          }
          res.write(
            `data: ${JSON.stringify({
              id: 'chatcmpl-stub-vision',
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            })}\n\n`,
          );
          res.end('data: [DONE]\n\n');
          return;
        }
        json(res, {
          id: 'chatcmpl-stub-vision',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: visionAnswer },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 80,
            completion_tokens: 40,
            total_tokens: 120,
          },
        });
        return;
      }

      const answer =
        'Stub answer: Nexus is a retrieval-augmented generation system. [1]';

      // Deterministic flashcards for the study-loop flows: the backend's
      // card-generation prompt asks for "study flashcards".
      // Deterministic vocabulary mining (backend prompt mentions "Mine
      // vocabulary").
      if (!body.stream && /mine vocabulary/i.test(promptText)) {
        json(res, {
          id: 'chatcmpl-stub-vocab',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: JSON.stringify([
                  {
                    term: 'retrieval',
                    translation: 'recuperación',
                    partOfSpeech: 'noun',
                    example: 'Hybrid retrieval combines both signals.',
                  },
                  {
                    term: 'scheduled',
                    translation: 'programado',
                    partOfSpeech: 'adjective',
                    example: 'Flashcards are scheduled with FSRS.',
                  },
                  {
                    term: 'fuse',
                    translation: 'fusionar',
                    partOfSpeech: 'verb',
                    example: 'Both arms fuse into one ranking.',
                  },
                ]),
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 30, completion_tokens: 60, total_tokens: 90 },
        });
        return;
      }

      // Deterministic quiz generation (backend prompt mentions "quiz
      // questions").
      if (!body.stream && /quiz questions/i.test(promptText)) {
        json(res, {
          id: 'chatcmpl-stub-quiz',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: JSON.stringify([
                  {
                    kind: 'mcq',
                    prompt: 'What does Nexus combine for retrieval?',
                    options: [
                      'Vector similarity and keyword search',
                      'Only keyword search',
                      'Only vector similarity',
                    ],
                    answer: 'Vector similarity and keyword search',
                    explanation: 'Hybrid retrieval fuses both arms.',
                  },
                  {
                    kind: 'truefalse',
                    prompt: 'Flashcards are scheduled with FSRS.',
                    answer: true,
                    explanation: 'FSRS schedules spaced reviews.',
                  },
                  {
                    kind: 'short',
                    prompt: 'What does FSRS schedule?',
                    answer: 'flashcard reviews',
                    explanation: 'It schedules spaced reviews.',
                  },
                ]),
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 30, completion_tokens: 60, total_tokens: 90 },
        });
        return;
      }

      // Short-answer grading (one grade is enough for the stub quiz).
      if (!body.stream && /Grade these short answers/i.test(promptText)) {
        json(res, {
          id: 'chatcmpl-stub-grade',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: JSON.stringify([
                  {
                    correct: true,
                    feedback: 'Matches the expected answer.',
                  },
                ]),
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        });
        return;
      }

      // Deterministic studio artifacts (backend prompt mentions "learning
      // artifact" and carries an "Artifact kind:" marker).
      if (!body.stream && /learning artifact/i.test(promptText)) {
        const kind = /Artifact kind: (\w+)/.exec(promptText)?.[1] ?? 'summary';
        const artifacts: Record<string, string> = {
          summary:
            '## Summary\n\nNexus combines vector similarity with keyword search and turns documents into study material.\n\n- Hybrid retrieval melts both arms into one ranking.\n- Indexing runs asynchronously.\n- Flashcards and quizzes close the learning loop.',
          study_guide:
            '# Study guide\n\n## Key concepts\n- **Hybrid retrieval**: fuses vector and keyword candidates.\n- **FSRS**: schedules flashcard reviews.\n\n## Self-test\n1. What does RRF fuse?\n2. What schedules reviews?',
          glossary:
            '| Term | Definition |\n| --- | --- |\n| RRF | Reciprocal rank fusion of two ranked lists. |\n| FSRS | Free Spaced Repetition Scheduler. |',
          mindmap:
            '```mermaid\nmindmap\n  root((Nexus))\n    Retrieval\n      Vectors\n      Keywords\n    Study\n      Flashcards\n      Quizzes\n      Artifacts\n```',
        };
        json(res, {
          id: 'chatcmpl-stub-artifact',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: artifacts[kind] ?? artifacts.summary,
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 30, completion_tokens: 60, total_tokens: 90 },
        });
        return;
      }

      if (!body.stream && /flashcards/i.test(promptText)) {
        json(res, {
          id: 'chatcmpl-stub-cards',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: JSON.stringify([
                  {
                    front: 'What does Nexus combine for retrieval?',
                    back: 'Vector similarity and Postgres full-text search, fused by rank.',
                  },
                  {
                    front: 'What schedules flashcard reviews?',
                    back: 'FSRS spaced-repetition scheduling.',
                  },
                  {
                    front: 'Where do answers come from?',
                    back: 'Only the sources retrieved from the workspace.',
                  },
                ]),
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 40, total_tokens: 60 },
        });
        return;
      }

      if (body.stream) {
        // Server-Sent Events stream (matches the OpenAI SDK's expectations,
        // including a final usage chunk when stream_options.include_usage).
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        // 5ms keeps CI/e2e fast; the visual QA harness raises this so the
        // mid-stream state is actually observable in a screenshot.
        const streamDelayMs = Number(process.env.MOCK_STREAM_DELAY_MS ?? 5);
        const words = answer.split(' ');
        for (const word of words) {
          const chunk = {
            id: 'chatcmpl-stub',
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [
              { index: 0, delta: { content: word + ' ' }, finish_reason: null },
            ],
          };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          await new Promise((r) => setTimeout(r, streamDelayMs));
        }
        res.write(
          `data: ${JSON.stringify({
            id: 'chatcmpl-stub',
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          })}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify({
            id: 'chatcmpl-stub',
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [],
            usage: {
              prompt_tokens: 12,
              completion_tokens: 12,
              total_tokens: 24,
            },
          })}\n\n`,
        );
        res.end('data: [DONE]\n\n');
        return;
      }

      json(res, {
        id: 'chatcmpl-stub',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: answer },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 12, total_tokens: 24 },
      });
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        error: { message: `no stub for ${req.method} ${url.pathname}` },
      }),
    );
  } catch (err) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: String(err) } }));
  }
});

server.listen(PORT, () => {
  console.log(`[mock-openai] listening on http://localhost:${PORT}/v1`);
});
