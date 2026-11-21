#!/usr/bin/env node
/**
 * Nexus MCP server (P-5).
 *
 * Exposes the workspace to MCP clients (Claude Desktop, coding agents, ...)
 * over the stdio JSON-RPC transport, backed by the scoped REST API. Nothing
 * here bypasses the API: the same key, scopes, ownership checks and retrieval
 * apply, so an agent can never do more than the key allows.
 *
 * Configure the client with:
 *   command: pnpm
 *   args: ["--filter", "@nexus/backend", "mcp"]
 *   env: { NEXUS_BASE_URL: "http://localhost:3000", NEXUS_API_KEY: "ndx_..." }
 *
 * stdout is the protocol; logs go to stderr.
 */
import { createInterface } from 'node:readline';

const BASE_URL = (
  process.env.NEXUS_BASE_URL ?? 'http://localhost:3000'
).replace(/\/$/, '');
const API_KEY = process.env.NEXUS_API_KEY ?? '';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOLS: ToolDefinition[] = [
  {
    name: 'list_workspaces',
    description:
      'List the Nexus workspaces the API key can see, with document counts.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'list_documents',
    description:
      'List documents in a workspace: title, detected format, status, chunk count, source URL and ingestion metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Workspace UUID' },
      },
      required: ['workspaceId'],
      additionalProperties: false,
    },
  },
  {
    name: 'search',
    description:
      'Hybrid (vector + keyword) search over a workspace. Returns the retrieved chunks with document title, page, heading path and scores.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Workspace UUID' },
        query: { type: 'string', description: 'Search query' },
        limit: {
          type: 'number',
          description: 'Maximum sources to return (1-50, default 10)',
        },
      },
      required: ['workspaceId', 'query'],
      additionalProperties: false,
    },
  },
  {
    name: 'ask',
    description:
      'Ask a grounded question about a workspace. The answer cites the retrieved sources by number.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Workspace UUID' },
        question: { type: 'string', description: 'Question to answer' },
      },
      required: ['workspaceId', 'question'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_note',
    description:
      'Create a Markdown note in a workspace (useful for capturing an answer or a research summary).',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Workspace UUID' },
        title: { type: 'string', description: 'Note title' },
        contentMd: { type: 'string', description: 'Markdown body' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags (max 10)',
        },
      },
      required: ['workspaceId', 'title'],
      additionalProperties: false,
    },
  },
];

async function callApi(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  const res = await fetch(`${BASE_URL}/api/v1${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${API_KEY}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const parsed = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const message =
      parsed && typeof parsed === 'object' && 'error' in parsed
        ? String((parsed as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return parsed;
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case 'list_workspaces':
      return callApi('/workspaces');
    case 'list_documents':
      return callApi(
        `/documents?workspaceId=${encodeURIComponent(String(args.workspaceId ?? ''))}`,
      );
    case 'search':
      return callApi(
        `/search?workspaceId=${encodeURIComponent(String(args.workspaceId ?? ''))}` +
          `&q=${encodeURIComponent(String(args.query ?? ''))}` +
          (args.limit ? `&limit=${Number(args.limit)}` : ''),
      );
    case 'ask':
      return callApi('/ask', {
        method: 'POST',
        body: {
          workspaceId: args.workspaceId,
          question: args.question,
        },
      });
    case 'create_note':
      return callApi('/notes', {
        method: 'POST',
        body: {
          workspaceId: args.workspaceId,
          title: args.title,
          contentMd: args.contentMd ?? '',
          tags: Array.isArray(args.tags) ? args.tags : [],
        },
      });
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(request: JsonRpcRequest): Promise<void> {
  const isNotification = request.id === undefined;
  const reply = (result: unknown): void => {
    if (isNotification) return;
    send({ jsonrpc: '2.0', id: request.id, result });
  };
  const fail = (code: number, message: string): void => {
    if (isNotification) return;
    send({ jsonrpc: '2.0', id: request.id, error: { code, message } });
  };

  switch (request.method) {
    case 'initialize':
      reply({
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'nexus', version: '0.4.7' },
      });
      return;
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return;
    case 'ping':
      reply({});
      return;
    case 'tools/list':
      reply({ tools: TOOLS });
      return;
    case 'tools/call': {
      const name = String(request.params?.name ?? '');
      const args = (request.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = await callTool(name, args);
        reply({
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        });
      } catch (err) {
        reply({
          content: [
            {
              type: 'text',
              text: err instanceof Error ? err.message : String(err),
            },
          ],
          isError: true,
        });
      }
      return;
    }
    default:
      fail(-32601, `Method not found: ${request.method}`);
  }
}

if (!API_KEY) {
  console.error(
    '[nexus-mcp] NEXUS_API_KEY is not set. Create a key in Settings -> API keys and pass it in the MCP server env.',
  );
  process.exit(1);
}

const reader = createInterface({ input: process.stdin, crlfDelay: Infinity });
reader.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(trimmed) as JsonRpcRequest;
  } catch {
    send({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    });
    return;
  }
  void handle(request).catch((err: unknown) => {
    send({
      jsonrpc: '2.0',
      id: request.id ?? null,
      error: {
        code: -32603,
        message: err instanceof Error ? err.message : 'Internal error',
      },
    });
  });
});
console.error(`[nexus-mcp] ready (${BASE_URL})`);
