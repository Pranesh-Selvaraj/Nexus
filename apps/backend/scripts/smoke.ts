import { spawn } from 'node:child_process';

import '../src/utils/env.js';

const API_PORT = 3100;
const BASE = `http://localhost:${API_PORT}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

/** Like fetchJson but against an arbitrary base URL (auth-mode instance). */
async function fetchJsonAuth(base: string, path: string, init?: RequestInit) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function print(name: string, ok: boolean, detail?: unknown) {
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${JSON.stringify(detail).slice(0, 220)}` : ''}`,
  );
}

const child = spawn('pnpm', ['exec', 'tsx', 'src/index.ts'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: {
    ...process.env,
    PORT: String(API_PORT),
    WS_PATH: '/ws',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const worker = spawn(
  'pnpm',
  ['exec', 'tsx', 'src/workers/embedding.worker.ts'],
  {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

let stdout = '';
child.stdout.on('data', (d) => (stdout += d.toString()));
child.stderr.on('data', (d) => (stdout += d.toString()));
worker.stderr.on('data', (d) => (stdout += d.toString()));

let ok = true;
try {
  // wait for API
  let healthy = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) {
        healthy = true;
        break;
      }
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  print('api healthz', healthy);
  if (!healthy) throw new Error('api did not start');

  // dependency-aware health probe (Postgres + Redis)
  const healthz = await fetch(`${BASE}/healthz`);
  const healthzBody = (await healthz.json()) as {
    status: string;
    db: string;
    redis: string;
  };
  print(
    'healthz reports dependencies up',
    healthz.status === 200 &&
      healthzBody.status === 'ok' &&
      healthzBody.db === 'up' &&
      healthzBody.redis === 'up',
    healthzBody,
  );

  // create workspace (no authentication in single-user mode)
  const wsCreate = await fetchJson('/trpc/workspace.create', {
    method: 'POST',
    body: JSON.stringify({ name: 'Smoke Workspace', description: 'test' }),
  });
  const workspaceId = wsCreate.body?.result?.data?.id;
  print('workspace.create', !!workspaceId, {
    name: wsCreate.body?.result?.data?.name,
  });

  // list workspaces (may include pre-existing workspaces adopted by the
  // local user on boot, so assert ours is present)
  const wsList = await fetchJson('/trpc/workspace.list', { method: 'GET' });
  const wsIds = (wsList.body?.result?.data ?? []).map((w: any) => w.id);
  print('workspace.list', wsIds.includes(workspaceId), { count: wsIds.length });

  // health procedure
  const health = await fetchJson('/trpc/health', { method: 'GET' });
  print('trpc health', health.body?.result?.data?.status === 'ok');

  // upload a txt file (multipart)
  const fd = new FormData();
  fd.append('workspaceId', workspaceId);
  fd.append(
    'file',
    new File(
      ['Nexus is a retrieval-augmented generation system.\n'.repeat(30)],
      'about-nexus.txt',
      { type: 'text/plain' },
    ),
  );
  const up = await fetch(`${BASE}/api/upload`, {
    method: 'POST',
    body: fd,
  });
  const upBody = await up.json();
  print(
    'upload txt',
    up.status === 201 && upBody?.document?.status === 'processing',
    { doc: upBody?.document },
  );

  // upload to a nonexistent workspace -> 404
  const fd3 = new FormData();
  fd3.append('workspaceId', '00000000-0000-4000-8000-000000000000');
  fd3.append('file', new File(['y'], 'y.txt', { type: 'text/plain' }));
  const upMissing = await fetch(`${BASE}/api/upload`, {
    method: 'POST',
    body: fd3,
  });
  print('upload to missing workspace rejected', upMissing.status === 404);

  // bogus extension -> 400
  const fd4 = new FormData();
  fd4.append('workspaceId', workspaceId);
  fd4.append(
    'file',
    new File(['z'], 'evil.exe', { type: 'application/octet-stream' }),
  );
  const upExe = await fetch(`${BASE}/api/upload`, {
    method: 'POST',
    body: fd4,
  });
  print('upload disallowed extension rejected', upExe.status === 400);

  // list documents (processing until worker consumes the job)
  // NOTE: query procedures with input are called with GET + `input` JSON
  // param (plain POST bodies resolve to mutations in tRPC v10)
  const docs = await fetchJson(
    `/trpc/document.listByWorkspace?input=${encodeURIComponent(JSON.stringify({ workspaceId }))}`,
    { method: 'GET' },
  );
  const docsData = docs.body?.result?.data;
  print(
    'document.listByWorkspace',
    Array.isArray(docsData) && docsData.length === 1,
  );

  // wait for worker to embed -> 'ready' (with key) or 'failed' (without)
  let finalStatus: string | undefined;
  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    const d = await fetchJson(
      `/trpc/document.listByWorkspace?input=${encodeURIComponent(JSON.stringify({ workspaceId }))}`,
      { method: 'GET' },
    );
    finalStatus = d.body?.result?.data?.[0]?.status;
    if (finalStatus && finalStatus !== 'processing') break;
  }
  print(
    'worker indexes document (ready) or fails without API key (failed)',
    finalStatus === 'ready' || finalStatus === 'failed',
    { finalStatus },
  );

  // retry mutation on failed doc
  if (finalStatus === 'failed') {
    const docId = docsData?.[0]?.id;
    const retry = await fetchJson('/trpc/document.retry', {
      method: 'POST',
      body: JSON.stringify({ documentId: docId }),
    });
    print('document.retry', retry.body?.result?.data?.status === 'processing');
  }

  // delete document
  const docId = docsData?.[0]?.id;
  const del = await fetchJson('/trpc/document.remove', {
    method: 'POST',
    body: JSON.stringify({ documentId: docId }),
  });
  print('document.remove', del.body?.result?.data?.deleted === true);

  // missing document -> NOT_FOUND
  const delMissing = await fetchJson('/trpc/document.remove', {
    method: 'POST',
    body: JSON.stringify({
      documentId: '00000000-0000-4000-8000-000000000000',
    }),
  });
  print(
    'document.remove missing document rejected',
    delMissing.body?.error?.data?.code === 'NOT_FOUND',
  );

  // --- conversation persistence ---------------------------------------
  // The streaming path persists via WebSocket, so seed a conversation
  // directly to exercise list/messages/delete over HTTP.
  const conversationId = await seedConversation(workspaceId);
  const convs = await fetchJson(
    `/trpc/chat.listByWorkspace?input=${encodeURIComponent(JSON.stringify({ workspaceId }))}`,
    { method: 'GET' },
  );
  const seeded = (convs.body?.result?.data ?? []).find(
    (c: any) => c.id === conversationId,
  );
  print(
    'chat.listByWorkspace shows persisted conversation',
    !!seeded && seeded.messageCount === 2,
    { title: seeded?.title, messageCount: seeded?.messageCount },
  );

  const msgs = await fetchJson(
    `/trpc/chat.messages?input=${encodeURIComponent(JSON.stringify({ conversationId }))}`,
    { method: 'GET' },
  );
  const msgsData = msgs.body?.result?.data;
  print(
    'chat.messages returns persisted history',
    Array.isArray(msgsData) &&
      msgsData.length === 2 &&
      msgsData[0].role === 'user' &&
      Array.isArray(msgsData[1].sources) &&
      msgsData[1].sources.length === 1,
    {
      roles: Array.isArray(msgsData) ? msgsData.map((m: any) => m.role) : null,
    },
  );

  const bogusConvo = await fetchJson(
    `/trpc/chat.messages?input=${encodeURIComponent(
      JSON.stringify({
        conversationId: '00000000-0000-4000-8000-000000000000',
      }),
    )}`,
    { method: 'GET' },
  );
  print(
    'chat.messages missing conversation',
    bogusConvo.body?.error?.data?.code === 'NOT_FOUND',
  );

  const convoDel = await fetchJson('/trpc/chat.delete', {
    method: 'POST',
    body: JSON.stringify({ conversationId }),
  });
  print('chat.delete', convoDel.body?.result?.data?.deleted === true);

  const convoDelBogus = await fetchJson('/trpc/chat.delete', {
    method: 'POST',
    body: JSON.stringify({
      conversationId: '00000000-0000-4000-8000-000000000000',
    }),
  });
  print(
    'chat.delete missing conversation',
    convoDelBogus.body?.error?.data?.code === 'NOT_FOUND',
  );

  // delete workspace
  const wsDel = await fetchJson('/trpc/workspace.delete', {
    method: 'POST',
    body: JSON.stringify({ workspaceId }),
  });
  print('workspace.delete', wsDel.body?.result?.data?.deleted === true);

  // conversations of the deleted workspace -> NOT_FOUND
  const convsGone = await fetchJson(
    `/trpc/chat.listByWorkspace?input=${encodeURIComponent(JSON.stringify({ workspaceId }))}`,
    { method: 'GET' },
  );
  print(
    'chat.listByWorkspace on deleted workspace',
    convsGone.body?.error?.data?.code === 'NOT_FOUND',
  );

  // chat subscriptions only work over WebSocket; over HTTP tRPC v11 responds
  // with an SSE stream carrying a serialized METHOD_NOT_SUPPORTED error
  const chat = await fetch(`${BASE}/trpc/chat.stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workspaceId, message: 'hi', history: [] }),
  });
  const chatBody = await chat.text();
  const sseMethodNotSupported =
    chatBody.includes('METHOD_NOT_SUPPORTED') &&
    chatBody.includes('"httpStatus":405');
  print('chat.stream not callable over http', sseMethodNotSupported);
  print('chat.stream is websocket-only', sseMethodNotSupported);

  // --- hybrid search SQL verification (no OpenAI key required) -----------
  const seedResult = await seedChunksAndQuery();
  print('hybrid retrieval sql', seedResult.ok, seedResult.detail);
  print('hybrid retrieval ranking', seedResult.ranking, seedResult.detail);
  print(
    'hybrid retrieval fts fallback',
    seedResult.fallback,
    seedResult.detail,
  );

  // -------------------------------------------------------------------
  // Authentication mode: a second API instance with AUTH_PASSWORD set
  // -------------------------------------------------------------------
  const AUTH_PORT = 3102;
  const AUTH_BASE = `http://localhost:${AUTH_PORT}`;
  const authChild = spawn('pnpm', ['exec', 'tsx', 'src/index.ts'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(AUTH_PORT),
      AUTH_PASSWORD: 'smoke-secret',
      LOCAL_USER_EMAIL: 'local@nexus.dev',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  authChild.stderr.on('data', (d) => (stdout += d.toString()));

  let authHealthy = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${AUTH_BASE}/healthz`);
      if (res.ok) {
        authHealthy = true;
        break;
      }
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  print('auth api healthz', authHealthy);

  // unauthenticated requests are rejected everywhere
  const meAnon = await fetch(`${AUTH_BASE}/api/auth/me`);
  print('auth /me without cookie -> 401', meAnon.status === 401);

  const trpcAnon = await fetchJsonAuth(AUTH_BASE, '/trpc/workspace.list', {
    method: 'GET',
  });
  print(
    'auth trpc without cookie -> UNAUTHORIZED',
    trpcAnon.body?.error?.data?.code === 'UNAUTHORIZED',
  );

  // wrong password is rejected (rate limit is 10/15min - 1 attempt is fine)
  const badLogin = await fetch(`${AUTH_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'local@nexus.dev', password: 'wrong' }),
  });
  print('auth login wrong password -> 401', badLogin.status === 401);

  // correct credentials -> session cookie
  const loginRes = await fetch(`${AUTH_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'local@nexus.dev',
      password: 'smoke-secret',
    }),
  });
  const setCookie = loginRes.headers.get('set-cookie') ?? '';
  const cookie = setCookie.split(';')[0];
  print(
    'auth login success + httpOnly cookie',
    loginRes.status === 200 &&
      cookie.startsWith('nexus_session=') &&
      setCookie.toLowerCase().includes('httponly'),
  );

  const meAuthed = await fetch(`${AUTH_BASE}/api/auth/me`, {
    headers: { cookie },
  });
  print(
    'auth /me with cookie -> user',
    meAuthed.status === 200 &&
      ((await meAuthed.json()) as { user?: { email?: string } }).user?.email ===
        'local@nexus.dev',
  );

  // authenticated upload works, anonymous upload is rejected
  const wsAuth = await fetchJsonAuth(AUTH_BASE, '/trpc/workspace.create', {
    method: 'POST',
    headers: { cookie },
    body: JSON.stringify({ name: 'Auth Workspace' }),
  });
  const authWsId = wsAuth.body?.result?.data?.id;
  print('auth workspace.create with cookie', !!authWsId);

  const fdAuth = new FormData();
  fdAuth.append('workspaceId', authWsId);
  fdAuth.append(
    'file',
    new File(['auth test'], 'auth.txt', { type: 'text/plain' }),
  );
  const upAnon = await fetch(`${AUTH_BASE}/api/upload`, {
    method: 'POST',
    body: fdAuth,
  });
  print('auth upload without cookie -> 401', upAnon.status === 401);

  const fdAuth2 = new FormData();
  fdAuth2.append('workspaceId', authWsId);
  fdAuth2.append(
    'file',
    new File(['auth test'], 'auth.txt', { type: 'text/plain' }),
  );
  const upAuthed = await fetch(`${AUTH_BASE}/api/upload`, {
    method: 'POST',
    headers: { cookie },
    body: fdAuth2,
  });
  print('auth upload with cookie -> 201', upAuthed.status === 201);

  // logout invalidates the session
  const logoutRes = await fetch(`${AUTH_BASE}/api/auth/logout`, {
    method: 'POST',
    headers: { cookie },
  });
  const meAfterLogout = await fetch(`${AUTH_BASE}/api/auth/me`, {
    headers: { cookie },
  });
  print(
    'auth logout invalidates session',
    logoutRes.status === 200 && meAfterLogout.status === 401,
  );

  authChild.kill('SIGTERM');
} catch (e) {
  console.error('SMOKE ERROR:', (e as Error).message);
  ok = false;
}

child.kill('SIGTERM');
worker.kill('SIGTERM');
await sleep(1200);
if (stdout)
  console.log(
    '\n--- server log (tail) ---\n' + stdout.split('\n').slice(-8).join('\n'),
  );
process.exit(ok ? 0 : 1);

async function seedConversation(workspaceId: string): Promise<string> {
  const pg = await import('pg');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query(
      `INSERT INTO conversations (workspace_id, title) VALUES ($1, 'seed-conversation') RETURNING id`,
      [workspaceId],
    );
    const conversationId = result.rows[0].id;
    await client.query(
      `INSERT INTO messages (conversation_id, role, content, sources, created_at) VALUES
       ($1, 'user', 'hello nexus', NULL::jsonb, now() - interval '1 second'),
       ($1, 'assistant', 'hi there', $2::jsonb, now())`,
      [
        conversationId,
        JSON.stringify([
          {
            id: '11111111-1111-4111-8111-111111111111',
            documentId: '22222222-2222-4222-8222-222222222222',
            title: 'about-nexus.txt',
            content: 'Nexus is a RAG system',
            page: 1,
            similarity: 0.87,
          },
        ]),
      ],
    );
    return conversationId;
  } finally {
    await client.end();
  }
}

async function seedChunksAndQuery() {
  const pg = await import('pg');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // own workspace + user so the seed is independent of the API test flow
    const userId = await client.query(
      `SELECT id FROM users ORDER BY created_at LIMIT 1`,
    );
    const ws = await client.query(
      `INSERT INTO workspaces (user_id, name) VALUES ($1, 'seed-workspace') RETURNING id`,
      [userId.rows[0].id],
    );
    const seedWorkspaceId = ws.rows[0].id;

    // seed document + 3 chunks with fake 1536-dim embeddings
    const doc = await client.query(
      `INSERT INTO documents (workspace_id, title, file_path, file_type, status)
       VALUES ($1, 'hybrid-test.txt', 'seed/hybrid-test.txt', 'txt', 'ready')
       RETURNING id`,
      [seedWorkspaceId],
    );
    const docId = doc.rows[0].id;
    const mk = (v: number) =>
      `[${Array.from({ length: 1536 }, () => v).join(',')}]`;
    await client.query(
      `INSERT INTO chunks (document_id, content, embedding, metadata) VALUES
       ($1, 'Hybrid retrieval in Nexus combines postgres full text search with a vector similarity search', $2::vector, '{"page":1,"chunkIndex":0}'),
       ($1, 'The capital of Mars is a city called Olympus Mons Research Station', $3::vector, '{"page":1,"chunkIndex":1}'),
       ($1, 'Embeddings and vectors are generated asynchronously by a BullMQ worker queue', $4::vector, '{"page":1,"chunkIndex":2}')`,
      [docId, mk(0.1), mk(0.9), mk(0.2)],
    );

    // FTS + vector combined query (same SQL as llm.service hybridRetrieveChunks)
    const vectorLiteral = mk(0.11);
    const res = await client.query(
      `SELECT c.content,
              (1 - (c.embedding <=> $1::vector)) AS similarity,
              ts_rank(to_tsvector('english', c.content), plainto_tsquery('english', $2)) AS keyword_rank
       FROM chunks c
       JOIN documents d ON d.id = c.document_id
       WHERE d.workspace_id = $3
         AND to_tsvector('english', c.content) @@ plainto_tsquery('english', $2)
       ORDER BY ((1 - (c.embedding <=> $1::vector)) * 0.6 + ts_rank(to_tsvector('english', c.content), plainto_tsquery('english', $2)) * 0.4) DESC
       LIMIT 6`,
      [vectorLiteral, 'vector', seedWorkspaceId],
    );
    const contents = res.rows.map((r: any) => r.content.slice(0, 40));
    const ok = res.rows.length >= 2;

    // ranking sanity: FTS prefiltering keeps only keyword matches (no Mars)
    const orderOk =
      res.rows.length >= 2 &&
      res.rows.every((r: any) => !r.content.toString().includes('Mars'));

    // pure vector fallback when FTS matches nothing
    const fallback = await client.query(
      `SELECT c.content, (1 - (c.embedding <=> $1::vector)) AS similarity
       FROM chunks c
       JOIN documents d ON d.id = c.document_id
       WHERE d.workspace_id = $2
       ORDER BY (1 - (c.embedding <=> $1::vector)) DESC
       LIMIT 6`,
      [mk(0.91), seedWorkspaceId],
    );
    const fallbackOk =
      fallback.rows.length === 3 &&
      fallback.rows[0].content.includes('capital of Mars');

    await client.query(`DELETE FROM workspaces WHERE id = $1`, [
      seedWorkspaceId,
    ]);
    return {
      ok,
      ranking: orderOk,
      fallback: fallbackOk,
      detail: { top3: contents, similarity: res.rows[0]?.similarity ?? null },
    };
  } finally {
    await client.end();
  }
}
