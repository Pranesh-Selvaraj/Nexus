# Nexus

> Full-stack AI RAG workspace with hybrid search, real-time streaming, and queue-based document indexing.

Nexus is a self-hosted RAG (Retrieval-Augmented Generation) workspace. Upload documents into workspaces, have them chunked, embedded, and indexed asynchronously, then chat with your documents over a real-time WebSocket connection backed by hybrid (vector + keyword) search.

[![Release](https://img.shields.io/github/v/release/Pranesh-Selvaraj/Nexus?sort=semver)](https://github.com/Pranesh-Selvaraj/Nexus/releases)
[![CI](https://github.com/Pranesh-Selvaraj/Nexus/actions/workflows/ci.yml/badge.svg)](https://github.com/Pranesh-Selvaraj/Nexus/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Pranesh-Selvaraj/Nexus/actions/workflows/codeql.yml/badge.svg)](https://github.com/Pranesh-Selvaraj/Nexus/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

---

## Table of contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Scripts](#scripts)
- [Environment variables](#environment-variables)
- [Project structure](#project-structure)
- [CI/CD and security](#cicd-and-security)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

## Features

- 📁 **Workspaces** — organize documents into isolated workspaces.
- 📤 **Document ingestion** — upload PDF, DOCX, TXT, Markdown, CSV, and JSON files (up to 25 MB each).
- 🔄 **Queue-based indexing** — documents are chunked and embedded by a background BullMQ worker, so the API stays responsive.
- 🔍 **Hybrid search** — combines vector similarity (pgvector) with keyword search for robust retrieval, with a Redis query-embedding cache (24h TTL) so repeated questions skip the embedding round-trip.
- 💬 **RAG chat** — streamed, context-grounded answers over WebSocket, with per-answer **token usage** and LLM-generated conversation titles.
- 📦 **Backup & restore** — export any workspace (documents + chat history) as JSON and import it back
- 🔐 **Optional authentication** — set `AUTH_PASSWORD` for a login screen with httpOnly session cookies (expired sessions are purged daily); unset for single-user dev mode.
- 🧱 **Monorepo** — pnpm workspaces + Turborepo for fast, cached builds.

## Architecture

```
┌────────────────────┐   HTTP /trpc + WS /ws   ┌──────────────────────────────┐
│  apps/frontend     │ ──────────────────────▶ │  apps/backend  (Express)     │
│  React + tRPC +    │                         │  tRPC router + uploads       │
│  React Query       │                         └──────────────┬───────────────┘
└────────────────────┘                                          │ enqueue
                                                               ▼
                                               ┌──────────────────────────────┐
                                               │  BullMQ (Redis)              │
                                               │  embedding.worker            │
                                               └──────────────┬───────────────┘
                                                              │ chunk + embed
                                                              ▼
                                               ┌──────────────────────────────┐
                                               │  PostgreSQL + pgvector       │
                                               │  (documents, chunks, chat)   │
                                               └──────────────────────────────┘
```

## Tech stack

| Layer    | Technology                                                                |
| -------- | ------------------------------------------------------------------------- |
| Frontend | React 18, Vite 8, TypeScript, Tailwind CSS 4, tRPC v11, TanStack Query v5 |
| Backend  | Node.js, Express, tRPC, Drizzle ORM, BullMQ, LangChain, OpenAI            |
| Data     | PostgreSQL 16 + pgvector, Redis 7                                         |
| Tooling  | pnpm, Turborepo, Docker Compose                                           |

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org) 20+ (22 recommended)
- [pnpm](https://pnpm.io) 11.x
- [Docker](https://www.docker.com) with Docker Compose (for Postgres + Redis)
- An [OpenAI API key](https://platform.openai.com/api-keys)

### 1. Install and start dependencies

```bash
pnpm install
pnpm db:up        # starts postgres (pgvector) + redis in Docker
```

### 2. Configure environment

```bash
cp .env.example .env
```

Then edit `.env` and set a real `OPENAI_API_KEY`. The defaults work out of the box for local development (optionally set `AUTH_PASSWORD` to enable the login screen).

### 3. Migrate the database

```bash
pnpm --filter @nexus/backend db:migrate
```

### 4. Run the dev servers

```bash
pnpm dev         # starts frontend (Vite :5173), API (:3000), and worker
```

Open http://localhost:5173 and start a workspace.

### Docker-only quick start

Postgres and Redis run through `docker-compose.yml`. For the full stack (UI + API + worker) in containers, see [Deployment](#deployment).

## Deployment

### Option A — prebuilt images from GHCR (recommended)

Every release publishes the images to the GitHub Container Registry. Pull them directly:

| Image        | Pull command                                                |
| ------------ | ----------------------------------------------------------- |
| API + worker | `docker pull ghcr.io/pranesh-selvaraj/nexus-backend:1.0.0`  |
| Frontend     | `docker pull ghcr.io/pranesh-selvaraj/nexus-frontend:1.0.0` |

Pin a version in production; `latest` tracks the newest release. (Note: the container tags are semver without the `v` prefix — `1.0.0`, not `v1.0.0`.)

### Option B — build from source

```bash
cp .env.example .env        # set OPENAI_API_KEY (and AUTH_PASSWORD for login)
docker compose -f docker-compose.prod.yml up -d --build
```

### Running the stack

Either way, the UI is served at **http://localhost:8080** with `/trpc`, `/api` and `/ws` reverse-proxied to the backend (same origin, no CORS):

- `backend` — multi-stage `node:22-slim` image (non-root `node` user, native TS type-stripping for `@nexus/shared-types`, migrations run on boot, `/healthz` dependency probe)
- `worker` — same image, BullMQ embedding worker (process-liveness healthcheck)
- `frontend` — `nginx:1.27-alpine` serving the built SPA with SPA fallback
- `postgres` (pgvector) and `redis` with healthchecks; uploaded documents persist in the `nexus-uploads` volume

Stop/update:

```bash
docker compose -f docker-compose.prod.yml down                         # stop
docker compose -f docker-compose.prod.yml up -d --build                # rebuild from source
```

> 💡 Point `UPLOAD_DIR` at the shared volume if you run the worker on a different host than the API.

### Authentication in production

Set `AUTH_PASSWORD` in `.env` **before** the first boot — the login screen appears automatically when auth is enabled. Behind TLS, also set `AUTH_COOKIE_SECURE=true`. See [SECURITY.md](SECURITY.md) for the full threat model.

### Keeping it private

See [SECURITY.md](SECURITY.md) — without `AUTH_PASSWORD` the app runs in single-user no-auth mode and should sit behind a reverse proxy.

## Releases

Releases follow [SemVer](https://semver.org/), tagged `vX.Y.Z` and published automatically from the [release workflow](.github/workflows/release.yml): pushing a tag builds the images, publishes them to GHCR, and creates a GitHub Release with changelog notes.

```bash
git tag v1.0.0 && git push origin v1.0.0
```

## Scripts

| Command                                    | Description                                 |
| ------------------------------------------ | ------------------------------------------- |
| `pnpm dev`                                 | Run frontend, API, and worker in watch mode |
| `pnpm build`                               | Type-check and build all packages           |
| `pnpm typecheck`                           | Type-check all packages                     |
| `pnpm db:up` / `pnpm db:down`              | Start / stop Postgres + Redis (Docker)      |
| `pnpm --filter @nexus/backend db:migrate`  | Apply Drizzle migrations                    |
| `pnpm --filter @nexus/backend db:generate` | Generate a new Drizzle migration            |
| `pnpm --filter @nexus/backend dev:api`     | Run only the API in watch mode              |
| `pnpm --filter @nexus/backend dev:worker`  | Run only the embedding worker in watch mode |

## Environment variables

All variables live in `.env` (see `.env.example`). The backend auto-discovers `.env` at the repo root or package root.

| Variable                    | Default                                       | Description                                                                                                                                           |
| --------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`              | `postgres://nexus:nexus@localhost:5432/nexus` | PostgreSQL + pgvector connection string                                                                                                               |
| `REDIS_URL`                 | `redis://localhost:6379`                      | Redis connection string (BullMQ)                                                                                                                      |
| `OPENAI_API_KEY`            | —                                             | OpenAI API key (required only without a base URL)                                                                                                     |
| `OPENAI_BASE_URL`           | _(unset)_                                     | OpenAI-compatible base URL for chat (Ollama, OpenCode Zen, LM Studio, OpenRouter, ...) - enables keyless local mode                                   |
| `OPENAI_MODEL`              | `gpt-4o-mini`                                 | Chat model                                                                                                                                            |
| `OPENAI_EMBEDDING_MODEL`    | `text-embedding-3-small`                      | Embedding model                                                                                                                                       |
| `OPENAI_EMBEDDING_BASE_URL` | _(unset)_                                     | OpenAI-compatible base URL for a separate embedding provider (required for chat-only providers such as OpenCode Zen); falls back to `OPENAI_BASE_URL` |
| `OPENAI_EMBEDDING_API_KEY`  | —                                             | API key for the embedding provider; falls back to `OPENAI_API_KEY`                                                                                    |
| `LOCAL_USER_EMAIL`          | `local@nexus.dev`                             | Identity of the single local user                                                                                                                     |
| `AUTH_PASSWORD`             | _(unset)_                                     | When set, login is required (httpOnly session cookie); unset = no-auth dev mode                                                                       |
| `AUTH_COOKIE_SECURE`        | `false`                                       | `true` when serving over HTTPS (adds `Secure` to the session cookie)                                                                                  |
| `SESSION_TTL_DAYS`          | `30`                                          | Session lifetime in days                                                                                                                              |
| `PORT`                      | `3000`                                        | Backend HTTP/WS port                                                                                                                                  |
| `UPLOAD_DIR`                | `./uploads`                                   | Directory for uploaded documents                                                                                                                      |
| `MAX_UPLOAD_MB`             | `25`                                          | Per-file upload size limit                                                                                                                            |
| `FRONTEND_ORIGIN`           | `http://localhost:5173`                       | Allowed CORS origin                                                                                                                                   |

> ⚠️ Never commit a real `.env` file. It is git-ignored and scanned for secrets in CI (gitleaks).

## Scale & performance

Nexus targets single-user, self-hosted personal corpora. The honest envelope:

| Dimension   | Limit                     | Notes                                                                                                                                                                                                                 |
| ----------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Uploads     | 25 MB/file (configurable) | Parsed server-side, chunked, embedded asynchronously                                                                                                                                                                  |
| Retrieval   | exact vector scans        | No ANN index - `ORDER BY embedding <=> $q LIMIT k` scans the workspace's chunks. Sub-second up to roughly **100k chunks per workspace** (≈ 2–4k documents at default chunk size); beyond that, expect linear slowdown |
| History     | unbounded queries         | Conversation lists and message histories load fully; fine at personal scale                                                                                                                                           |
| Query cache | Redis, 24h TTL            | Query embeddings are cached keyed by model + text hash; switching embedding models invalidates automatically                                                                                                          |
| Maintenance | daily 03:00               | Expired sessions are purged by a BullMQ repeat job                                                                                                                                                                    |

**Tuning knobs** (Settings → Retrieval): smaller `chunk size` → more chunks but finer granularity; lower `top-K` → faster retrieval; adjust vector/keyword weights per corpus. For corpora beyond the envelope, the pragmatic path is partitioning workspaces (retrieval is scoped per workspace) rather than one giant workspace.

## LLM providers

Nexus speaks the OpenAI API protocol, so any OpenAI-compatible endpoint works — set **API base URL** in Settings (or `OPENAI_BASE_URL`):

> ℹ️ The base URL is the **root** of the API (e.g. `https://opencode.ai/zen/go/v1`) — **not** the full `/chat/completions` endpoint. Nexus appends `/chat/completions`, `/models` and `/embeddings` itself; URLs ending in an endpoint path are rejected with the corrected URL to paste.

| Provider                                                        | Base URL                         |
| --------------------------------------------------------------- | -------------------------------- |
| OpenAI (default)                                                | _(empty)_                        |
| [OpenCode Zen](https://opencode.ai/zen) (chat only)             | `https://opencode.ai/zen/v1`     |
| [OpenCode Zen Go](https://opencode.ai/zen) (Go plan, chat only) | `https://opencode.ai/zen/go/v1`  |
| [Ollama](https://ollama.com) (local, free)                      | `http://localhost:11434/v1`      |
| [LM Studio](https://lmstudio.ai) (local)                        | `http://localhost:1234/v1`       |
| [OpenRouter](https://openrouter.ai)                             | `https://openrouter.ai/api/v1`   |
| [Groq](https://groq.com)                                        | `https://api.groq.com/openai/v1` |
| Any other OpenAI-compatible endpoint                            | type it into **API base URL**    |

With a local provider, use a compatible model name (e.g. `llama3.1`) for chat and an embedding model served by the same endpoint. Set the embedding model's **dimensions** in Settings (the `chunks.embedding` column is dimension-flexible). Use the **Test connection** and **Fetch chat models / Fetch embedding models** buttons to verify.

### Chat-only providers (separate embedding provider)

Some providers — notably **OpenCode Zen** — serve chat models but have **no embeddings endpoint**. Since Nexus embeds both indexed documents and chat queries, point the embedding settings at a provider that does serve embeddings (OpenAI, Ollama, LM Studio, ...):

| Setting (or env var)                             | OpenCode Zen example                            |
| ------------------------------------------------ | ----------------------------------------------- |
| API base URL (`OPENAI_BASE_URL`)                 | `https://opencode.ai/zen/v1`                    |
| API key (`OPENAI_API_KEY`)                       | OpenCode Zen key                                |
| Chat model (`OPENAI_MODEL`)                      | `kimi-k3`, `deepseek-v4-pro`, ...               |
| Embedding base URL (`OPENAI_EMBEDDING_BASE_URL`) | `https://api.openai.com/v1` (or a local server) |
| Embedding API key (`OPENAI_EMBEDDING_API_KEY`)   | OpenAI key (not needed for local)               |
| Embedding model (`OPENAI_EMBEDDING_MODEL`)       | `text-embedding-3-small`                        |

Notes for OpenCode Zen:

- Only models served over `/chat/completions` work (e.g. `kimi-k3`, `deepseek-v4-pro`, `glm-5`, `minimax-m3`); Anthropic/OpenAI-protocol-only models (Claude, GPT, Grok on Zen) are routed through other endpoints and will fail — the **Test connection** button reports this clearly.
- Zen's `/models` endpoint is public, so the connection test also sends a tiny chat completion to validate the key and model.
- **Go plan**: use the **OpenCode Zen Go** preset (base URL `https://opencode.ai/zen/go/v1`). The Go endpoint serves its own model list (`kimi-k3`, `kimi-k2.7-code`, `glm-5.*`, `minimax-m3`, `longcat-2.0`, `mimo-v2*`, `qwen3.x`, ...) — use **Fetch chat models** to see it and **Test connection** to verify a model is actually served over `/chat/completions`.

## Local LLMs (no API key needed)

Point Nexus at any OpenAI-compatible local server — **no API key required**:

1. **Settings → Provider → Ollama** (or set `OPENAI_BASE_URL` in `.env`)
2. Pull a chat model and an embedding model, e.g.:
   ```bash
   ollama pull llama3.1
   ollama pull nomic-embed-text     # 768-dim embeddings
   ```
3. In Settings: chat model = `llama3.1`, embedding model = `nomic-embed-text`, **Embedding dimensions = 768**, then **Fetch chat models** to verify, and **Test connection**
4. Upload a document — chunks are embedded locally and indexed with the matching dimension

Notes:

- The `chunks.embedding` column is dimension-flexible (migration 0005); the worker validates every vector against the **Embedding dimensions** setting (default 1536 for OpenAI).
- Embeddings are requested as `encoding_format: float` so plain-float local servers (Ollama/LM Studio) work with the OpenAI SDK's base64 default.
- Changing the embedding model/dimensions re-indexes: delete the document and re-upload (or use the retry button after changing settings).
- Retrieval uses exact vector scans (the fixed-dimension HNSW index was removed) — fine at personal-corpus scale.
- **LM Studio**: base URL `http://localhost:1234/v1` (no key needed). **OpenRouter/Groq/OpenCode Zen**: preset buttons; OpenCode Zen additionally needs a separate embedding provider (see above).

## Settings panel

Most configuration can be managed from the **Settings** page in the UI (sidebar → Settings) — no `.env` edits or restarts needed:

| Group      | Settings                                                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Provider   | API key (AES-256-GCM encrypted at rest), API base URL (any OpenAI-compatible provider), chat model, embedding model, embedding base URL + key (for a separate embedding provider), **embedding dimensions**, temperature |
| Retrieval  | chunk size, chunk overlap, sources retrieved (top-K), vector/keyword weights, **search language** (28 PostgreSQL FTS configs)                                                                                            |
| Server     | max upload size                                                                                                                                                                                                          |
| Auth       | session lifetime (days)                                                                                                                                                                                                  |
| Appearance | app name (sidebar + browser title), **system prompt**                                                                                                                                                                    |

Precedence: **UI value → environment variable → default**. Emptying a field resets it to the env/default. Secret settings require `SETTINGS_SECRET` in `.env` (the encryption key); the "Test connection" button verifies the chat and embedding providers end to end (a tiny completion, a real embedding, and the returned vector dimensions), and the "Fetch chat models" / "Fetch embedding models" buttons list the models each provider serves.

## Project structure

```
apps/
  backend/          Express + tRPC API, BullMQ worker, Drizzle schema/migrations
  frontend/         React + Vite SPA (tRPC client, workspaces, upload, chat)
packages/
  shared-types/     Shared DTO types between apps
.github/
  workflows/        CI, CodeQL
  dependabot.yml    Automated dependency update PRs
```

## CI/CD and security

| Guard                                                   | Where                  | Enforced on `main` |
| ------------------------------------------------------- | ---------------------- | ------------------ |
| Type checking (`pnpm typecheck`)                        | `ci.yml`               | ✅ required        |
| Production build (`pnpm build`)                         | `ci.yml`               | ✅ required        |
| Linting + formatting (`pnpm lint`, `pnpm format:check`) | `ci.yml`               | ✅ required        |
| Unit tests (`pnpm test`)                                | `ci.yml`               | ✅ required        |
| Integration smoke (real stack + mock OpenAI)            | `ci.yml`               | ✅ required        |
| Browser e2e (Playwright happy path)                     | `ci.yml`               | ✅ required        |
| Docs & issue link check (PRs)                           | `ci.yml`               | ✅ required        |
| Secret scanning (gitleaks)                              | `ci.yml`               | ✅ required        |
| Dependency review on PRs                                | `ci.yml`               | ✅ required        |
| CodeQL static analysis (incl. weekly)                   | `codeql.yml`           | runs on push/PR    |
| `pnpm audit` (dependency advisories)                    | `ci.yml` — fail-closed | ✅ required        |
| Dependabot (npm + GitHub Actions)                       | `dependabot.yml`       | —                  |

### Branch protection

The `main` branch is protected — **direct commits are only possible by the repository owner**. All other contributors must open a pull request that:

1. passes required CI checks (`typecheck`, `build`, `Lint`, `Test`, `Smoke test`, `E2E (Playwright)`, `Docs & issue link check`, `Secret scan`, `Dependency review`, `Dependency audit`),
2. is approved by the repository owner (CODEOWNERS), and
3. has no stale reviews, force-pushes, or deleted protection.

**Release tags** (`v*`) are protected by an active ruleset: only the repository owner (admin) can create, update, or delete them — the release pipeline (GHCR images + GitHub Release) can therefore only be triggered by the owner.

## Contributing

All work is tracked in [GitHub issues](https://github.com/Pranesh-Selvaraj/Nexus/issues) — every PR links its issue and ships the documentation updates it requires. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow: environment setup, branching strategy, PR checklist, and commit conventions.

## Security

Found a vulnerability? Please **do not open a public issue**. Report it privately — see [SECURITY.md](SECURITY.md) for the process and supported versions.

## Issue tracker

All bugs, enhancements, and planned work are tracked as **GitHub issues** — there is no roadmap section in this README.

- Browse or open issues: [github.com/Pranesh-Selvaraj/Nexus/issues](https://github.com/Pranesh-Selvaraj/Nexus/issues)
- Upcoming work carries the [`roadmap` label](https://github.com/Pranesh-Selvaraj/Nexus/labels/roadmap)
- Small, well-scoped tasks for new contributors carry the [`good first issue` label](https://github.com/Pranesh-Selvaraj/Nexus/labels/good%20first%20issue)

**Project convention**: every pull request must link the issue(s) it resolves and must include the documentation updates it requires (README, SECURITY.md, `.env.example`, CONTRIBUTING) in the same merge — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT © [Pranesh Selvaraj](https://github.com/Pranesh-Selvaraj) — see [LICENSE](LICENSE).
