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

    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      const body = await readBody(req);
      const model = String(body.model ?? 'stub-chat-model');
      const answer =
        'Stub answer: Nexus is a retrieval-augmented generation system. [1]';

      // Deterministic flashcards for the study-loop flows: the backend's
      // card-generation prompt asks for "study flashcards".
      const promptText = Array.isArray(body.messages)
        ? body.messages
            .map((message: { content?: unknown }) =>
              String(message?.content ?? ''),
            )
            .join('\n')
        : '';
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
