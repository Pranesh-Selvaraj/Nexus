#!/usr/bin/env node
/**
 * Nexus CLI (P-5): terminal access to the scoped REST API.
 *
 *   NEXUS_BASE_URL=http://localhost:3000 NEXUS_API_KEY=ndx_... \
 *     pnpm --filter @nexus/backend cli workspaces
 *
 * The CLI holds no logic of its own: every command maps to a REST route, so
 * scopes and ownership are enforced by the server exactly as for any other
 * integration.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const command = args[0];
const baseUrl = (
  flag('base') ??
  process.env.NEXUS_BASE_URL ??
  'http://localhost:3000'
).replace(/\/$/, '');
const apiKey = flag('key') ?? process.env.NEXUS_API_KEY ?? '';

function flag(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function positional(): string[] {
  const result: string[] = [];
  for (let i = 1; i < args.length; i++) {
    if (args[i]?.startsWith('--')) {
      i++; // skip the flag value
      continue;
    }
    result.push(args[i] ?? '');
  }
  return result;
}

function requireWorkspace(): string {
  const workspaceId = flag('workspace') ?? positional()[1];
  if (!workspaceId) {
    throw new Error(
      'Pass --workspace <workspaceId> (run `workspaces` to list them)',
    );
  }
  return workspaceId;
}

async function api(
  route: string,
  init: { method?: string; body?: unknown } = {},
): Promise<any> {
  if (!apiKey) {
    throw new Error(
      'Set NEXUS_API_KEY (Settings → API keys) or pass --key ndx_...',
    );
  }
  const res = await fetch(`${baseUrl}/api/v1${route}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${apiKey}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(
      parsed && typeof parsed === 'object' && 'error' in parsed
        ? `${String((parsed as { error: unknown }).error)} (HTTP ${res.status})`
        : `HTTP ${res.status}`,
    );
  }
  return parsed;
}

function quote(value: string, max = 90): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

async function main(): Promise<void> {
  switch (command) {
    case 'workspaces': {
      const { workspaces } = await api('/workspaces');
      for (const workspace of workspaces) {
        console.log(
          `${workspace.id}  ${workspace.documentCount
            .toString()
            .padStart(3)} docs  ${workspace.name}`,
        );
      }
      return;
    }
    case 'documents': {
      const { documents } = await api(
        `/documents?workspaceId=${encodeURIComponent(requireWorkspace())}`,
      );
      for (const doc of documents) {
        console.log(
          `${doc.status.padEnd(10)} ${String(doc.fileType ?? '?').padEnd(5)} ` +
            `${String(doc.chunkCount).padStart(4)} chunks  ${quote(doc.title)}` +
            (doc.errorMessage ? `  [${quote(doc.errorMessage, 60)}]` : ''),
        );
      }
      return;
    }
    case 'search': {
      const query = positional()[0];
      if (!query) throw new Error('Usage: search "query" --workspace <id>');
      const result = await api(
        `/search?workspaceId=${encodeURIComponent(requireWorkspace())}` +
          `&q=${encodeURIComponent(query)}` +
          (flag('limit') ? `&limit=${Number(flag('limit'))}` : ''),
      );
      console.log(`query: ${result.query}\n`);
      for (const [index, source] of result.sources.entries()) {
        const where = [
          source.page != null ? `p.${source.page}` : null,
          source.headingPath?.length ? source.headingPath.join(' > ') : null,
        ]
          .filter(Boolean)
          .join(' · ');
        console.log(
          `[${index + 1}] ${source.title}${where ? ` (${where})` : ''}  ${(source.similarity * 100).toFixed(0)}%`,
        );
        console.log(`    ${quote(source.content, 160)}\n`);
      }
      return;
    }
    case 'ask': {
      const question = positional()[0];
      if (!question) throw new Error('Usage: ask "question" --workspace <id>');
      const result = await api('/ask', {
        method: 'POST',
        body: { workspaceId: requireWorkspace(), question },
      });
      console.log(result.answer);
      const cited = (result.sources ?? []).filter((s: any) => s.cited);
      if (cited.length > 0) {
        console.log('\nSources:');
        for (const source of cited) {
          console.log(
            `  · ${source.title}${source.page ? `, p.${source.page}` : ''}`,
          );
        }
      }
      console.log(
        `\n${result.timings.totalMs}ms (retrieval ${result.timings.retrievalMs}ms, ` +
          `first token ${result.timings.firstTokenMs ?? '–'}ms)`,
      );
      return;
    }
    case 'upload': {
      const file = positional()[0];
      if (!file) throw new Error('Usage: upload <file> --workspace <id>');
      const info = await stat(file);
      const form = new FormData();
      form.append('workspaceId', requireWorkspace());
      form.append(
        'file',
        new Blob([await readFile(file)]),
        path.basename(file),
      );
      const res = await fetch(`${baseUrl}/api/v1/documents`, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}` },
        body: form,
      });
      const body = (await res.json()) as any;
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      console.log(
        `${body.duplicate ? 'already indexed' : 'uploaded'} ${body.document.id} ` +
          `(${info.size} bytes, ${body.document.fileType})`,
      );
      return;
    }
    case 'url': {
      const url = positional()[0];
      if (!url) throw new Error('Usage: url <http(s)://...> --workspace <id>');
      const result = await api('/urls', {
        method: 'POST',
        body: { workspaceId: requireWorkspace(), url },
      });
      console.log(
        `${result.duplicate ? 'already imported' : 'imported'} "${result.title}" ` +
          `(${result.wordCount} words, ${result.kind})`,
      );
      return;
    }
    case 'due': {
      const { cards } = await api(
        `/reviews/due?workspaceId=${encodeURIComponent(requireWorkspace())}`,
      );
      for (const card of cards) {
        console.log(`${card.id}  [${card.deckName}]  ${quote(card.front)}`);
        console.log(`    ${quote(card.back, 120)}`);
      }
      if (cards.length === 0) console.log('No cards due.');
      return;
    }
    case 'review': {
      const [cardId, rating] = positional();
      if (!cardId || !rating) {
        throw new Error('Usage: review <cardId> <again|hard|good|easy>');
      }
      const result = await api('/reviews', {
        method: 'POST',
        body: { cardId, rating },
      });
      console.log(
        `next due ${new Date(result.nextDueAt).toLocaleString()} · ${result.remaining} remaining`,
      );
      return;
    }
    case 'note': {
      const title = positional()[0];
      if (!title)
        throw new Error('Usage: note "Title" --workspace <id> --content "..."');
      const result = await api('/notes', {
        method: 'POST',
        body: {
          workspaceId: requireWorkspace(),
          title,
          contentMd: flag('content') ?? '',
        },
      });
      console.log(`created note ${result.note.id}`);
      return;
    }
    case undefined:
    case 'help':
    case '--help':
      console.log(
        [
          'Nexus CLI — commands:',
          '  workspaces                          list workspaces',
          '  documents --workspace <id>          list documents',
          '  search "query" --workspace <id>     hybrid search',
          '  ask "question" --workspace <id>     grounded answer',
          '  upload <file> --workspace <id>      upload a document',
          '  url <url> --workspace <id>          import an article/YouTube',
          '  due --workspace <id>                due flashcards',
          '  review <cardId> <rating>            grade a card',
          '  note "Title" --workspace <id>       create a note',
          '',
          'Env: NEXUS_BASE_URL, NEXUS_API_KEY (or --base/--key).',
        ].join('\n'),
      );
      return;
    default:
      throw new Error(`Unknown command: ${command}. Run with --help.`);
  }
}

void main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
