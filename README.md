# Nexus

> Full-stack AI RAG workspace with hybrid search, real-time streaming, and queue-based document indexing.

Nexus is a single-user, self-hosted RAG (Retrieval-Augmented Generation) workspace. Upload documents into workspaces, have them chunked, embedded, and indexed asynchronously, then chat with your documents over a real-time WebSocket connection backed by hybrid (vector + keyword) search.

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
- 📤 **Document ingestion** — upload PDF, TXT, Markdown, CSV, and JSON files (up to 25 MB each).
- 🔄 **Queue-based indexing** — documents are chunked and embedded by a background BullMQ worker, so the API stays responsive.
- 🔍 **Hybrid search** — combines vector similarity (pgvector) with keyword search for robust retrieval.
- 💬 **RAG chat** — streamed, context-grounded answers over WebSocket.
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

Then edit `.env` and set a real `OPENAI_API_KEY`. The defaults work out of the box for local development.

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

### Production stack (Docker)

The production stack builds the backend, worker, and a static nginx-served frontend:

```bash
cp .env.example .env        # set OPENAI_API_KEY (and AUTH_* if enabled)
docker compose -f docker-compose.prod.yml up -d --build
```

The UI is served at **http://localhost:8080** with `/trpc`, `/api` and `/ws` reverse-proxied to the backend (same origin, no CORS). The stack includes:

- `backend` — multi-stage `node:22-slim` image (non-root `node` user, native TS type-stripping for `@nexus/shared-types`, migrations run on boot, `/healthz` dependency probe)
- `worker` — same image, BullMQ embedding worker (process-liveness healthcheck)
- `frontend` — `nginx:1.27-alpine` serving the built SPA with SPA fallback
- `postgres` (pgvector) and `redis` with healthchecks; uploaded documents persist in the `nexus-uploads` volume

```bash
docker compose -f docker-compose.prod.yml down        # stop
docker compose -f docker-compose.prod.yml up -d --build # rebuild after updates
```

> 💡 Point `UPLOAD_DIR` at the shared volume if you run the worker on a different host than the API.

### Keeping it private

See [SECURITY.md](SECURITY.md) — without authentication enabled the app is single-user and should sit behind a reverse proxy.

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

| Variable                 | Default                                       | Description                                                                     |
| ------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------- |
| `DATABASE_URL`           | `postgres://nexus:nexus@localhost:5432/nexus` | PostgreSQL + pgvector connection string                                         |
| `REDIS_URL`              | `redis://localhost:6379`                      | Redis connection string (BullMQ)                                                |
| `OPENAI_API_KEY`         | —                                             | OpenAI API key (required for embeddings + chat)                                 |
| `OPENAI_MODEL`           | `gpt-4o-mini`                                 | Chat model                                                                      |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small`                      | Embedding model                                                                 |
| `LOCAL_USER_EMAIL`       | `local@nexus.dev`                             | Identity of the single local user                                               |
| `AUTH_PASSWORD`          | _(unset)_                                     | When set, login is required (httpOnly session cookie); unset = no-auth dev mode |
| `AUTH_COOKIE_SECURE`     | `false`                                       | `true` when serving over HTTPS (adds `Secure` to the session cookie)            |
| `SESSION_TTL_DAYS`       | `30`                                          | Session lifetime in days                                                        |
| `PORT`                   | `3000`                                        | Backend HTTP/WS port                                                            |
| `UPLOAD_DIR`             | `./uploads`                                   | Directory for uploaded documents                                                |
| `MAX_UPLOAD_MB`          | `25`                                          | Per-file upload size limit                                                      |
| `FRONTEND_ORIGIN`        | `http://localhost:5173`                       | Allowed CORS origin                                                             |

> ⚠️ Never commit a real `.env` file. It is git-ignored and scanned for secrets in CI (gitleaks).

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
| Secret scanning (gitleaks)                              | `ci.yml`               | ✅ required        |
| Dependency review on PRs                                | `ci.yml`               | ✅ required        |
| CodeQL static analysis (incl. weekly)                   | `codeql.yml`           | runs on push/PR    |
| `pnpm audit` (dependency advisories)                    | `ci.yml` — fail-closed | ✅ required        |
| Dependabot (npm + GitHub Actions)                       | `dependabot.yml`       | —                  |

### Branch protection

The `main` branch is protected — **direct commits are only possible by the repository owner**. All other contributors must open a pull request that:

1. passes required CI checks (`typecheck`, `build`, `Lint`, `Test`, `Secret scan`, `Dependency review`),
2. is approved by the repository owner (CODEOWNERS), and
3. has no stale reviews, force-pushes, or deleted protection.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow: environment setup, branching strategy, PR checklist, and commit conventions.

## Security

Found a vulnerability? Please **do not open a public issue**. Report it privately — see [SECURITY.md](SECURITY.md) for the process and supported versions.

## Roadmap

- [x] Upgrade `langchain` to a supported major version and re-enable fail-closed `pnpm audit` (done — zero known advisories)
- [x] Add automated unit tests (Vitest) — wired into CI as a required check
- [x] Add ESLint/Prettier and enforce in CI
- [x] Production Docker images + deployment manifests
- [x] Real authentication (optional, `AUTH_PASSWORD`; httpOnly session cookies)

## License

MIT © [Pranesh Selvaraj](https://github.com/Pranesh-Selvaraj) — see [LICENSE](LICENSE).
