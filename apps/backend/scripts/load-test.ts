#!/usr/bin/env node
/**
 * Retrieval scale harness (R-17).
 *
 * Seeds a synthetic workspace with N chunks of the configured dimension,
 * ANALYZEs the table, then measures the vector arm of retrieval and reports
 * whether the partial HNSW index was used. This is the tool behind the
 * documented envelope in README.md ("Scale & performance"); it is not part of
 * the product runtime.
 *
 *   pnpm --filter @nexus/backend load-test -- --chunks=20000 --queries=30
 *
 * Options: --chunks, --queries, --dims, --keep, --workspace <uuid>.
 * Requires DATABASE_URL (and pgvector with HNSW support).
 */
import '../src/utils/env.js';

import { performance } from 'node:perf_hooks';

import pg from 'pg';

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}
// Env vars are the reliable form through pnpm; flags work when running the
// script directly with tsx.
const chunkCount = Number(
  process.env.LOAD_TEST_CHUNKS ?? flag('chunks') ?? 20_000,
);
const queryCount = Number(
  process.env.LOAD_TEST_QUERIES ?? flag('queries') ?? 30,
);
const dims = Number(process.env.LOAD_TEST_DIMS ?? flag('dims') ?? 1536);
const keep = args.includes('--keep');
const existingWorkspace = flag('workspace');
const model = process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small';

if (!Number.isInteger(chunkCount) || chunkCount < 100) {
  throw new Error('--chunks must be an integer >= 100');
}
if (!Number.isInteger(dims) || dims < 64 || dims > 4096) {
  throw new Error('--dims must be an integer between 64 and 4096');
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

function vectorLiteral(): string {
  const values: number[] = [];
  for (let i = 0; i < dims; i++) values.push(Math.random() * 2 - 1);
  // normalise so cosine distance is comparable across probes
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return `[${values.map((value) => (value / norm).toFixed(6)).join(',')}]`;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
}

let workspaceId = existingWorkspace;
try {
  if (!workspaceId) {
    const user = await client.query<{ id: string }>(
      `SELECT id FROM users ORDER BY created_at ASC LIMIT 1`,
    );
    const userId = user.rows[0]?.id;
    if (!userId)
      throw new Error('No user row exists; start the app once first');
    const workspace = await client.query<{ id: string }>(
      `INSERT INTO workspaces (user_id, name, description)
       VALUES ($1, $2, 'Synthetic retrieval benchmark') RETURNING id`,
      [userId, `Load test ${new Date().toISOString()}`],
    );
    workspaceId = workspace.rows[0]?.id as string;
  }

  const doc = await client.query<{ id: string }>(
    `INSERT INTO documents (workspace_id, title, file_path, file_type, status, size_bytes)
     VALUES ($1, 'load-test.txt', 'load-test/load-test.txt', 'txt', 'ready', 0)
     RETURNING id`,
    [workspaceId],
  );
  const documentId = doc.rows[0]?.id as string;

  console.log(
    `seeding ${chunkCount.toLocaleString()} chunks (${dims} dims) into workspace ${workspaceId}...`,
  );
  const seedStarted = performance.now();
  // Generate vectors server-side in batches to keep memory flat. The subquery
  // is correlated on the generated row number so every row gets its own vector.
  const batch = 1_000;
  for (let offset = 0; offset < chunkCount; offset += batch) {
    const size = Math.min(batch, chunkCount - offset);
    await client.query(
      `INSERT INTO chunks
         (document_id, workspace_id, content, embedding, metadata, embedding_model,
          embedding_dims, embedding_version, content_hash, token_count)
       SELECT $1, $5,
              'Load test passage ' || g || ' about retrieval and learning.',
              (SELECT ('[' || string_agg((random() * 2 - 1)::text, ',') || ']')::vector
               FROM generate_series(1, $2) WHERE g IS NOT NULL),
              '{"chunkIndex": 0, "page": null}'::jsonb,
              $3, $2, 1, md5(random()::text), 20
       FROM generate_series(1, $4) AS g`,
      [documentId, dims, model, size, workspaceId],
    );
    process.stdout.write(
      `\r  ${Math.min(offset + size, chunkCount).toLocaleString()} / ${chunkCount.toLocaleString()}`,
    );
  }
  console.log(
    `\nseeded in ${((performance.now() - seedStarted) / 1000).toFixed(1)}s`,
  );

  await client.query('ANALYZE chunks');
  await client.query('ANALYZE documents');

  const dimsLiteral = Math.trunc(dims);
  const vectorSql = (probe: string) => `
    SELECT c.id, (1 - ((c.embedding::vector(${dimsLiteral})) <=> '${probe}'::vector)) AS similarity
    FROM chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE c.workspace_id = $1
      AND c.embedding_dims = ${dimsLiteral}
      AND (c.embedding_model = $2 OR c.embedding_model IS NULL)
    ORDER BY (c.embedding::vector(${dimsLiteral})) <=> '${probe}'::vector
    LIMIT 40`;

  console.log('plan for the vector arm:');
  const plan = await client.query<{ 'QUERY PLAN': string }>(
    `EXPLAIN (ANALYZE, BUFFERS) ${vectorSql(vectorLiteral())}`,
    [workspaceId, model],
  );
  for (const row of plan.rows) console.log(`  ${row['QUERY PLAN']}`);
  const planText = plan.rows.map((row) => row['QUERY PLAN']).join('\n');
  const usedHnsw = planText.includes('hnsw');
  console.log(
    usedHnsw
      ? 'HNSW index used.'
      : `WARNING: HNSW index not used for dims ${dimsLiteral}; check the partial index predicate.`,
  );

  const timings: number[] = [];
  for (let i = 0; i < queryCount; i++) {
    const started = performance.now();
    const result = await client.query(vectorSql(vectorLiteral()), [
      workspaceId,
      model,
    ]);
    if (result.rows.length === 0) {
      throw new Error('Vector query returned no rows; seeding failed');
    }
    timings.push(performance.now() - started);
  }
  timings.sort((a, b) => a - b);
  const ms = (value: number) => `${value.toFixed(1)}ms`;
  console.log(
    `vector arm (${queryCount} queries, ${chunkCount.toLocaleString()} chunks, ${dims} dims): ` +
      `p50 ${ms(percentile(timings, 50))}, p95 ${ms(percentile(timings, 95))}, ` +
      `max ${ms(timings[timings.length - 1] ?? 0)}`,
  );

  console.log(
    JSON.stringify(
      {
        chunks: chunkCount,
        dims,
        queries: queryCount,
        usedHnsw,
        p50Ms: Math.round(percentile(timings, 50) * 10) / 10,
        p95Ms: Math.round(percentile(timings, 95) * 10) / 10,
        maxMs: Math.round((timings[timings.length - 1] ?? 0) * 10) / 10,
        workspaceId,
      },
      null,
      2,
    ),
  );
} finally {
  if (!keep && workspaceId && !existingWorkspace) {
    await client
      .query('DELETE FROM workspaces WHERE id = $1', [workspaceId])
      .catch(() => undefined);
    console.log('synthetic workspace removed');
  }
  await client.end();
}
