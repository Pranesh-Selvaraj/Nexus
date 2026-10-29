import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { createHmac } from 'node:crypto';
import JSZip from 'jszip';

import '../src/utils/env.js';
import {
  buildEpub,
  TINY_PNG,
  zipBuffer,
} from '../src/services/ingestion/fixtures.test-utils.js';

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
  // FormData must keep the runtime-generated multipart boundary; only JSON
  // bodies get the JSON content type.
  const isForm = init?.body instanceof FormData;
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...(isForm ? {} : { 'content-type': 'application/json' }),
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function print(name: string, result: boolean, detail?: unknown) {
  if (!result) ok = false;
  console.log(
    `${result ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${JSON.stringify(detail).slice(0, 220)}` : ''}`,
  );
}

const child = spawn('pnpm', ['exec', 'tsx', 'src/index.ts'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: {
    ...process.env,
    PORT: String(API_PORT),
    WS_PATH: '/ws',
    // Deterministic settings key: webhooks and stored provider keys need to
    // encrypt at rest on this instance. The "no key configured" behaviour is
    // asserted separately on the auth-mode instance below, which has none.
    SETTINGS_SECRET: 'smoke-settings-secret',
    // The webhook checks deliver to a receiver this script runs on 127.0.0.1;
    // the strict private-target refusal is unit-tested on its own.
    WEBHOOK_ALLOW_PRIVATE_HOSTS: 'true',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const worker = spawn(
  'pnpm',
  ['exec', 'tsx', 'src/workers/embedding.worker.ts'],
  {
    cwd: new URL('..', import.meta.url).pathname,
    // Same settings key and local-target override as the API: deliveries are
    // signed (decrypt the stored secret) and re-validated in the worker.
    env: {
      ...process.env,
      SETTINGS_SECRET: 'smoke-settings-secret',
      WEBHOOK_ALLOW_PRIVATE_HOSTS: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

let stdout = '';
child.stdout.on('data', (d) => (stdout += d.toString()));
child.stderr.on('data', (d) => (stdout += d.toString()));
worker.stderr.on('data', (d) => (stdout += d.toString()));

let ok = true;
try {
  // --- webhook receiver (P-5) -----------------------------------------
  // A tiny local endpoint that records every signed delivery.
  const hookHits: Array<{
    headers: Record<string, string | string[] | undefined>;
    body: string;
  }> = [];
  const webhookServer: Server = createServer((req, res) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      hookHits.push({ headers: req.headers, body: data });
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
  });
  await new Promise<void>((resolve) =>
    webhookServer.listen(0, '127.0.0.1', () => resolve()),
  );
  const hookPort = (webhookServer.address() as { port: number }).port;
  const hookUrl = `http://127.0.0.1:${hookPort}/hook`;

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
  // SMOKE_EXPECT_READY=1 (CI, with the mock OpenAI stub) requires the full
  // indexing pipeline to succeed: upload -> chunk -> embed -> store.
  const expectReady = process.env.SMOKE_EXPECT_READY === '1';
  print(
    expectReady
      ? 'worker indexes document to ready'
      : 'worker indexes document (ready) or fails without API key (failed)',
    expectReady
      ? finalStatus === 'ready'
      : finalStatus === 'ready' || finalStatus === 'failed',
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

  // soft delete: the document moves to trash, disappears from the library and
  // can be restored (which re-queues indexing)
  const trashedList = await fetchJson(
    `/trpc/document.listTrashed?input=${encodeURIComponent(JSON.stringify({ workspaceId }))}`,
    { method: 'GET' },
  );
  print(
    'document.remove moves the document to trash',
    (trashedList.body?.result?.data ?? []).some((d: any) => d.id === docId),
  );
  const afterDelete = await fetchJson(
    `/trpc/document.listByWorkspace?input=${encodeURIComponent(JSON.stringify({ workspaceId }))}`,
    { method: 'GET' },
  );
  print(
    'trashed documents are hidden from the library',
    !(afterDelete.body?.result?.data ?? []).some((d: any) => d.id === docId),
  );
  const restored = await fetchJson('/trpc/document.restore', {
    method: 'POST',
    body: JSON.stringify({ documentId: docId }),
  });
  print(
    'document.restore re-queues the document',
    restored.body?.result?.data?.restored === true,
  );
  const restoredList = await fetchJson(
    `/trpc/document.listByWorkspace?input=${encodeURIComponent(JSON.stringify({ workspaceId }))}`,
    { method: 'GET' },
  );
  print(
    'restored documents return to the library',
    (restoredList.body?.result?.data ?? []).some((d: any) => d.id === docId),
  );

  // storage accounting (P-6)
  const usage = await fetchJson('/trpc/storage.usage', { method: 'GET' });
  print(
    'storage.usage reports bytes, documents and quota',
    typeof usage.body?.result?.data?.usedBytes === 'number' &&
      typeof usage.body?.result?.data?.quotaBytes === 'number' &&
      Array.isArray(usage.body?.result?.data?.byWorkspace),
    {
      used: usage.body?.result?.data?.usedBytes,
      quota: usage.body?.result?.data?.quotaBytes,
    },
  );

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

  // --- hybrid retrieval verification (real service, mock embeddings) ----
  const seedResult = await seedChunksAndQuery();
  print(
    'hybrid retrieval returns fused sources',
    seedResult.ok,
    seedResult.detail,
  );
  print(
    'hybrid retrieval keeps semantic-only matches (B-2)',
    seedResult.semanticKept,
    seedResult.detail,
  );
  print(
    'hybrid retrieval vector arm works without keyword matches',
    seedResult.vectorFallback,
    seedResult.detail,
  );

  // --- settings router -------------------------------------------------
  // Start from a clean slate: wipe the table directly via SQL so stale
  // encrypted rows (written under a different SETTINGS_SECRET) can't break
  // settings.list or leak into assertions.
  {
    const pg = await import('pg');
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await client.connect();
    await client.query('DELETE FROM settings');
    await client.end();
  }

  const settingsDefsList = await fetchJson('/trpc/settings.list', {
    method: 'GET',
  });
  const settingDefs = settingsDefsList.body?.result?.data;
  print(
    'settings.list returns registry defs',
    Array.isArray(settingDefs) && settingDefs.length >= 12,
    { count: settingDefs?.length },
  );

  // update model -> ui source; empty -> reset to default
  const setModel = await fetchJson('/trpc/settings.update', {
    method: 'POST',
    body: JSON.stringify({ key: 'openai.model', value: 'gpt-4.1-mini' }),
  });
  print(
    'settings.update model',
    setModel.body?.result?.data?.source === 'ui' &&
      setModel.body?.result?.data?.value === 'gpt-4.1-mini',
  );
  const resetModel = await fetchJson('/trpc/settings.update', {
    method: 'POST',
    body: JSON.stringify({ key: 'openai.model', value: '' }),
  });
  print(
    'settings.update empty resets to default',
    resetModel.body?.result?.data?.value === 'gpt-4o-mini' &&
      resetModel.body?.result?.data?.source === 'env',
  );

  // number settings are clamped to their bounds
  const clampTopK = await fetchJson('/trpc/settings.update', {
    method: 'POST',
    body: JSON.stringify({ key: 'rag.topK', value: '999' }),
  });
  print(
    'settings.update clamps numbers',
    clampTopK.body?.result?.data?.value === '20',
  );
  await fetchJson('/trpc/settings.update', {
    method: 'POST',
    body: JSON.stringify({ key: 'rag.topK', value: '' }),
  });

  // unknown keys and invalid values are rejected
  const unknownKey = await fetchJson('/trpc/settings.update', {
    method: 'POST',
    body: JSON.stringify({ key: 'nope.missing', value: 'x' }),
  });
  print(
    'settings.update unknown key rejected',
    unknownKey.body?.error?.data?.code === 'NOT_FOUND',
  );

  // full endpoint URLs (e.g. pasted /chat/completions) are rejected with
  // the corrected base URL - Nexus appends the API paths itself
  const badBaseUrl = await fetchJson('/trpc/settings.update', {
    method: 'POST',
    body: JSON.stringify({
      key: 'openai.baseUrl',
      value: 'http://localhost:3310/v1/chat/completions',
    }),
  });
  print(
    'settings.update rejects full endpoint URL',
    badBaseUrl.body?.error?.data?.code === 'BAD_REQUEST' &&
      String(badBaseUrl.body?.error?.message).includes(
        'http://localhost:3310/v1',
      ),
  );
  const badNumber = await fetchJson('/trpc/settings.update', {
    method: 'POST',
    body: JSON.stringify({ key: 'rag.topK', value: 'abc' }),
  });
  print(
    'settings.update non-numeric rejected',
    badNumber.body?.error?.data?.code === 'BAD_REQUEST',
  );

  // select settings reject invalid options; embedding.dimensions accepted
  const badLang = await fetchJson('/trpc/settings.update', {
    method: 'POST',
    body: JSON.stringify({ key: 'retrieval.language', value: 'klingon' }),
  });
  print(
    'settings.update invalid select option rejected',
    badLang.body?.error?.data?.code === 'BAD_REQUEST',
  );
  // embedding.dimensions accepts arbitrary values (matching whatever the
  // embedding model outputs, e.g. 2560 for qwen3-embedding:4b)
  const dims = await fetchJson('/trpc/settings.update', {
    method: 'POST',
    body: JSON.stringify({ key: 'embedding.dimensions', value: '2560' }),
  });
  print(
    'settings.update embedding.dimensions',
    dims.body?.result?.data?.value === '2560',
  );
  await fetchJson('/trpc/settings.update', {
    method: 'POST',
    body: JSON.stringify({ key: 'embedding.dimensions', value: '' }),
  });

  // model discovery reports a clear error when the provider is unreachable
  const listModels = await fetchJson('/trpc/settings.listModels', {
    method: 'POST',
  });
  print(
    'settings.listModels returns models or clear error',
    Array.isArray(listModels.body?.result?.data?.models) &&
      (listModels.body?.result?.data?.error === null ||
        String(listModels.body?.result?.data?.error).length > 0),
  );

  // embedding models are discovered from the (possibly separate) embedding
  // provider, falling back to the main provider
  const listEmbModels = await fetchJson('/trpc/settings.listEmbeddingModels', {
    method: 'POST',
  });
  print(
    'settings.listEmbeddingModels returns models or clear error',
    Array.isArray(listEmbModels.body?.result?.data?.models) &&
      (listEmbModels.body?.result?.data?.error === null ||
        String(listEmbModels.body?.result?.data?.error).length > 0),
  );

  // the separate embedding base URL persists like any non-secret setting
  const setEmbBase = await fetchJson('/trpc/settings.update', {
    method: 'POST',
    body: JSON.stringify({
      key: 'openai.embeddingBaseUrl',
      value: 'http://localhost:3310/v1',
    }),
  });
  print(
    'settings.update embedding base URL',
    setEmbBase.body?.result?.data?.value === 'http://localhost:3310/v1' &&
      setEmbBase.body?.result?.data?.source === 'ui',
  );
  await fetchJson('/trpc/settings.update', {
    method: 'POST',
    body: JSON.stringify({ key: 'openai.embeddingBaseUrl', value: '' }),
  });

  // connection test targets the configured provider: with the mock
  // (OPENAI_BASE_URL set) it verifies chat + embeddings end to end;
  // without any provider configured (placeholder key, no base URL) it
  // fails with a clear, actionable message.
  const realKey =
    Boolean(process.env.OPENAI_API_KEY) &&
    process.env.OPENAI_API_KEY !== 'sk-your-key-here';
  const providerConfigured = Boolean(process.env.OPENAI_BASE_URL) || realKey;
  const testConn = await fetchJson('/trpc/settings.testOpenAI', {
    method: 'POST',
  });
  const testConnData = testConn.body?.result?.data;
  print(
    'settings.testOpenAI verifies the configured provider',
    testConnData?.ok === providerConfigured &&
      String(testConnData?.message).length > 10,
    { ok: testConnData?.ok, message: testConnData?.message },
  );

  // -------------------------------------------------------------------
  // settings.updateMany: cross-field validation in one batch
  // -------------------------------------------------------------------
  const invalidPair = await fetchJson('/trpc/settings.updateMany', {
    method: 'POST',
    body: JSON.stringify({
      values: { 'rag.chunkSize': '200', 'rag.chunkOverlap': '300' },
    }),
  });
  print(
    'settings.updateMany rejects invalid chunk pair',
    invalidPair.body?.error?.data?.code === 'BAD_REQUEST' &&
      String(invalidPair.body?.error?.message).includes('Chunk overlap'),
  );

  const validPair = await fetchJson('/trpc/settings.updateMany', {
    method: 'POST',
    body: JSON.stringify({
      values: { 'rag.chunkSize': '900', 'rag.chunkOverlap': '100' },
    }),
  });
  print(
    'settings.updateMany applies a valid batch',
    Array.isArray(validPair.body?.result?.data) &&
      validPair.body.result.data.some(
        (s: any) => s.key === 'rag.chunkSize' && s.value === '900',
      ),
  );
  await fetchJson('/trpc/settings.updateMany', {
    method: 'POST',
    body: JSON.stringify({
      values: { 'rag.chunkSize': '', 'rag.chunkOverlap': '' },
    }),
  });

  // -------------------------------------------------------------------
  // Embedding provenance: status + bulk re-index
  // -------------------------------------------------------------------
  const reindexSeed = await seedReindexScenario();
  const retrievalStatus = await fetchJson(
    `/trpc/document.retrievalStatus?input=${encodeURIComponent(JSON.stringify({ workspaceId: reindexSeed.workspaceId }))}`,
    { method: 'GET' },
  );
  print(
    'retrievalStatus reports the active model + stale documents',
    retrievalStatus.body?.result?.data?.documentsNeedingReindex === 1 &&
      retrievalStatus.body?.result?.data?.totalDocuments === 1 &&
      typeof retrievalStatus.body?.result?.data?.currentModel === 'string',
    retrievalStatus.body?.result?.data,
  );
  const reindex = await fetchJson('/trpc/document.reindexAll', {
    method: 'POST',
    body: JSON.stringify({ workspaceId: reindexSeed.workspaceId }),
  });
  print(
    'document.reindexAll queues stale documents',
    reindex.body?.result?.data?.queued === 1,
    reindex.body?.result?.data,
  );
  await fetchJson('/trpc/workspace.delete', {
    method: 'POST',
    body: JSON.stringify({ workspaceId: reindexSeed.workspaceId }),
  });

  // -------------------------------------------------------------------
  // Message feedback
  // -------------------------------------------------------------------
  const feedbackSeed = await seedFeedbackScenario();
  const feedbackSaved = await fetchJson('/trpc/chat.feedback', {
    method: 'POST',
    body: JSON.stringify({
      messageId: feedbackSeed.messageId,
      feedback: 'up',
    }),
  });
  print(
    'chat.feedback persists a rating',
    feedbackSaved.body?.result?.data?.saved === true,
  );
  const feedbackRead = await fetchJson(
    `/trpc/chat.messages?input=${encodeURIComponent(JSON.stringify({ conversationId: feedbackSeed.conversationId }))}`,
    { method: 'GET' },
  );
  print(
    'chat.messages returns the stored feedback',
    feedbackRead.body?.result?.data?.[0]?.feedback === 'up',
  );
  await fetchJson('/trpc/workspace.delete', {
    method: 'POST',
    body: JSON.stringify({ workspaceId: feedbackSeed.workspaceId }),
  });

  // -------------------------------------------------------------------
  // Study loop: decks, flashcard generation, review, progress, notes
  // -------------------------------------------------------------------
  const studyWs = await fetchJson('/trpc/workspace.create', {
    method: 'POST',
    body: JSON.stringify({ name: 'Study Smoke' }),
  });
  const studyWsId = studyWs.body?.result?.data?.id;
  print('study smoke workspace', Boolean(studyWsId));

  const generated = await fetchJson('/trpc/study.cards.generate', {
    method: 'POST',
    body: JSON.stringify({
      workspaceId: studyWsId,
      text: 'Nexus combines vector similarity with keyword search and schedules cards with FSRS.',
      count: 5,
    }),
  });
  const createdCards = generated.body?.result?.data?.created ?? [];
  print(
    'study.cards.generate creates cards',
    createdCards.length === 3 &&
      typeof createdCards[0]?.front === 'string' &&
      typeof createdCards[0]?.back === 'string',
    { count: createdCards.length },
  );

  const deckList = await fetchJson(
    `/trpc/study.decks.list?input=${encodeURIComponent(JSON.stringify({ workspaceId: studyWsId }))}`,
    { method: 'GET' },
  );
  const firstDeck = deckList.body?.result?.data?.[0];
  print(
    'study.decks.list reports due cards',
    firstDeck?.cardCount === 3 && firstDeck?.dueCount === 3,
    { deck: firstDeck?.name, cards: firstDeck?.cardCount },
  );

  const dueCards = await fetchJson(
    `/trpc/study.cards.due?input=${encodeURIComponent(JSON.stringify({ workspaceId: studyWsId }))}`,
    { method: 'GET' },
  );
  const dueList = dueCards.body?.result?.data ?? [];
  print(
    'study.cards.due returns interval previews',
    dueList.length === 3 && typeof dueList[0]?.intervals?.good === 'string',
    { intervals: dueList[0]?.intervals },
  );

  const reviewed = await fetchJson('/trpc/study.cards.review', {
    method: 'POST',
    body: JSON.stringify({ cardId: createdCards[0]?.id, rating: 'good' }),
  });
  print(
    'study.cards.review schedules the next due date',
    reviewed.body?.result?.data?.remaining === 2 &&
      typeof reviewed.body?.result?.data?.nextDueAt === 'string' &&
      new Date(reviewed.body.result.data.nextDueAt).getTime() > Date.now(),
    reviewed.body?.result?.data,
  );

  const progress = await fetchJson(
    `/trpc/study.progress?input=${encodeURIComponent(JSON.stringify({ workspaceId: studyWsId }))}`,
    { method: 'GET' },
  );
  print(
    'study.progress aggregates reviews',
    progress.body?.result?.data?.totalCards === 3 &&
      progress.body?.result?.data?.reviewsToday === 1 &&
      progress.body?.result?.data?.streakDays === 1,
    progress.body?.result?.data,
  );

  const exportCsv = await fetchJson(
    `/trpc/study.cards.exportCsv?input=${encodeURIComponent(JSON.stringify({ workspaceId: studyWsId }))}`,
    { method: 'GET' },
  );
  print(
    'study.cards.exportCsv produces an Anki-importable CSV',
    typeof exportCsv.body?.result?.data?.csv === 'string' &&
      exportCsv.body.result.data.csv.startsWith('front,back'),
  );

  const createdNote = await fetchJson('/trpc/notes.notes.create', {
    method: 'POST',
    body: JSON.stringify({
      workspaceId: studyWsId,
      title: 'Smoke note',
      contentMd: 'hello',
      tags: ['smoke'],
    }),
  });
  print(
    'notes.notes.create stores a note',
    createdNote.body?.result?.data?.title === 'Smoke note' &&
      createdNote.body?.result?.data?.tags?.[0] === 'smoke',
  );

  const createdHighlight = await fetchJson('/trpc/notes.highlights.create', {
    method: 'POST',
    body: JSON.stringify({
      workspaceId: studyWsId,
      quotedText: 'quoted passage',
      note: 'remember this',
    }),
  });
  print(
    'notes.highlights.create stores a highlight',
    createdHighlight.body?.result?.data?.quotedText === 'quoted passage' &&
      createdHighlight.body?.result?.data?.note === 'remember this',
  );

  const notesList = await fetchJson(
    `/trpc/notes.notes.list?input=${encodeURIComponent(JSON.stringify({ workspaceId: studyWsId }))}`,
    { method: 'GET' },
  );
  const highlightsList = await fetchJson(
    `/trpc/notes.highlights.list?input=${encodeURIComponent(JSON.stringify({ workspaceId: studyWsId }))}`,
    { method: 'GET' },
  );
  print(
    'notes lists return stored notes + highlights',
    notesList.body?.result?.data?.length === 1 &&
      highlightsList.body?.result?.data?.length === 1,
  );

  await fetchJson('/trpc/workspace.delete', {
    method: 'POST',
    body: JSON.stringify({ workspaceId: studyWsId }),
  });

  // -------------------------------------------------------------------
  // Phase 2b: personas, quizzes and studio artifacts
  // -------------------------------------------------------------------
  const lateWs = await fetchJson('/trpc/workspace.create', {
    method: 'POST',
    body: JSON.stringify({ name: 'Study Smoke 2' }),
  });
  const lateWsId = lateWs.body?.result?.data?.id;

  const personas = await fetchJson('/trpc/chat.personas', { method: 'GET' });
  const personaList = personas.body?.result?.data ?? [];
  print(
    'chat.personas lists personas with a default',
    personaList.length >= 6 &&
      personaList.filter((p: any) => p.isDefault).length === 1 &&
      personaList.every(
        (p: any) => typeof p.id === 'string' && typeof p.label === 'string',
      ),
    {
      count: personaList.length,
      default: personaList.find((p: any) => p.isDefault)?.id,
    },
  );

  const quizGenerated = await fetchJson('/trpc/quiz.generate', {
    method: 'POST',
    body: JSON.stringify({
      workspaceId: lateWsId,
      text: 'Nexus combines vector similarity with keyword search and schedules flashcards with FSRS.',
      count: 5,
      kinds: ['mcq', 'truefalse', 'short'],
    }),
  });
  const quizId = quizGenerated.body?.result?.data?.id;
  print(
    'quiz.generate creates a quiz',
    Boolean(quizId) && quizGenerated.body?.result?.data?.questionCount === 3,
    { questionCount: quizGenerated.body?.result?.data?.questionCount },
  );

  const quizDetail = await fetchJson(
    `/trpc/quiz.get?input=${encodeURIComponent(JSON.stringify({ quizId }))}`,
    { method: 'GET' },
  );
  const questions = quizDetail.body?.result?.data?.questions ?? [];
  print(
    'quiz.get never returns stored answers',
    questions.length === 3 &&
      questions.every((q: any) => q.answer === undefined) &&
      questions.some((q: any) => q.kind === 'mcq' && Array.isArray(q.options)),
    { kinds: questions.map((q: any) => q.kind) },
  );

  const correctAnswers = questions.map((question: any) => {
    if (question.kind === 'mcq') {
      return {
        questionId: question.id,
        answer: 'Vector similarity and keyword search',
      };
    }
    if (question.kind === 'truefalse') {
      return { questionId: question.id, answer: 'true' };
    }
    return { questionId: question.id, answer: 'flashcard reviews' };
  });

  const perfectAttempt = await fetchJson('/trpc/quiz.submit', {
    method: 'POST',
    body: JSON.stringify({ quizId, answers: correctAnswers }),
  });
  print(
    'quiz.submit grades a perfect attempt',
    perfectAttempt.body?.result?.data?.score === 1 &&
      perfectAttempt.body?.result?.data?.cardsCreated === 0,
    { score: perfectAttempt.body?.result?.data?.score },
  );

  const wrongAnswers = questions.map((question: any) => ({
    questionId: question.id,
    answer: question.kind === 'mcq' ? 'Only keyword search' : 'wrong',
  }));
  const failedAttempt = await fetchJson('/trpc/quiz.submit', {
    method: 'POST',
    body: JSON.stringify({ quizId, answers: wrongAnswers }),
  });
  const failedData = failedAttempt.body?.result?.data;
  print(
    'quiz.submit creates cards for the mistakes',
    failedData?.score === 1 / 3 &&
      failedData?.cardsCreated === 2 &&
      failedData?.results?.every(
        (r: any) => typeof r.correctAnswer === 'string',
      ),
    { score: failedData?.score, cardsCreated: failedData?.cardsCreated },
  );

  const artifact = await fetchJson('/trpc/artifacts.generate', {
    method: 'POST',
    body: JSON.stringify({
      workspaceId: lateWsId,
      text: 'Nexus combines vector similarity with keyword search and schedules flashcards with FSRS.',
      kind: 'summary',
    }),
  });
  print(
    'artifacts.generate stores an artifact',
    artifact.body?.result?.data?.kind === 'summary' &&
      String(artifact.body?.result?.data?.contentMd).length > 20,
  );

  const mindmap = await fetchJson('/trpc/artifacts.generate', {
    method: 'POST',
    body: JSON.stringify({
      workspaceId: lateWsId,
      text: 'Nexus combines vector similarity with keyword search and schedules flashcards with FSRS.',
      kind: 'mindmap',
    }),
  });
  print(
    'artifacts.generate produces a Mermaid mind map',
    String(mindmap.body?.result?.data?.contentMd).includes('mermaid'),
  );

  const artifactList = await fetchJson(
    `/trpc/artifacts.list?input=${encodeURIComponent(JSON.stringify({ workspaceId: lateWsId }))}`,
    { method: 'GET' },
  );
  print(
    'artifacts.list returns the gallery',
    artifactList.body?.result?.data?.length === 2,
  );
  const artifactId = artifact.body?.result?.data?.id;
  const artifactDeleted = await fetchJson('/trpc/artifacts.delete', {
    method: 'POST',
    body: JSON.stringify({ artifactId }),
  });
  print(
    'artifacts.delete removes an artifact',
    artifactDeleted.body?.result?.data?.deleted === true,
  );

  await fetchJson('/trpc/workspace.delete', {
    method: 'POST',
    body: JSON.stringify({ workspaceId: lateWsId }),
  });

  // -------------------------------------------------------------------
  // Phase 3: voice input, read-aloud, pronunciation and vocabulary
  // -------------------------------------------------------------------
  // STT/TTS only run against a local provider (the deterministic stub in CI)
  // so the suite never spends real provider credits or depends on audio
  // quality. A cloud run can opt in explicitly with SMOKE_VOICE=1.
  const voiceProvider =
    (process.env.OPENAI_BASE_URL ?? '').includes('localhost') ||
    process.env.SMOKE_VOICE === '1';

  const voiceWs = await fetchJson('/trpc/workspace.create', {
    method: 'POST',
    body: JSON.stringify({ name: 'Voice Smoke' }),
  });
  const voiceWsId = voiceWs.body?.result?.data?.id;

  const voiceConfig = await fetchJson('/trpc/voice.config', { method: 'GET' });
  const voiceConfigData = voiceConfig.body?.result?.data;
  print(
    'voice.config reports engines and defaults',
    typeof voiceConfigData?.sttMode === 'string' &&
      typeof voiceConfigData?.ttsProvider === 'string' &&
      Array.isArray(voiceConfigData?.voices) &&
      voiceConfigData.voices.includes('alloy'),
    {
      sttMode: voiceConfigData?.sttMode,
      ttsProvider: voiceConfigData?.ttsProvider,
      sttAvailable: voiceConfigData?.sttServerAvailable,
    },
  );

  if (voiceProvider) {
    // Dictation: multipart audio -> deterministic transcript.
    const transcribeFd = new FormData();
    transcribeFd.append('workspaceId', voiceWsId);
    transcribeFd.append(
      'audio',
      new File([new Uint8Array(2048)], 'clip.webm', { type: 'audio/webm' }),
    );
    const transcribeRes = await fetch(`${BASE}/api/transcribe`, {
      method: 'POST',
      body: transcribeFd,
    });
    const transcribeBody = (await transcribeRes.json()) as any;
    print(
      'POST /api/transcribe returns text',
      transcribeRes.status === 200 &&
        typeof transcribeBody?.text === 'string' &&
        transcribeBody.text.length > 0 &&
        typeof transcribeBody?.provider === 'string',
      { provider: transcribeBody?.provider, text: transcribeBody?.text },
    );

    // Read-aloud: server synthesis is cached by (text, voice, speed).
    const ttsFirst = await fetchJson('/api/tts', {
      method: 'POST',
      body: JSON.stringify({
        text: 'Nexus reads this answer aloud.',
        voice: 'alloy',
        speed: 1,
        workspaceId: voiceWsId,
      }),
    });
    const ttsData = ttsFirst.body;
    print(
      'POST /api/tts synthesizes and returns sentence units',
      ttsFirst.status === 200 &&
        typeof ttsData?.audioId === 'string' &&
        ttsData?.cached === false &&
        Array.isArray(ttsData?.sentences) &&
        ttsData.sentences.length === 1 &&
        ttsData?.url === `/api/audio/${ttsData.audioId}`,
      { audioId: ttsData?.audioId, sentences: ttsData?.sentences },
    );

    const ttsSecond = await fetchJson('/api/tts', {
      method: 'POST',
      body: JSON.stringify({
        text: 'Nexus reads this answer aloud.',
        voice: 'alloy',
        speed: 1,
        workspaceId: voiceWsId,
      }),
    });
    print(
      'POST /api/tts reuses the cached audio',
      ttsSecond.body?.cached === true &&
        ttsSecond.body?.audioId === ttsData?.audioId,
    );

    // Playback: full GET, then a byte range (what <audio> seeking uses).
    const audioId = ttsData?.audioId as string;
    const audioFull = await fetch(`${BASE}/api/audio/${audioId}`);
    const audioBytes = await audioFull.arrayBuffer();
    print(
      'GET /api/audio/:id streams cached audio',
      audioFull.status === 200 &&
        (audioFull.headers.get('content-type') ?? '').startsWith('audio/') &&
        audioBytes.byteLength > 0,
      {
        contentType: audioFull.headers.get('content-type'),
        bytes: audioBytes.byteLength,
      },
    );

    const audioRange = await fetch(`${BASE}/api/audio/${audioId}`, {
      headers: { Range: 'bytes=0-9' },
    });
    const rangeBody = await audioRange.arrayBuffer();
    print(
      'GET /api/audio/:id honours Range requests',
      audioRange.status === 206 &&
        (audioRange.headers.get('content-range') ?? '').startsWith(
          'bytes 0-9/',
        ) &&
        rangeBody.byteLength === 10,
      { contentRange: audioRange.headers.get('content-range') },
    );

    // Retention/quota bookkeeping is visible through the audio list.
    const audioList = await fetchJson(
      `/trpc/voice.audio.list?input=${encodeURIComponent(JSON.stringify({ workspaceId: voiceWsId }))}`,
      { method: 'GET' },
    );
    const listed = audioList.body?.result?.data ?? [];
    print(
      'voice.audio.list reports the cached asset',
      listed.some((asset: any) => asset.id === audioId && asset.kind === 'tts'),
      { count: listed.length },
    );

    // Vocabulary mining -> SRS card with translation and example.
    const mined = await fetchJson('/trpc/language.vocabulary.mine', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: voiceWsId,
        text: 'Hybrid retrieval fuses vector similarity with keyword search.',
        maxTerms: 5,
        createCards: true,
      }),
    });
    const mineData = mined.body?.result?.data;
    print(
      'language.vocabulary.mine creates vocabulary and cards',
      mined.status === 200 &&
        mineData?.items?.length > 0 &&
        mineData?.cardsCreated > 0 &&
        mineData.items.every(
          (item: any) =>
            typeof item.term === 'string' && item.state === 'learning',
        ),
      { items: mineData?.items?.length, cards: mineData?.cardsCreated },
    );

    const vocabList = await fetchJson(
      `/trpc/language.vocabulary.list?input=${encodeURIComponent(JSON.stringify({ workspaceId: voiceWsId }))}`,
      { method: 'GET' },
    );
    const firstVocab = vocabList.body?.result?.data?.[0];
    print(
      'language.vocabulary.list returns mined terms',
      Array.isArray(vocabList.body?.result?.data) &&
        vocabList.body.result.data.length > 0,
      { first: firstVocab?.term, translation: firstVocab?.translation },
    );

    if (firstVocab) {
      const updatedVocab = await fetchJson('/trpc/language.vocabulary.update', {
        method: 'POST',
        body: JSON.stringify({ vocabularyId: firstVocab.id, state: 'known' }),
      });
      print(
        'language.vocabulary.update changes state',
        updatedVocab.body?.result?.data?.state === 'known',
      );
    }

    // Pronunciation scoring records per-word feedback and a progress event.
    const pronScore = await fetchJson('/trpc/voice.pronunciation.score', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: voiceWsId,
        target: 'the quick brown fox',
        transcript: 'the quick brown fox',
      }),
    });
    const pronData = pronScore.body?.result?.data;
    print(
      'voice.pronunciation.score returns per-word feedback',
      pronScore.status === 200 &&
        typeof pronData?.overall === 'number' &&
        Array.isArray(pronData?.words) &&
        pronData.words.length === 4 &&
        pronData.words.every((word: any) => word.status === 'good'),
      { overall: pronData?.overall, words: pronData?.words?.length },
    );

    const pairs = await fetchJson('/trpc/voice.pronunciation.minimalPairs', {
      method: 'GET',
    });
    print(
      'voice.pronunciation.minimalPairs returns drills',
      Array.isArray(pairs.body?.result?.data) &&
        pairs.body.result.data.length > 0,
    );

    // Dictation scoring records listening practice.
    const dictation = await fetchJson('/trpc/language.dictation.score', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: voiceWsId,
        target: 'the library closes at six',
        typed: 'the library closes at six',
      }),
    });
    const dictationData = dictation.body?.result?.data;
    print(
      'language.dictation.score diffs the transcription',
      dictation.status === 200 &&
        dictationData?.accuracy === 1 &&
        dictationData?.total === 5,
      { accuracy: dictationData?.accuracy, total: dictationData?.total },
    );

    // CEFR estimate across the four skills.
    const cefr = await fetchJson(
      `/trpc/language.cefr.get?input=${encodeURIComponent(JSON.stringify({ workspaceId: voiceWsId }))}`,
      { method: 'GET' },
    );
    const cefrData = cefr.body?.result?.data;
    print(
      'language.cefr.get estimates all four skills',
      typeof cefrData?.overall === 'string' &&
        Array.isArray(cefrData?.skills) &&
        cefrData.skills.length === 4 &&
        cefrData.skills.some((skill: any) => skill.evidence > 0),
      { overall: cefrData?.overall },
    );

    // Audio cleanup keeps the volume free of orphans.
    const audioDeleted = await fetchJson('/trpc/voice.audio.delete', {
      method: 'POST',
      body: JSON.stringify({ audioId }),
    });
    print(
      'voice.audio.delete removes a cached asset',
      audioDeleted.body?.result?.data?.deleted === true,
    );

    const audioMissing = await fetchJson(
      `/trpc/voice.audio.list?input=${encodeURIComponent(JSON.stringify({ workspaceId: voiceWsId }))}`,
      { method: 'GET' },
    );
    print(
      'deleted audio is gone from the list',
      !(audioMissing.body?.result?.data ?? []).some(
        (asset: any) => asset.id === audioId,
      ),
    );
  } else {
    print('voice STT/TTS checks skipped (no local provider configured)', true);
  }

  await fetchJson('/trpc/workspace.delete', {
    method: 'POST',
    body: JSON.stringify({ workspaceId: voiceWsId }),
  });

  // -------------------------------------------------------------------
  // Workspace archive export/import over the streaming REST endpoint
  // -------------------------------------------------------------------
  const importWs = await fetchJson('/trpc/workspace.create', {
    method: 'POST',
    body: JSON.stringify({ name: 'Archive Roundtrip' }),
  });
  const importWsId = importWs.body?.result?.data?.id;
  const seedFd = new FormData();
  seedFd.append('workspaceId', importWsId);
  seedFd.append(
    'file',
    new File(['archive roundtrip content\n'.repeat(10)], 'roundtrip.txt', {
      type: 'text/plain',
    }),
  );
  const seedUp = await fetch(`${BASE}/api/upload`, {
    method: 'POST',
    body: seedFd,
  });
  print('archive: upload seed document', seedUp.status === 201);

  const exported = await fetchJson(
    `/trpc/workspace.export?input=${encodeURIComponent(JSON.stringify({ workspaceId: importWsId }))}`,
    { method: 'GET' },
  );
  const archive = exported.body?.result?.data;
  print(
    'archive: export returns documents + conversations',
    archive?.version === 1 &&
      Array.isArray(archive?.documents) &&
      archive.documents.length === 1,
  );

  const archiveFd = new FormData();
  archiveFd.append(
    'archive',
    new File([JSON.stringify(archive)], 'backup.json', {
      type: 'application/json',
    }),
  );
  const imported = await fetch(`${BASE}/api/workspace/import`, {
    method: 'POST',
    body: archiveFd,
  });
  const importedBody = (await imported.json().catch(() => null)) as {
    workspace?: { id: string };
    error?: string;
  } | null;
  const importedId = importedBody?.workspace?.id;
  print(
    'archive: import over the REST endpoint',
    imported.status === 201 && Boolean(importedId) && importedId !== importWsId,
    { status: imported.status },
  );

  const badFd = new FormData();
  badFd.append(
    'archive',
    new File(['not json'], 'bad.json', { type: 'application/json' }),
  );
  const badImport = await fetch(`${BASE}/api/workspace/import`, {
    method: 'POST',
    body: badFd,
  });
  const badImportBody = (await badImport.json().catch(() => null)) as {
    error?: string;
  } | null;
  print(
    'archive: invalid archive rejected with a clear error',
    badImport.status === 400 && typeof badImportBody?.error === 'string',
  );

  if (importedId) {
    await fetchJson('/trpc/workspace.delete', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: importedId }),
    });
  }
  if (importWsId) {
    await fetchJson('/trpc/workspace.delete', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: importWsId }),
    });
  }

  // -------------------------------------------------------------------
  // Ingestion & vision (phase 4a): magic-byte admission, duplicate
  // detection, container limits, image serving, vision analysis and the
  // SSRF guard on URL ingestion.
  // -------------------------------------------------------------------
  const ingestWs = await fetchJson('/trpc/workspace.create', {
    method: 'POST',
    body: JSON.stringify({ name: 'Smoke Ingestion' }),
  });
  const ingestWsId = ingestWs.body?.result?.data?.id as string | undefined;
  print('ingestion workspace', Boolean(ingestWsId));

  const uploadTo = async (workspaceId: string, file: File) => {
    const form = new FormData();
    form.append('workspaceId', workspaceId);
    form.append('file', file);
    const res = await fetch(`${BASE}/api/upload`, {
      method: 'POST',
      body: form,
    });
    return {
      status: res.status,
      body: (await res.json().catch(() => null)) as any,
    };
  };

  if (ingestWsId) {
    // EPUB: the bytes decide the parser, and the parser keeps chapters.
    const epub = await buildEpub(
      [
        { title: 'Retrieval', paragraphs: ['Hybrid search fuses two arms.'] },
        { title: 'Study', paragraphs: ['Flashcards schedule reviews.'] },
      ],
      { title: 'Smoke Book', author: 'Smoke Author' },
    );
    const upEpub = await uploadTo(
      ingestWsId,
      new File([epub], 'smoke-book.epub', { type: 'application/epub+zip' }),
    );
    const epubDoc = upEpub.body?.document;
    print(
      'upload epub detected from magic bytes',
      upEpub.status === 201 && epubDoc?.fileType === 'epub',
      { status: upEpub.status, fileType: epubDoc?.fileType },
    );

    // Same bytes twice: the second upload returns the existing document.
    const upEpubAgain = await uploadTo(
      ingestWsId,
      new File([epub], 'copied-book.epub', { type: 'application/epub+zip' }),
    );
    print(
      'duplicate upload returns the existing document',
      upEpubAgain.status === 200 &&
        upEpubAgain.body?.duplicate === true &&
        upEpubAgain.body?.document?.id === epubDoc?.id,
      { status: upEpubAgain.status, duplicate: upEpubAgain.body?.duplicate },
    );

    // A PNG named like a DOCX is still a PNG: content decides, not the name.
    const upRenamed = await uploadTo(
      ingestWsId,
      new File([TINY_PNG], 'notes.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    );
    print(
      'magic bytes override a misleading extension',
      upRenamed.status === 201 && upRenamed.body?.document?.fileType === 'png',
      {
        status: upRenamed.status,
        fileType: upRenamed.body?.document?.fileType,
      },
    );
    const imageDocId = upRenamed.body?.document?.id as string | undefined;

    // Zip bomb: 2 MB of zeros compresses far past the ratio limit.
    const bomb = await zipBuffer(
      { 'bomb.txt': Buffer.alloc(2 * 1024 * 1024, 0) },
      { deflate: true },
    );
    const upBomb = await uploadTo(
      ingestWsId,
      new File([bomb], 'bomb.zip', { type: 'application/zip' }),
    );
    print(
      'zip bomb rejected before indexing',
      upBomb.status === 400 &&
        /compression|large|ratio|uncompressed/i.test(
          String(upBomb.body?.error ?? ''),
        ),
      { status: upBomb.status, error: upBomb.body?.error },
    );

    // Unrecognised content is refused with an actionable message.
    const junk = await uploadTo(
      ingestWsId,
      new File(['nothing usable here'], 'mystery.bin', {
        type: 'application/octet-stream',
      }),
    );
    print(
      'unrecognised upload content rejected',
      junk.status === 400 && typeof junk.body?.error === 'string',
      { status: junk.status },
    );

    // Vision capability snapshot (keys never leave the server).
    const visionCfg = await fetchJson('/trpc/vision.config', { method: 'GET' });
    const visionData = visionCfg.body?.result?.data as
      { enabled: boolean; available: boolean; model: string } | undefined;
    print(
      'vision.config reports the capability',
      typeof visionData?.enabled === 'boolean' &&
        typeof visionData?.available === 'boolean',
      visionData,
    );

    // Image bytes are served with hardened headers (no sniffing, sandboxed).
    if (imageDocId) {
      const img = await fetch(`${BASE}/api/images/${imageDocId}`);
      print(
        'image bytes served with nosniff + CSP',
        img.status === 200 &&
          img.headers.get('content-type') === 'image/png' &&
          img.headers.get('x-content-type-options') === 'nosniff' &&
          (img.headers.get('content-security-policy') ?? '').includes(
            "default-src 'none'",
          ),
        { status: img.status, type: img.headers.get('content-type') },
      );
      const missing = await fetch(
        `${BASE}/api/images/00000000-0000-4000-8000-000000000000`,
      );
      print('unknown image id -> 404', missing.status === 404);
    }

    // Wait for the EPUB and the PNG to index, then check structure metadata.
    const waitForDocs = async (): Promise<any[]> => {
      for (let i = 0; i < 20; i++) {
        await sleep(1500);
        const res = await fetchJson(
          `/trpc/document.listByWorkspace?input=${encodeURIComponent(JSON.stringify({ workspaceId: ingestWsId }))}`,
          { method: 'GET' },
        );
        const list = (res.body?.result?.data ?? []) as any[];
        if (list.length > 0 && list.every((d) => d.status !== 'processing')) {
          return list;
        }
      }
      return [];
    };
    const ingestDocs = await waitForDocs();
    const epubRow = ingestDocs.find((d) => d.fileType === 'epub');
    print(
      'epub indexed with chapter structure',
      epubRow?.status === 'ready' &&
        Array.isArray(epubRow?.metadata?.chapters) &&
        epubRow.metadata.chapters.length >= 2,
      {
        status: epubRow?.status,
        chapters: epubRow?.metadata?.chapters?.length,
        error: epubRow?.errorMessage,
      },
    );

    // The image indexes through vision when a provider is configured (mock in
    // CI). Without one, OCR may be absent too, so only assert the happy path.
    const imageRow = ingestDocs.find((d) => d.fileType === 'png');
    if (visionData?.available) {
      print(
        'image indexed through the vision provider',
        imageRow?.status === 'ready' && imageRow?.metadata?.vision === true,
        { status: imageRow?.status, error: imageRow?.errorMessage },
      );
      const images = await fetchJson(
        `/trpc/document.images?input=${encodeURIComponent(JSON.stringify({ workspaceId: ingestWsId }))}`,
        { method: 'GET' },
      );
      print(
        'document.images lists the ready image',
        (images.body?.result?.data ?? []).some((d: any) => d.id === imageDocId),
      );

      if (imageDocId) {
        const analyse = await fetchJson('/trpc/vision.analyze', {
          method: 'POST',
          body: JSON.stringify({
            workspaceId: ingestWsId,
            documentId: imageDocId,
            mode: 'diagram',
          }),
        });
        const analysis = analyse.body?.result?.data;
        print(
          'vision.analyze returns a diagram analysis',
          analyse.body?.result?.data?.mode === 'diagram' &&
            typeof analysis?.analysis === 'string' &&
            analysis.analysis.length > 20,
          { mode: analysis?.mode, chars: analysis?.analysis?.length },
        );
        // A non-image document is refused rather than sent to the model.
        const badAnalyse = await fetchJson('/trpc/vision.analyze', {
          method: 'POST',
          body: JSON.stringify({
            workspaceId: ingestWsId,
            documentId: epubRow?.id,
            mode: 'general',
          }),
        });
        print(
          'vision.analyze refuses a non-image document',
          badAnalyse.body?.error?.data?.code === 'BAD_REQUEST',
        );
      }
    } else {
      print('vision checks skipped (no vision-capable provider)', true);
    }

    // SSRF guard: the strict instance must refuse a private address.
    const ssrf = await fetchJson('/api/ingest/url', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: ingestWsId,
        url: 'http://127.0.0.1:9/private-article',
      }),
    });
    print(
      'url ingestion refuses a loopback address',
      ssrf.status === 400 &&
        /private|link-local|loopback/i.test(String(ssrf.body?.error ?? '')),
      { status: ssrf.status, error: ssrf.body?.error },
    );

    const fileUrl = await fetchJson('/api/ingest/url', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: ingestWsId,
        url: 'file:///etc/passwd',
      }),
    });
    print('url ingestion refuses non-http protocols', fileUrl.status === 400, {
      status: fileUrl.status,
      error: fileUrl.body?.error,
    });

    const metadataUrl = await fetchJson('/api/ingest/url', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: ingestWsId,
        url: 'http://169.254.169.254/latest/meta-data/',
      }),
    });
    print(
      'url ingestion refuses the cloud metadata endpoint',
      metadataUrl.status === 400,
      { status: metadataUrl.status },
    );

    await fetchJson('/trpc/workspace.delete', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: ingestWsId }),
    });
  }

  // -------------------------------------------------------------------
  // URL ingestion happy path: a second instance with the documented
  // private-host override plus a local article server, so the fetch ->
  // Readability -> store -> index path is exercised end to end.
  // -------------------------------------------------------------------
  const ARTICLE_PORT = 3104;
  const articleServer = createServer((req, res) => {
    const paragraphs = Array.from(
      { length: 12 },
      (_unused, index) =>
        `<p>Paragraph ${index + 1}: hybrid retrieval fuses vector similarity with keyword search, and flashcards close the study loop.</p>`,
    ).join('\n');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><title>Smoke Article</title></head>
<body><nav><a href="/">Home</a></nav>
<article><h1>Smoke Article</h1>${paragraphs}</article>
<footer>footer</footer></body></html>`);
  });
  await new Promise<void>((resolve) =>
    articleServer.listen(ARTICLE_PORT, () => resolve()),
  );

  const INGEST_PORT = 3103;
  const INGEST_BASE = `http://localhost:${INGEST_PORT}`;
  const ingestChild = spawn('pnpm', ['exec', 'tsx', 'src/index.ts'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(INGEST_PORT),
      // Documented test/self-host override: the article server is local.
      INGEST_ALLOW_PRIVATE_HOSTS: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  ingestChild.stderr.on('data', (d) => (stdout += d.toString()));

  try {
    let ingestHealthy = false;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`${INGEST_BASE}/healthz`);
        if (res.ok) {
          ingestHealthy = true;
          break;
        }
      } catch {
        /* not up yet */
      }
      await sleep(500);
    }
    print('ingest api healthz', ingestHealthy);

    const ingestWs = await fetchJsonAuth(
      INGEST_BASE,
      '/trpc/workspace.create',
      {
        method: 'POST',
        body: JSON.stringify({ name: 'Smoke URL Ingestion' }),
      },
    );
    const urlWsId = ingestWs.body?.result?.data?.id as string | undefined;
    print('url ingestion workspace', Boolean(urlWsId));

    if (urlWsId) {
      const articleUrl = `http://127.0.0.1:${ARTICLE_PORT}/smoke-article`;
      const imported = await fetchJsonAuth(INGEST_BASE, '/api/ingest/url', {
        method: 'POST',
        body: JSON.stringify({ workspaceId: urlWsId, url: articleUrl }),
      });
      print(
        'url ingestion extracts an article',
        imported.status === 201 &&
          imported.body?.kind === 'article' &&
          imported.body?.wordCount > 50,
        { status: imported.status, words: imported.body?.wordCount },
      );

      const again = await fetchJsonAuth(INGEST_BASE, '/api/ingest/url', {
        method: 'POST',
        body: JSON.stringify({ workspaceId: urlWsId, url: articleUrl }),
      });
      print(
        're-importing the same url is deduplicated',
        again.status === 200 && again.body?.duplicate === true,
        { status: again.status },
      );

      let importedRow: any;
      for (let i = 0; i < 20; i++) {
        await sleep(1500);
        const list = await fetchJsonAuth(
          INGEST_BASE,
          `/trpc/document.listByWorkspace?input=${encodeURIComponent(JSON.stringify({ workspaceId: urlWsId }))}`,
          { method: 'GET' },
        );
        importedRow = (list.body?.result?.data ?? [])[0];
        if (importedRow && importedRow.status !== 'processing') break;
      }
      print(
        'imported article indexed with provenance',
        importedRow?.status === 'ready' &&
          importedRow?.metadata?.kind === 'web' &&
          typeof importedRow?.sourceUrl === 'string',
        {
          status: importedRow?.status,
          kind: importedRow?.metadata?.kind,
          sourceUrl: importedRow?.sourceUrl,
          error: importedRow?.errorMessage,
        },
      );

      await fetchJsonAuth(INGEST_BASE, '/trpc/workspace.delete', {
        method: 'POST',
        body: JSON.stringify({ workspaceId: urlWsId }),
      });
    }
  } finally {
    ingestChild.kill();
    articleServer.close();
  }

  // --- public REST API (P-5) and metrics (P-1) -------------------------
  {
    // A dedicated workspace: the main one is deleted by the earlier checks,
    // and the API must be verified against documents it actually owns.
    const apiWs = await fetchJson('/trpc/workspace.create', {
      method: 'POST',
      body: JSON.stringify({ name: 'API Smoke Workspace', description: 'v1' }),
    });
    const apiWorkspaceId = apiWs.body?.result?.data?.id as string | undefined;
    const apiFile = new FormData();
    apiFile.append('workspaceId', apiWorkspaceId ?? '');
    apiFile.append(
      'file',
      new File(
        [
          'Nexus exposes a scoped REST API. Hybrid retrieval fuses vector similarity with keyword search. '.repeat(
            12,
          ),
        ],
        'api-smoke.txt',
        { type: 'text/plain' },
      ),
    );
    await fetch(`${BASE}/api/upload`, { method: 'POST', body: apiFile });
    let apiDoc: any;
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      const list = await fetchJson(
        `/trpc/document.listByWorkspace?input=${encodeURIComponent(JSON.stringify({ workspaceId: apiWorkspaceId }))}`,
        { method: 'GET' },
      );
      apiDoc = (list.body?.result?.data ?? [])[0];
      if (apiDoc && apiDoc.status === 'ready') break;
    }
    print('api v1 smoke workspace indexed', apiDoc?.status === 'ready');

    const metrics = await fetch(`${BASE}/metrics`);
    const metricsText = await metrics.text();
    print(
      'metrics endpoint exposes request and queue series',
      metrics.status === 200 &&
        metricsText.includes('nexus_http_requests_total') &&
        metricsText.includes('nexus_queue_jobs') &&
        metricsText.includes('nexus_chat_ttft_seconds'),
      { status: metrics.status, bytes: metricsText.length },
    );

    const noKey = await fetchJsonAuth(BASE, '/api/v1/me');
    print('api v1 rejects a request without a key', noKey.status === 401);
    const badKey = await fetchJsonAuth(BASE, '/api/v1/me', {
      headers: { authorization: 'Bearer ndx_000000000000_notarealkey' },
    });
    print('api v1 rejects an unknown key', badKey.status === 401);

    const created = await fetchJson('/trpc/apiKey.create', {
      method: 'POST',
      body: JSON.stringify({
        name: 'smoke integration',
        scopes: [
          'search',
          'ask',
          'documents:read',
          'documents:write',
          'reviews:read',
          'reviews:write',
          'notes:write',
        ],
      }),
    });
    const createdData = created.body?.result?.data;
    const apiKey = createdData?.key as string | undefined;
    const authHeader = { authorization: `Bearer ${apiKey}` };
    print(
      'apiKey.create returns the secret once with a display prefix',
      typeof apiKey === 'string' &&
        apiKey.startsWith('ndx_') &&
        typeof createdData?.prefix === 'string' &&
        createdData?.scopes?.length === 7,
      { prefix: createdData?.prefix },
    );

    const listed = await fetchJson('/trpc/apiKey.list', { method: 'GET' });
    const listedKeys = (listed.body?.result?.data ?? []) as any[];
    print(
      'apiKey.list never returns the secret',
      listedKeys.some((key) => key.id === createdData?.id) &&
        listedKeys.every((key) => key.key === undefined),
    );

    const me = await fetchJsonAuth(BASE, '/api/v1/me', {
      headers: authHeader,
    });
    print(
      'api v1 me reports the granted scopes',
      me.status === 200 &&
        Array.isArray(me.body?.scopes) &&
        me.body.scopes.includes('search') &&
        me.body.scopes.includes('documents:read'),
      me.body,
    );

    const workspaces = await fetchJsonAuth(BASE, '/api/v1/workspaces', {
      headers: authHeader,
    });
    print(
      'api v1 lists the key owner workspaces',
      workspaces.status === 200 &&
        (workspaces.body?.workspaces ?? []).some(
          (w: any) => w.id === apiWorkspaceId && w.documentCount >= 1,
        ),
      {
        count: workspaces.body?.workspaces?.length,
        mine: (workspaces.body?.workspaces ?? []).find(
          (w: any) => w.id === apiWorkspaceId,
        )?.documentCount,
      },
    );

    const restDocs = await fetchJsonAuth(
      BASE,
      `/api/v1/documents?workspaceId=${apiWorkspaceId}`,
      { headers: authHeader },
    );
    print(
      'api v1 lists documents of a workspace',
      restDocs.status === 200 &&
        Array.isArray(restDocs.body?.documents) &&
        restDocs.body.documents.length > 0,
      { count: restDocs.body?.documents?.length },
    );

    const search = await fetchJsonAuth(
      BASE,
      `/api/v1/search?workspaceId=${apiWorkspaceId}&q=${encodeURIComponent('retrieval augmented generation')}`,
      { headers: authHeader },
    );
    print(
      'api v1 search returns ranked sources',
      search.status === 200 &&
        Array.isArray(search.body?.sources) &&
        search.body.sources.length > 0 &&
        typeof search.body?.query === 'string',
      { count: search.body?.sources?.length },
    );

    const ask = await fetchJsonAuth(BASE, '/api/v1/ask', {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify({
        workspaceId: apiWorkspaceId,
        question: 'What is Nexus in one sentence?',
      }),
    });
    print(
      'api v1 ask returns an answer with cited sources and timings',
      ask.status === 200 &&
        typeof ask.body?.answer === 'string' &&
        ask.body.answer.length > 0 &&
        Array.isArray(ask.body?.sources) &&
        ask.body.sources.some((source: any) => source.cited === true) &&
        typeof ask.body?.timings?.totalMs === 'number',
      {
        status: ask.status,
        chars: ask.body?.answer?.length,
        ttftMs: ask.body?.timings?.firstTokenMs,
      },
    );

    const restUpload = new FormData();
    restUpload.append('workspaceId', apiWorkspaceId ?? '');
    restUpload.append(
      'file',
      new File(
        [
          'Scoped API keys let a script upload a document. Fingerprints dedupe identical bytes. '.repeat(
            6,
          ),
        ],
        'api-upload.txt',
        { type: 'text/plain' },
      ),
    );
    const uploaded = await fetchJsonAuth(BASE, '/api/v1/documents', {
      method: 'POST',
      headers: authHeader,
      body: restUpload,
    });
    print(
      'api v1 uploads a document with documents:write',
      uploaded.status === 201 &&
        uploaded.body?.duplicate === false &&
        typeof uploaded.body?.document?.id === 'string',
      { status: uploaded.status, type: uploaded.body?.document?.fileType },
    );

    const restUploadAgain = new FormData();
    restUploadAgain.append('workspaceId', apiWorkspaceId ?? '');
    restUploadAgain.append(
      'file',
      new File(
        [
          'Scoped API keys let a script upload a document. Fingerprints dedupe identical bytes. '.repeat(
            6,
          ),
        ],
        'api-upload.txt',
        { type: 'text/plain' },
      ),
    );
    const duplicateUpload = await fetchJsonAuth(BASE, '/api/v1/documents', {
      method: 'POST',
      headers: authHeader,
      body: restUploadAgain,
    });
    print(
      'api v1 upload reports a duplicate instead of indexing twice',
      duplicateUpload.status === 200 &&
        duplicateUpload.body?.duplicate === true &&
        duplicateUpload.body?.document?.id === uploaded.body?.document?.id,
      { status: duplicateUpload.status },
    );

    // Reviews: create a deck + card through tRPC, then read and grade it over REST.
    const apiDeck = await fetchJson('/trpc/study.decks.create', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: apiWorkspaceId,
        name: 'API deck',
      }),
    });
    const apiDeckId = apiDeck.body?.result?.data?.id;
    const apiCard = await fetchJson('/trpc/study.cards.create', {
      method: 'POST',
      body: JSON.stringify({
        deckId: apiDeckId,
        front: 'What does the API allow?',
        back: 'Scoped search, ask, uploads and reviews.',
      }),
    });
    const apiCardId = apiCard.body?.result?.data?.id;

    const due = await fetchJsonAuth(
      BASE,
      `/api/v1/reviews/due?workspaceId=${apiWorkspaceId}&limit=10`,
      { headers: authHeader },
    );
    print(
      'api v1 lists due cards with interval previews',
      due.status === 200 &&
        (due.body?.cards ?? []).some(
          (card: any) => card.id === apiCardId && card.intervals,
        ),
      { status: due.status, count: due.body?.cards?.length },
    );

    const review = await fetchJsonAuth(BASE, '/api/v1/reviews', {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify({ cardId: apiCardId, rating: 'good' }),
    });
    print(
      'api v1 grades a review and reschedules the card',
      review.status === 200 &&
        typeof review.body?.nextDueAt === 'string' &&
        new Date(review.body.nextDueAt).getTime() > Date.now() &&
        typeof review.body?.remaining === 'number',
      { status: review.status, nextDueAt: review.body?.nextDueAt },
    );

    // Webhooks: create one for this workspace, then verify a test delivery and
    // a real document.indexed event are signed and carry the payload.
    const hook = await fetchJson('/trpc/webhook.create', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: apiWorkspaceId,
        url: hookUrl,
        events: ['document.indexed'],
      }),
    });
    const hookId = hook.body?.result?.data?.id as string | undefined;
    const hookSecret = hook.body?.result?.data?.secret as string | undefined;
    print(
      'webhook.create returns a signing secret once',
      typeof hookId === 'string' &&
        typeof hookSecret === 'string' &&
        hookSecret.length >= 32,
      { id: hookId, secretChars: hookSecret?.length },
    );

    const hookList = await fetchJson('/trpc/webhook.list', { method: 'GET' });
    const listedHook = (hookList.body?.result?.data ?? []).find(
      (row: any) => row.id === hookId,
    );
    print(
      'webhook.list never returns the signing secret',
      Boolean(listedHook) && listedHook?.secret === undefined,
    );

    const hookTest = await fetchJson('/trpc/webhook.test', {
      method: 'POST',
      body: JSON.stringify({ id: hookId }),
    });
    let testHit: (typeof hookHits)[number] | undefined;
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      testHit = hookHits.find((hit) => {
        try {
          return JSON.parse(hit.body).deliveryId !== undefined;
        } catch {
          return false;
        }
      });
      if (testHit) break;
    }
    const expectedSignature = testHit
      ? `sha256=${createHmac('sha256', hookSecret ?? '')
          .update(testHit.body)
          .digest('hex')}`
      : '';
    print(
      'webhook test delivery is signed and identified',
      hookTest.body?.result?.data?.queued === true &&
        Boolean(testHit) &&
        testHit?.headers['x-nexus-signature'] === expectedSignature &&
        typeof testHit?.headers['x-nexus-delivery'] === 'string',
      {
        signature: testHit?.headers['x-nexus-signature'] === expectedSignature,
        event: testHit?.headers['x-nexus-event'],
      },
    );

    // A real indexing run must fan out the event to the endpoint.
    const hookUpload = new FormData();
    hookUpload.append('workspaceId', apiWorkspaceId ?? '');
    hookUpload.append(
      'file',
      new File(
        [
          'Nexus webhook event document. Hybrid retrieval is grounded. '.repeat(
            6,
          ),
        ],
        'webhook-event.txt',
        { type: 'text/plain' },
      ),
    );
    await fetchJsonAuth(BASE, '/api/v1/documents', {
      method: 'POST',
      headers: authHeader,
      body: hookUpload,
    });
    let indexedHit: { event: string; title?: string } | undefined;
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      const hit = [...hookHits]
        .reverse()
        .find((entry) => JSON.parse(entry.body).event === 'document.indexed');
      if (hit) {
        const parsed = JSON.parse(hit.body);
        if (parsed.data?.title === 'webhook-event.txt') {
          indexedHit = { event: parsed.event, title: parsed.data.title };
          break;
        }
      }
    }
    print(
      'document.indexed fires the webhook with the document payload',
      indexedHit?.event === 'document.indexed' &&
        indexedHit?.title === 'webhook-event.txt',
      indexedHit,
    );

    const note = await fetchJsonAuth(BASE, '/api/v1/notes', {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify({
        workspaceId: apiWorkspaceId,
        title: 'API note',
        contentMd: 'Captured over REST.',
      }),
    });
    print(
      'api v1 creates a note with notes:write',
      note.status === 201 && note.body?.note?.title === 'API note',
      { status: note.status },
    );

    const blockedUrl = await fetchJsonAuth(BASE, '/api/v1/urls', {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify({
        workspaceId: apiWorkspaceId,
        url: 'http://127.0.0.1:9/private',
      }),
    });
    print(
      'api v1 url import is SSRF-guarded',
      blockedUrl.status === 400 &&
        /private|link-local/i.test(String(blockedUrl.body?.error)),
      { status: blockedUrl.status, error: blockedUrl.body?.error },
    );

    // --- zip export (B-5) -----------------------------------------------
    const zipRes = await fetch(
      `${BASE}/api/workspaces/${apiWorkspaceId}/export.zip`,
    );
    const zipBuffer = Buffer.from(await zipRes.arrayBuffer());
    print(
      'workspace export is a zip download',
      zipRes.status === 200 &&
        zipRes.headers.get('content-type') === 'application/zip' &&
        zipBuffer.subarray(0, 2).toString() === 'PK',
      { status: zipRes.status, bytes: zipBuffer.length },
    );
    const zip = await JSZip.loadAsync(zipBuffer);
    const zipEntries = Object.keys(zip.files);
    print(
      'zip contains the manifest, readme and original files',
      zipEntries.includes('workspace.json') &&
        zipEntries.includes('README.txt') &&
        zipEntries.some((entry) => entry.startsWith('documents/')),
      { entries: zipEntries.slice(0, 6) },
    );
    const manifest = JSON.parse(
      (await zip.file('workspace.json')?.async('string')) ?? '{}',
    ) as { workspace?: { name?: string }; documents?: unknown[] };
    print(
      'zip manifest keeps workspace metadata and conversations',
      manifest.workspace?.name === 'API Smoke Workspace' &&
        Array.isArray(manifest.documents),
    );

    const foreignZip = await fetch(
      `${BASE}/api/workspaces/00000000-0000-4000-8000-000000000000/export.zip`,
    );
    print(
      'zip export hides workspaces the user does not own',
      foreignZip.status === 404,
    );

    // --- read-only share links (L-13) -----------------------------------
    const shareCreate = await fetchJson('/trpc/share.create', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: apiWorkspaceId,
        label: 'smoke link',
        expiresInDays: 7,
      }),
    });
    const shareUrl = shareCreate.body?.result?.data?.url as string | undefined;
    const shareToken = shareUrl?.split('/share/')[1];
    print(
      'share.create returns a one-time read-only URL',
      typeof shareUrl === 'string' &&
        /^nxs_/.test(shareToken ?? '') &&
        shareCreate.body?.result?.data?.active === true,
      { tokenPrefix: shareToken?.slice(0, 8) },
    );

    const shareList = await fetchJson(
      `/trpc/share.list?input=${encodeURIComponent(JSON.stringify({ workspaceId: apiWorkspaceId }))}`,
      { method: 'GET' },
    );
    const shareRows = (shareList.body?.result?.data ?? []) as any[];
    print(
      'share.list never returns the token',
      shareRows.some((row) => row.label === 'smoke link') &&
        shareRows.every(
          (row) => row.url === undefined && row.token === undefined,
        ),
    );

    // No session and no API key: the capability token is the only credential.
    const sharedView = await fetch(`${BASE}/api/share/${shareToken}`);
    const sharedBody = (await sharedView.json()) as any;
    print(
      'share link serves the workspace read-only',
      sharedView.status === 200 &&
        sharedBody?.name === 'API Smoke Workspace' &&
        Array.isArray(sharedBody?.documents) &&
        sharedBody.documents.length > 0,
      { status: sharedView.status, docs: sharedBody?.documents?.length },
    );

    const sharedAsk = await fetch(`${BASE}/api/share/${shareToken}/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'What is Nexus?' }),
    });
    const sharedAnswer = (await sharedAsk.json()) as any;
    print(
      'share link answers questions with cited sources',
      sharedAsk.status === 200 &&
        typeof sharedAnswer?.answer === 'string' &&
        sharedAnswer.answer.length > 0 &&
        Array.isArray(sharedAnswer?.sources),
      { status: sharedAsk.status },
    );

    const shareRevoke = await fetchJson('/trpc/share.revoke', {
      method: 'POST',
      body: JSON.stringify({ id: shareCreate.body?.result?.data?.id }),
    });
    const sharedAfterRevoke = await fetch(`${BASE}/api/share/${shareToken}`);
    const revokeAsk = await fetch(`${BASE}/api/share/${shareToken}/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Still there?' }),
    });
    print(
      'a revoked share link stops working immediately',
      shareRevoke.body?.result?.data?.revoked === true &&
        sharedAfterRevoke.status === 404 &&
        revokeAsk.status === 404,
      { view: sharedAfterRevoke.status, ask: revokeAsk.status },
    );

    const unknownShare = await fetch(`${BASE}/api/share/nxs_${'a'.repeat(43)}`);
    print('an unknown share token is 404', unknownShare.status === 404);

    // --- domain packs (L-14) --------------------------------------------
    const packs = await fetchJson('/trpc/packs.list', { method: 'GET' });
    const packList = (packs.body?.result?.data?.packs ?? []) as any[];
    print(
      'packs.list exposes the built-in domain packs',
      packList.length >= 5 &&
        packList.every(
          (pack) =>
            typeof pack.id === 'string' &&
            Array.isArray(pack.plan?.steps) &&
            pack.cardCount > 0,
        ),
      { packs: packList.length },
    );

    const packInstall = await fetchJson('/trpc/packs.install', {
      method: 'POST',
      body: JSON.stringify({ packId: 'tech-python-foundations' }),
    });
    const packWorkspace = packInstall.body?.result?.data;
    const packWorkspaceId = packWorkspace?.id as string | undefined;
    print(
      'installing a pack creates a topic with its plan metadata',
      Boolean(packWorkspaceId) &&
        packWorkspace?.metadata?.packId === 'tech-python-foundations' &&
        packWorkspace?.metadata?.starterPrompts?.length >= 3,
      { id: packWorkspaceId, icon: packWorkspace?.metadata?.icon },
    );

    const packDecks = await fetchJson(
      `/trpc/study.decks.list?input=${encodeURIComponent(JSON.stringify({ workspaceId: packWorkspaceId }))}`,
      { method: 'GET' },
    );
    const packDeck = (packDecks.body?.result?.data ?? [])[0];
    print(
      'the pack creates a starter deck with its cards',
      Boolean(packDeck?.id) && packDeck?.cardCount >= 5,
      { deck: packDeck?.name, cards: packDeck?.cardCount },
    );

    const packNotes = await fetchJson(
      `/trpc/notes.notes.list?input=${encodeURIComponent(JSON.stringify({ workspaceId: packWorkspaceId }))}`,
      { method: 'GET' },
    );
    const packNote = (packNotes.body?.result?.data ?? [])[0];
    print(
      'the pack writes the plan as a note',
      typeof packNote?.contentMd === 'string' &&
        packNote.contentMd.includes('Python fundamentals'),
      { title: packNote?.title },
    );

    const packConversations = await fetchJson(
      `/trpc/chat.listByWorkspace?input=${encodeURIComponent(JSON.stringify({ workspaceId: packWorkspaceId }))}`,
      { method: 'GET' },
    );
    const packConversation = (packConversations.body?.result?.data ?? [])[0];
    print(
      'the pack opens with a welcome conversation',
      Boolean(packConversation?.id) &&
        String(packConversation?.title).startsWith('Start here:'),
      { title: packConversation?.title },
    );

    await fetchJson('/trpc/workspace.delete', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: packWorkspaceId }),
    });

    // --- learning-portal dashboard --------------------------------------
    const overview = await fetchJson('/trpc/dashboard.overview', {
      method: 'GET',
    });
    const overviewData = overview.body?.result?.data;
    print(
      'dashboard.overview aggregates topics, sources and due cards',
      typeof overviewData?.totals?.topics === 'number' &&
        overviewData.totals.topics >= 1 &&
        typeof overviewData?.totals?.documents === 'number' &&
        Array.isArray(overviewData?.topics) &&
        overviewData.topics.some(
          (topic: any) =>
            topic.id === apiWorkspaceId && topic.documentCount >= 1,
        ) &&
        Array.isArray(overviewData?.recentDocuments),
      {
        topics: overviewData?.totals?.topics,
        documents: overviewData?.totals?.documents,
        due: overviewData?.totals?.dueCards,
      },
    );

    // --- admin queue view (P-3) -----------------------------------------
    const queue = await fetchJson('/trpc/admin.queue', { method: 'GET' });
    const queueData = queue.body?.result?.data;
    print(
      'admin.queue reports job counts',
      typeof queueData?.counts?.waiting === 'number' &&
        typeof queueData?.counts?.failed === 'number' &&
        Array.isArray(queueData?.failed),
      queueData?.counts,
    );
    const retryMissing = await fetchJson('/trpc/admin.retryJob', {
      method: 'POST',
      body: JSON.stringify({
        documentId: '00000000-0000-4000-8000-000000000001',
      }),
    });
    print(
      'admin.retryJob on an unknown document is NOT_FOUND',
      retryMissing.body?.error?.data?.code === 'NOT_FOUND',
    );

    const notOwned = await fetchJsonAuth(
      BASE,
      '/api/v1/documents?workspaceId=00000000-0000-4000-8000-000000000000',
      { headers: authHeader },
    );
    print(
      'api v1 hides workspaces the key does not own',
      notOwned.status === 404,
      { status: notOwned.status },
    );

    const readOnly = await fetchJson('/trpc/apiKey.create', {
      method: 'POST',
      body: JSON.stringify({ name: 'search only', scopes: ['search'] }),
    });
    const readOnlyKey = readOnly.body?.result?.data?.key as string | undefined;
    const denied = await fetchJsonAuth(
      BASE,
      `/api/v1/documents?workspaceId=${apiWorkspaceId}`,
      { headers: { authorization: `Bearer ${readOnlyKey}` } },
    );
    print(
      'api v1 enforces the required scope',
      denied.status === 403 && denied.body?.requiredScope === 'documents:read',
      { status: denied.status, required: denied.body?.requiredScope },
    );

    const revoked = await fetchJson('/trpc/apiKey.revoke', {
      method: 'POST',
      body: JSON.stringify({ id: createdData?.id }),
    });
    const afterRevoke = await fetchJsonAuth(BASE, '/api/v1/me', {
      headers: authHeader,
    });
    print(
      'a revoked key stops working immediately',
      revoked.body?.result?.data?.revoked === true &&
        afterRevoke.status === 401,
      { status: afterRevoke.status },
    );

    await fetchJson('/trpc/workspace.delete', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: apiWorkspaceId }),
    });
    await fetchJson('/trpc/apiKey.revoke', {
      method: 'POST',
      body: JSON.stringify({ id: readOnly.body?.result?.data?.id }),
    });
  }

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
      METRICS_TOKEN: 'smoke-metrics-token',
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

  // METRICS_TOKEN makes the scrape endpoint private on this instance.
  const metricsAnon = await fetch(`${AUTH_BASE}/metrics`);
  const metricsWithToken = await fetch(`${AUTH_BASE}/metrics`, {
    headers: { authorization: 'Bearer smoke-metrics-token' },
  });
  print(
    'metrics honours METRICS_TOKEN',
    metricsAnon.status === 401 && metricsWithToken.status === 200,
    { anon: metricsAnon.status, bearer: metricsWithToken.status },
  );

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

  // This instance has no SETTINGS_SECRET: storing a provider secret must fail
  // with an actionable error instead of writing plaintext.
  const authSecretSave = await fetchJsonAuth(
    AUTH_BASE,
    '/trpc/settings.update',
    {
      method: 'POST',
      headers: { cookie },
      body: JSON.stringify({ key: 'openai.apiKey', value: 'sk-123456' }),
    },
  );
  print(
    'auth settings.update secret without SETTINGS_SECRET rejected',
    authSecretSave.body?.error?.data?.code === 'BAD_REQUEST' &&
      String(authSecretSave.body?.error?.message).includes('SETTINGS_SECRET'),
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

  // --- multi-user memberships and roles (L-13) -------------------------
  {
    const pgMod = await import('pg');
    const client = new pgMod.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await client.connect();
    const { hashPassword } = await import('../src/services/auth.service.js');
    await client.query(`DELETE FROM users WHERE email = $1`, [
      'member@nexus.dev',
    ]);
    await client.query(
      `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)`,
      ['member@nexus.dev', 'Member', await hashPassword('member-secret')],
    );
    await client.end();

    const memberLogin = await fetch(`${AUTH_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'member@nexus.dev',
        password: 'member-secret',
      }),
    });
    const memberCookie = (memberLogin.headers.get('set-cookie') ?? '').split(
      ';',
    )[0];
    print(
      'member account can sign in',
      memberLogin.status === 200 && memberCookie.startsWith('nexus_session='),
    );

    const beforeAdd = await fetchJsonAuth(AUTH_BASE, '/trpc/workspace.list', {
      headers: { cookie: memberCookie },
    });
    print(
      'a new account sees no workspaces before being added',
      !(beforeAdd.body?.result?.data ?? []).some(
        (item: any) => item.id === authWsId,
      ),
    );

    const added = await fetchJsonAuth(AUTH_BASE, '/trpc/members.add', {
      method: 'POST',
      headers: { cookie },
      body: JSON.stringify({
        workspaceId: authWsId,
        email: 'member@nexus.dev',
        role: 'reader',
      }),
    });
    const memberId = added.body?.result?.data?.userId;
    print(
      'the owner adds a member by email with the reader role',
      added.body?.result?.data?.role === 'reader' &&
        typeof memberId === 'string',
    );

    const afterAdd = await fetchJsonAuth(AUTH_BASE, '/trpc/workspace.list', {
      headers: { cookie: memberCookie },
    });
    print(
      'the member now sees the shared workspace with their role',
      (afterAdd.body?.result?.data ?? []).some(
        (item: any) => item.id === authWsId && item.role === 'reader',
      ),
    );

    const memberDocs = await fetchJsonAuth(
      AUTH_BASE,
      `/trpc/document.listByWorkspace?input=${encodeURIComponent(JSON.stringify({ workspaceId: authWsId }))}`,
      { headers: { cookie: memberCookie } },
    );
    const sharedDocId = (memberDocs.body?.result?.data ?? [])[0]?.id;
    const readerRemove = await fetchJsonAuth(
      AUTH_BASE,
      '/trpc/document.remove',
      {
        method: 'POST',
        headers: { cookie: memberCookie },
        body: JSON.stringify({ documentId: sharedDocId }),
      },
    );
    print(
      'a reader cannot delete shared documents',
      readerRemove.body?.error?.data?.code === 'FORBIDDEN',
      { code: readerRemove.body?.error?.data?.code },
    );

    const readerUpload = new FormData();
    readerUpload.append('workspaceId', authWsId);
    readerUpload.append(
      'file',
      new File(['reader upload'], 'member.txt', { type: 'text/plain' }),
    );
    const readerUploadRes = await fetch(`${AUTH_BASE}/api/upload`, {
      method: 'POST',
      headers: { cookie: memberCookie },
      body: readerUpload,
    });
    print('a reader cannot upload sources', readerUploadRes.status === 403, {
      status: readerUploadRes.status,
    });

    const promote = await fetchJsonAuth(AUTH_BASE, '/trpc/members.updateRole', {
      method: 'POST',
      headers: { cookie },
      body: JSON.stringify({
        workspaceId: authWsId,
        userId: memberId,
        role: 'editor',
      }),
    });
    print(
      'the owner promotes the member to editor',
      promote.body?.result?.data?.updated === true,
    );

    const editorUpload = new FormData();
    editorUpload.append('workspaceId', authWsId);
    editorUpload.append(
      'file',
      new File(['editor upload'], 'editor.txt', { type: 'text/plain' }),
    );
    const editorUploadRes = await fetch(`${AUTH_BASE}/api/upload`, {
      method: 'POST',
      headers: { cookie: memberCookie },
      body: editorUpload,
    });
    print(
      'an editor can upload sources to the shared workspace',
      editorUploadRes.status === 201,
      { status: editorUploadRes.status },
    );

    const memberDeleteWorkspace = await fetchJsonAuth(
      AUTH_BASE,
      '/trpc/workspace.delete',
      {
        method: 'POST',
        headers: { cookie: memberCookie },
        body: JSON.stringify({ workspaceId: authWsId }),
      },
    );
    print(
      'an editor still cannot delete the workspace',
      memberDeleteWorkspace.body?.error?.data?.code === 'FORBIDDEN',
      { code: memberDeleteWorkspace.body?.error?.data?.code },
    );

    const removed = await fetchJsonAuth(AUTH_BASE, '/trpc/members.remove', {
      method: 'POST',
      headers: { cookie },
      body: JSON.stringify({ workspaceId: authWsId, userId: memberId }),
    });
    const afterRemove = await fetchJsonAuth(AUTH_BASE, '/trpc/workspace.list', {
      headers: { cookie: memberCookie },
    });
    print(
      'removing the member revokes access immediately',
      removed.body?.result?.data?.removed === true &&
        !(afterRemove.body?.result?.data ?? []).some(
          (item: any) => item.id === authWsId,
        ),
    );

    const pgCleanup = await import('pg');
    const cleanup = new pgCleanup.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await cleanup.connect();
    await cleanup.query(`DELETE FROM users WHERE email = $1`, [
      'member@nexus.dev',
    ]);
    await cleanup.end();
  }

  // clean up the auth workspace while the session is still valid
  const cleanupAuthWsId = wsAuth.body?.result?.data?.id;
  if (cleanupAuthWsId) {
    const wsCleanup = await fetchJsonAuth(AUTH_BASE, '/trpc/workspace.delete', {
      method: 'POST',
      headers: { cookie },
      body: JSON.stringify({ workspaceId: cleanupAuthWsId }),
    });
    print(
      'auth workspace cleanup',
      wsCleanup.body?.result?.data?.deleted === true,
    );
  }

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
    // Start from default retrieval settings so the assertions are stable
    // regardless of what earlier smoke runs stored.
    await client.query(
      `DELETE FROM settings WHERE key LIKE 'rag.%' OR key LIKE 'job.%'`,
    );
    const modelRow = await client.query(
      `SELECT value FROM settings WHERE key = 'openai.embeddingModel'`,
    );
    const model =
      modelRow.rows[0]?.value ??
      process.env.OPENAI_EMBEDDING_MODEL ??
      'text-embedding-3-small';

    // own workspace + user so the seed is independent of the API test flow
    const userId = await client.query(
      `SELECT id FROM users ORDER BY created_at LIMIT 1`,
    );
    const ws = await client.query(
      `INSERT INTO workspaces (user_id, name) VALUES ($1, 'seed-workspace') RETURNING id`,
      [userId.rows[0].id],
    );
    const seedWorkspaceId = ws.rows[0].id;

    // Seed 3 chunks with fake 1536-dim embeddings and populated provenance.
    // The 'vector' query matches two chunks by keyword; the Mars chunk only
    // matches semantically (vector 0.9) - it must still be retrieved.
    const doc = await client.query(
      `INSERT INTO documents (workspace_id, title, file_path, file_type, status, chunk_count)
       VALUES ($1, 'hybrid-test.txt', 'seed/hybrid-test.txt', 'txt', 'ready', 3)
       RETURNING id`,
      [seedWorkspaceId],
    );
    const docId = doc.rows[0].id;
    const mk = (v: number) =>
      `[${Array.from({ length: 1536 }, () => v).join(',')}]`;
    const chunk = (content: string) =>
      `to_tsvector('english', '${content.replace(/'/g, "''")}')`;
    await client.query(
      `INSERT INTO chunks (document_id, workspace_id, content, embedding, metadata, embedding_model, embedding_dims, embedding_version, token_count, language, content_fts) VALUES
       ($1, $6, 'Hybrid retrieval in Nexus combines postgres full text search with a vector similarity search', $2::vector, '{"page":1,"chunkIndex":0}', $5, 1536, 1, 20, 'english', ${chunk('Hybrid retrieval in Nexus combines postgres full text search with a vector similarity search')}),
       ($1, $6, 'The capital of Mars is a city called Olympus Mons Research Station', $3::vector, '{"page":1,"chunkIndex":1}', $5, 1536, 1, 15, 'english', ${chunk('The capital of Mars is a city called Olympus Mons Research Station')}),
       ($1, $6, 'Embeddings and vectors are generated asynchronously by a BullMQ worker queue', $4::vector, '{"page":1,"chunkIndex":2}', $5, 1536, 1, 15, 'english', ${chunk('Embeddings and vectors are generated asynchronously by a BullMQ worker queue')})`,
      [docId, mk(0.1), mk(0.9), mk(0.2), model, seedWorkspaceId],
    );

    const { retrieveForChat } =
      await import('../src/services/retrieval.service.js');
    const result = await retrieveForChat({
      workspaceId: seedWorkspaceId,
      query: 'vector',
      history: [],
    });
    const contents = result.sources.map((s) => s.content.slice(0, 40));
    const ok =
      result.sources.length >= 2 &&
      result.sources.every((s) => typeof s.fusedScore === 'number');
    const semanticKept = result.sources.some((s) =>
      s.content.includes('capital of Mars'),
    );

    const noKeyword = await retrieveForChat({
      workspaceId: seedWorkspaceId,
      query: 'xyzzy',
      history: [],
    });
    const vectorFallback =
      noKeyword.sources.length === 3 && noKeyword.debug.keywordCandidates === 0;

    await client.query(`DELETE FROM workspaces WHERE id = $1`, [
      seedWorkspaceId,
    ]);
    return {
      ok,
      semanticKept,
      vectorFallback,
      detail: {
        top3: contents,
        profile: result.debug.profile,
        vectorCandidates: result.debug.vectorCandidates,
        keywordCandidates: result.debug.keywordCandidates,
      },
    };
  } finally {
    await client.end();
  }
}

/** Workspace with one current chunk and one legacy chunk (needs re-index). */
async function seedReindexScenario() {
  const pg = await import('pg');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const userId = await client.query(
      `SELECT id FROM users ORDER BY created_at LIMIT 1`,
    );
    const ws = await client.query(
      `INSERT INTO workspaces (user_id, name) VALUES ($1, 'reindex-seed') RETURNING id`,
      [userId.rows[0].id],
    );
    const workspaceId = ws.rows[0].id;
    const doc = await client.query(
      `INSERT INTO documents (workspace_id, title, file_path, file_type, status, chunk_count)
       VALUES ($1, 'reindex.txt', 'seed/reindex.txt', 'txt', 'ready', 2)
       RETURNING id`,
      [workspaceId],
    );
    const docId = doc.rows[0].id;
    const mk = (v: number) =>
      `[${Array.from({ length: 1536 }, () => v).join(',')}]`;
    const model =
      process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small';
    await client.query(
      `INSERT INTO chunks (document_id, workspace_id, content, embedding, metadata, embedding_model, embedding_dims, embedding_version, token_count, language, content_fts) VALUES
       ($1, $5, 'current chunk', $2::vector, '{"page":1,"chunkIndex":0}', $4, 1536, 1, 3, 'english', to_tsvector('english', 'current chunk')),
       ($1, $5, 'legacy chunk', $3::vector, '{"page":1,"chunkIndex":1}', NULL, NULL, NULL, 3, 'english', to_tsvector('english', 'legacy chunk'))`,
      [docId, mk(0.1), mk(0.2), model, workspaceId],
    );
    return { workspaceId };
  } finally {
    await client.end();
  }
}

/** Conversation with one assistant message, for the feedback endpoint. */
async function seedFeedbackScenario() {
  const pg = await import('pg');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const userId = await client.query(
      `SELECT id FROM users ORDER BY created_at LIMIT 1`,
    );
    const ws = await client.query(
      `INSERT INTO workspaces (user_id, name) VALUES ($1, 'feedback-seed') RETURNING id`,
      [userId.rows[0].id],
    );
    const workspaceId = ws.rows[0].id;
    const conv = await client.query(
      `INSERT INTO conversations (workspace_id, title) VALUES ($1, 'feedback') RETURNING id`,
      [workspaceId],
    );
    const conversationId = conv.rows[0].id;
    const msg = await client.query(
      `INSERT INTO messages (conversation_id, role, kind, content) VALUES ($1, 'assistant', 'answer', 'seeded answer') RETURNING id`,
      [conversationId],
    );
    return { workspaceId, conversationId, messageId: msg.rows[0].id };
  } finally {
    await client.end();
  }
}
