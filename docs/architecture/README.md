# Architecture

Nexus is a **modular monolith**: one API process, one worker process and one static frontend, backed by Postgres (with pgvector) and Redis, plus an optional S3-compatible bucket and an optional local Whisper service. The module boundaries are recorded in [ADR 0006](../decisions/0006-modular-monolith.md) and enforced by lint.

## Processes

| Process  | Entry point                                             | Responsibility                                                                       |
| -------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| API      | `apps/backend/src/index.ts` → `main.ts` → `http/app.ts` | HTTP (REST v1, REST surfaces, tRPC), WebSocket subscriptions, session/API-key auth   |
| Worker   | `apps/backend/src/entrypoints/worker.ts`                | BullMQ consumers: parse/OCR/transcribe, embed, webhook delivery, trash and retention |
| Frontend | `apps/frontend`                                         | React SPA (Vite), installable PWA, service worker                                    |

`main.ts` owns process concerns (database wait, migrations, local-account preparation, servers, graceful shutdown). `http/app.ts` builds the Express application and does no I/O, so it can be constructed in tests.

## Request paths

- **tRPC** (`/trpc`) — the UI's API. Context resolves the session cookie (or the local user when auth is disabled); procedures are grouped by module namespace.
- **REST v1** (`/api/v1`) — integration surface for scripts and agents. API-key auth only (session cookies are ignored), scoped per route; see [docs/api](../api/README.md).
- **REST surfaces** (`/api/upload`, `/api/ingest/url`, `/api/transcribe`, `/api/tts`, `/api/images/:id`, `/api/audio/:id`, `/api/workspace/import`, `/api/workspaces/:id/export.zip`, `/api/share/:token`) — binary or streaming routes that tRPC is a poor fit for.
- **Public share** (`/api/share/:token`) — bearer capability, rate limited, no session.
- **WebSocket** (`/ws`) — chat token streaming; the same tRPC router with a WS context.
- **Ops** — `/healthz` (Postgres + Redis probe), `/metrics` (Prometheus, optionally bearer-protected).

## Backend modules

| Module       | Owns                                                                                    | Notes                                                  |
| ------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `workspaces` | workspaces, members, roles, share links, archive import/export                          | "Topic" in the UI, `workspace` in the API and database |
| `documents`  | documents, chunks, upload, source text                                                  | duplicate detection by content hash                    |
| `ingestion`  | parsers, magic-byte detection, OCR, vision, URL/YouTube ingestion, chunking, embeddings | queue producers                                        |
| `retrieval`  | hybrid search, retrieval profiles, inspector payloads                                   | pgvector + full-text                                   |
| `chat`       | conversations, messages, streaming answers, personas, provider client                   | grounded prompt assembly                               |
| `study`      | decks, cards, reviews (FSRS), notes, quizzes, artifacts                                 | review scheduling                                      |
| `language`   | vocabulary, dictation, pronunciation, CEFR estimates                                    |                                                        |
| `voice`      | speech-to-text, text-to-speech, audio assets                                            |                                                        |
| `vision`     | image chat modes and on-demand analysis                                                 | uses `ingestion` vision service                        |
| `settings`   | settings registry, queue admin, storage self-test, provider secrets                     | encrypted at rest                                      |
| `api-keys`   | scoped `ndx_…` keys                                                                     | hashed, shown once                                     |
| `webhooks`   | signed delivery on indexing events                                                      |                                                        |
| `dashboard`  | cross-topic aggregate                                                                   |                                                        |
| `packs`      | first-party bundled content                                                             | inert data, no code                                    |

`platform/` holds infrastructure with no domain knowledge (config, auth, storage drivers, queue, observability, errors, env). `shared/` holds primitives several modules use. `db/schema/` mirrors the module split.

## Frontend

| Path                      | Contents                                                             |
| ------------------------- | -------------------------------------------------------------------- |
| `src/app/`                | React root and the shell (navigation, auth gate, layout, lazy pages) |
| `src/features/<feature>/` | screens, panels, dialogs, hooks and API calls for one area           |
| `src/platform/`           | tRPC client, session handling, offline queue                         |
| `src/components/`         | cross-feature components (Markdown, Toast, ErrorBoundary, logo)      |
| `src/ui/`                 | presentation primitives (Button, Field, Panel)                       |

## Adding a feature

1. Backend: add `modules/<context>/` (router, service, tests) and register the router in `http/trpc.ts`; add tables under `db/schema/<context>.ts` and run `pnpm --filter @nexus/backend db:generate`.
2. Contracts: add request/response zod schemas to `packages/contracts/src/contracts/`.
3. Frontend: add or extend `src/features/<feature>/`; reuse `src/ui` primitives; call the tRPC namespace.
4. Tests: service unit test, smoke assertion if an endpoint changed, Playwright if a user flow changed.
5. Docs: update this file when a module is added, the API doc when a route changes, and the changelog at release.
