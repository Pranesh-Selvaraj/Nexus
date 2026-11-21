# 0006 — Modular monolith: module boundaries, naming and one configuration source

- **Status:** Accepted
- **Date:** 2026-11-11
- **Phase:** post-0.4.14 (structure)

## Context

The backend grew as flat layers: ~47 files in `services/`, 19 in `routers/`, a 1025-line `index.ts` that both booted the process and served twenty REST endpoints, and a single 829-line schema file. The frontend concentrated 55 % of its code in `ChatPanel` and `StudyPanel`. Every feature required knowing where its four or five files lived across two layers.

The deployment is one API process, one worker process and one static frontend, shipped as two container images plus a database and Redis, self-hosted by one person or a small team. That rules out microservices; it does not rule out boundaries.

## Decisions

### 1. Vertical modules, a platform kernel and a shared kernel

```
src/
  index.ts        process entrypoint (runs main, re-exports the router type)
  main.ts         migrations, local account, HTTP/WS servers, shutdown
  entrypoints/    worker process
  http/           app factory, tRPC registry, REST surfaces
  modules/<ctx>/  workspaces documents ingestion retrieval chat study
                  language voice vision settings api-keys webhooks
                  dashboard packs
  platform/       config, auth, storage, queue, observability, errors, env
  shared/         dto, paths, multer, provider-url, sanitize
  db/             client + schema (split by module)
```

**Why:** a feature is one folder. Platform code has no domain knowledge; shared code has no I/O.

**Consequences:** modules may import `platform/`, `shared/`, `db/` and their own files. A cross-module call goes through the owning module's service — the boundary is enforced by review today and by a lint rule next.

### 2. One naming legend

- **Module name = tRPC namespace = domain noun**, singular where the resource is singular (`workspace`, `document`, `chat`).
- **A module's primary router is `router.ts`**; additional namespaces in the same module are `<namespace>.router.ts` (e.g. `study/quiz.router.ts` serves `quiz.*`).
- **Services are `<thing>.service.ts`**, one responsibility per file; tests are colocated as `<file>.test.ts`.
- **Frontend screens** are `*Page` (routable), `*Panel` (a mode root), `*Dialog`, `*Card`, `*List`; primitives in `src/ui/` carry no suffix.
- **Two process entrypoints only**: `src/index.ts` (API) and `src/entrypoints/worker.ts`.

**Why:** the question "where does this live?" should be answerable from the name; the question "is this routable?" from the filename suffix.

### 3. One validated configuration source

`platform/config.ts` validates the environment once at boot (zod), exposes typed `config`, and fails the process with every invalid key listed. `AUTH_PASSWORD`, `ALLOW_REGISTRATION`, `AUTH_COOKIE_SECURE`, `LOCAL_USER_EMAIL`, `PORT` and `FRONTEND_ORIGIN` are read from it; other modules migrate as they move.

**Why:** 77 `process.env` reads across 24 files turn a typo into `undefined` at request time. Boot-time validation is the cheapest place to fail.

**Consequences:** configuration is process-wide and immutable; runtime changes go through the settings service, not the environment.

### 4. REST surfaces and error contract

`http/rest/*.routes.ts` each export a `Router`; `http/app.ts` composes them and owns the middleware order. `platform/errors.ts` defines the single REST body (`{ error }`), `ApiError`, `sendApiError`, and the tRPC adapter.

**Why:** route handlers stay thin, the app can be built in tests without sockets, and one place decides how an error becomes a response.

### 5. Frontend: app shell, features, platform, ui

`src/app/` holds the shell and routing, `features/<feature>/` owns screens/hooks/components for one area, `src/platform/` holds client infrastructure (tRPC, session, offline), `src/ui/` holds primitives.

**Why:** matches the backend's vertical structure and keeps the shell separate from feature code.

## Alternatives considered

- **Microservices per context** — rejected: one deployable, shared transactions, a self-hosted product.
- **NestJS/CQRS/event sourcing** — rejected: no payoff at this size, loses the Express/tRPC fit.
- **Repository per table** — rejected: Drizzle is the data layer; add a repository only where a query is reused across modules.
- **Keeping flat `services/` + `routers/`** — rejected: every feature change spans layers and the composition root keeps growing.

## Verification

The refactor shipped in five commits, each independently green: typecheck, lint, formatting, 273 unit tests, forced build, 6/6 Playwright suites, the integration smoke suite (176/176 on a clean database with a dedicated Redis database) and 58 visual captures. `drizzle-kit generate` reports no schema changes after the schema split, and the public tRPC/REST surface is unchanged.
