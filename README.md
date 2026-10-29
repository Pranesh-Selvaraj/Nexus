# Nexus

> A self-hosted learning portal that turns anything you read, watch or photograph into grounded, practiceable knowledge.

Nexus helps you learn anything — technology, languages, art, science, music, an exam, a codebase — from your own material. Bring books, slides, lectures, web pages, YouTube talks, photos and notes into a topic; ask questions that cite the exact passage or image; turn the same material into flashcards, quizzes, dictation and pronunciation practice; and let spaced repetition and a cross-topic dashboard show what is due, what was reviewed and what is actually sticking. It is self-hosted, provider-agnostic and exportable, so the knowledge and the learning data stay yours.

The full statement of why Nexus exists — its mission, the learning-science basis, the feature-to-learning map, success criteria and non-goals — is in **[docs/MISSION.md](docs/MISSION.md)**.

[![Release](https://img.shields.io/github/v/release/Pranesh-Selvaraj/Nexus?sort=semver)](https://github.com/Pranesh-Selvaraj/Nexus/releases)
[![CI](https://github.com/Pranesh-Selvaraj/Nexus/actions/workflows/ci.yml/badge.svg)](https://github.com/Pranesh-Selvaraj/Nexus/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Pranesh-Selvaraj/Nexus/actions/workflows/codeql.yml/badge.svg)](https://github.com/Pranesh-Selvaraj/Nexus/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

---

## Table of contents

- [Mission and ambition](#mission-and-ambition)
- [Features](#features)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Scripts](#scripts)
- [Environment variables](#environment-variables)
- [API access](#api-access)
- [Project structure](#project-structure)
- [CI/CD and security](#cicd-and-security)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

## Mission and ambition

**Mission:** help people turn anything they can read, watch, listen to or photograph into knowledge they can use, remember and build on — with an AI tutor that stays grounded in their sources and a practice loop that makes retention measurable.

The ambition is to be the **ultimate learning portal**: a single place where any source becomes structured, searchable material; a tutor answers only from that material and shows its evidence; the same material becomes deliberate practice; spaced repetition schedules what is about to be forgotten; and the dashboard shows what is due and what was reviewed across every topic — all running on infrastructure the learner controls and with every document, conversation and card exportable.

That ambition is constrained by principles, not feature count:

- **Grounded before generative** — cite the source or state the gap; never invent.
- **Active over passive** — every reading surface leads to a question, card, quiz or drill.
- **One topic, many inputs** — formats and provenance are unified by the subject being learned.
- **Practice is first-class** — chat alone does not make knowledge stick.
- **Explainable and owned** — retrieval shows its reasoning, and the data is portable and self-hostable.

Read the full document for the problem statement, the learning-science mapping (retrieval practice, spaced repetition, immediate feedback, interleaving, dual coding, metacognition), the learner loop, what each feature is for, who it is for, the measurable definition of "ultimate", the honest line between shipped and ambition, and the non-goals: **[docs/MISSION.md](docs/MISSION.md)**.

## Features

- 📁 **Workspaces** — organize documents into isolated workspaces.
- 📱 **Installable, with offline review** — Nexus is a PWA: install it from the browser, open the review screen without a connection, grade cards offline and let the ratings sync when you reconnect; speech clips you already played replay from the cache.
- 📤 **Anything you already read** — PDF, EPUB (chapter/section structure), DOCX, PPTX, XLSX, ODT, RTF, HTML, Markdown, plain text, CSV/JSON, subtitles (SRT/VTT), ZIP archives (with zip-bomb limits) and audio/video files (transcribed with the same STT pipeline as dictation), up to 25 MB each by default.
- 🌐 **Web articles and YouTube** — paste a URL in the library to import an article (Readability extraction) or a YouTube transcript. The fetch is SSRF-safe: hostnames are resolved and every resolved address is checked, loopback/private/link-local/cloud-metadata ranges are refused, the connection is pinned to the validated address, redirects are capped and the response body is size-capped.
- 🖼️ **Images and scanned pages** — PNG/JPEG/WebP/GIF/TIFF/BMP images and PDFs without a text layer are OCR'd with the system `tesseract` binary (and `pdftoppm` for PDF pages) and, when a vision model is configured, described by it. The description plus the OCR text are what retrieval searches, so a photographed diagram or a scanned page is as citable as a text file.
- 👁️ **Vision chat and art/diagram analysis** — attach up to four library images to a question; the answer cites the image like any other source. Dedicated **art critique**, **diagram** and **equation** modes change the instruction (composition/context, components/flows, or LaTeX transcription), and any image can be analysed on demand from its library card.
- 🧬 **Duplicate detection and provenance** — the upload's bytes are hashed (sha256) and the file type is decided from magic bytes, not the extension; re-uploading the same file into a workspace returns the existing document instead of indexing it twice, and every document records its detected format, table of contents, word count, reading time and OCR/vision/transcript provenance.
- 🔄 **Queue-based indexing** — documents are chunked and embedded by a background BullMQ worker, so the API stays responsive.
- 🔍 **Hybrid search** — combines vector similarity (pgvector) with keyword search for robust retrieval, with a Redis query-embedding cache (24h TTL) so repeated questions skip the embedding round-trip.
- 💬 **RAG chat** — streamed, context-grounded answers over WebSocket, with per-answer **token usage** and LLM-generated conversation titles.
- 📦 **Backup & restore** — export any workspace (documents + chat history) as JSON and import it back
- 🎙️ **Voice input** — dictate questions with the browser Web Speech API or record and send audio to `POST /api/transcribe` (an OpenAI-compatible `whisper-1`/`gpt-4o-transcribe` provider, or a local faster-whisper sidecar when the cloud is unavailable). Push-to-talk and click-to-toggle, a live waveform, silence auto-stop and a language selector.
- 🔊 **Read-aloud** — play any answer, selection or flashcard with server voices (OpenAI TTS) or the operating system's, with sentence-by-sentence highlighting, speed and voice controls and a download link. Synthesised speech is cached by `(text, voice, speed, model)` and streamed back with HTTP Range support.
- 🗣️ **Voice chat** — a push-to-talk loop (transcribe → grounded answer → spoken reply) whose transcripts are ordinary persisted messages, so a spoken conversation can be resumed as text. A latency HUD shows time-to-first-token and time-to-audio.
- 📚 **Language learning** — mine vocabulary from any passage into spaced-repetition cards with translations, score dictation and pronunciation per word, and track a CEFR estimate for reading, writing, listening and speaking.
- 🔐 **Optional authentication** — set `AUTH_PASSWORD` for a login screen with httpOnly session cookies (expired sessions are purged daily); unset for single-user dev mode.
- 🧱 **Monorepo** — pnpm workspaces + Turborepo for fast, cached builds.

### The learning portal

Nexus opens as a learning portal rather than an empty chat — the product expression of the [mission](docs/MISSION.md):

- **Home** is a universal dashboard: topics, sources, cards due now, reviews done today, a "Continue learning" row, a suggested next step and suggested activities, plus recently added sources.
- **Topics** is the gallery of everything you are learning. Create a topic per subject (a language, a course, an exam, art history, a codebase...) with an optional goal; import a previous workspace backup from the same page. Each card shows source count and due work.

### Domain packs

Five first-party packs give a topic a running start — **Spanish for beginners (A1)**, **Python foundations**, **How to read a painting**, **Cell biology essentials** and **Music theory basics**. Installing one from the Topics gallery creates a normal topic containing:

- a **plan** note (a checklist you can edit) in Practice → Notes,
- a **starter deck** of flashcards, due immediately, in Practice → Decks,
- three **starter questions** shown above the chat (click to copy),
- a **welcome conversation** summarising the plan and how to use the topic,
- the pack's persona preselected as a suggestion in the topic metadata.

Everything is ordinary user data afterwards: rename, edit, delete or add sources to the topic. Packs are curated content shipped with Nexus (no external downloads), and installing one twice is prevented by pointing "Install pack" at the already-installed topic ("Open topic").

- **A topic** has four modes: **Learn** (chat with your sources, with a Sources rail for uploads, URLs and the library), **Practice** (study dashboard, flashcards, quizzes, studio artifacts and notes), **Voice** (push-to-talk tutor), and **Language** (vocabulary, dictation, pronunciation, CEFR progress). The topic header keeps Share, Export, re-index and Delete in one place.
- The shell keeps the sidebar for Home, Topics, a quick topic list, Settings and the signed-in user; mobile gets an off-canvas drawer and a compact header.

### Ingestion formats

| Family        | Formats                                                   | How the text is obtained                                                          |
| ------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Documents     | PDF, DOCX, PPTX, XLSX, ODT, RTF, HTML, TXT, MD, CSV, JSON | Format-specific parser with structure (pages, slides, sheets, headings, TOC)      |
| Books         | EPUB                                                      | Spine order + chapter/section headings, kept as the document's table of contents  |
| Containers    | EPUB, PPTX, XLSX, ODT, ZIP                                | Unzipped under entry/size/ratio/depth limits so a zip bomb cannot exhaust the box |
| Subtitles     | SRT, VTT                                                  | Cue text with timestamps                                                          |
| Audio / video | MP3, WAV, OGG, FLAC, M4A, AAC, WebM, MP4, MOV             | The existing STT pipeline (`whisper-1`, `gpt-4o-transcribe`, or a local sidecar)  |
| Images        | PNG, JPEG, WebP, GIF, TIFF, BMP                           | OCR text + vision description (whichever is available)                            |
| Scanned PDFs  | PDF                                                       | Automatic detection of a missing text layer, then OCR of the leading pages        |
| Web           | `http(s)://` article URLs                                 | Readability extraction behind the SSRF-safe fetcher                               |
| YouTube       | Watch/shorts/youtu.be URLs                                | Caption track (timed text), no API key                                            |

OCR is optional. The backend uses the **system** `tesseract` binary (and `pdftoppm` from poppler for PDF pages) rather than a bundled WASM build, so no language data is downloaded at runtime and air-gapped installs keep working. The published backend image already includes both; for a source checkout or an unusual base image install them yourself:

```bash
apt-get install -y tesseract-ocr poppler-utils   # Debian/Ubuntu
```

When OCR is unavailable, ingestion still works: images fall back to the vision model, and a scanned PDF fails with an actionable message instead of creating an empty document. Vision itself is a provider capability — enable it in **Settings → Vision** and point it at any model that accepts images (the OpenAI multimodal models, or a local VLM served over an OpenAI-compatible endpoint).

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
| API + worker | `docker pull ghcr.io/pranesh-selvaraj/nexus-backend:0.4.5`  |
| Frontend     | `docker pull ghcr.io/pranesh-selvaraj/nexus-frontend:0.4.5` |

Pin a version in production; `latest` tracks the newest release. (Note: the container tags are semver without the `v` prefix — `0.4.5`, not `v0.4.5`.)

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

### Multi-arch images and GPU transcription

Release images are published for **linux/amd64 and linux/arm64** (Apple Silicon, Raspberry Pi-class hosts, ARM servers), so the documented compose files work without a local build on either architecture. Building from source on an ARM host works too; the backend image installs `tesseract-ocr`, `poppler-utils` and `postgresql-client` for that architecture.

For local transcription on an NVIDIA GPU, add the opt-in profile:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.gpu.yml up -d
```

It runs a `faster-whisper` server (model configurable with `WHISPER_MODEL`) and points the API and worker at it via `WHISPER_LOCAL_URL`. CPU-only deployments need nothing; if the provider transcription fails, Nexus falls back to the local sidecar only when that URL is configured.

### Keeping it private

See [SECURITY.md](SECURITY.md) — without `AUTH_PASSWORD` the app runs in single-user no-auth mode and should sit behind a reverse proxy.

## Releases

Releases follow [SemVer](https://semver.org/) and are published automatically from the [release workflow](.github/workflows/release.yml): pushing an annotated tag builds the images, publishes them to GHCR, and creates a GitHub Release whose body is the matching section of [CHANGELOG.md](CHANGELOG.md) — the workflow fails if the section is missing, so a release can never ship generated placeholder notes.

Development runs in phases and each phase ships as a contained patch release in the 0.4 line with its own detailed changelog entry: `0.4.2` (Phase 0), `0.4.3` (Phase 1), `0.4.4` (Phase 2), `0.4.5` (Phase 3), and so on in order. Every release publishes both container images and updates `latest`.

```bash
# add the `## [0.4.6]` section to CHANGELOG.md first
git tag -a v0.4.6 -m "Nexus v0.4.6" && git push origin v0.4.6
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
| `pnpm --filter @nexus/backend cli --help`  | Nexus CLI (search/ask/upload/due/note)      |
| `pnpm --filter @nexus/backend mcp`         | Start the MCP server on stdio               |
| `pnpm --filter @nexus/backend backup`      | Write a `pg_dump` backup (see Backups)      |

## Environment variables

All variables live in `.env` (see `.env.example`). The backend auto-discovers `.env` at the repo root or package root.

| Variable                      | Default                                       | Description                                                                                                                                           |
| ----------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                | `postgres://nexus:nexus@localhost:5432/nexus` | PostgreSQL + pgvector connection string                                                                                                               |
| `REDIS_URL`                   | `redis://localhost:6379`                      | Redis connection string (BullMQ)                                                                                                                      |
| `OPENAI_API_KEY`              | —                                             | OpenAI API key (required only without a base URL)                                                                                                     |
| `OPENAI_BASE_URL`             | _(unset)_                                     | OpenAI-compatible base URL for chat (Ollama, OpenCode Zen, LM Studio, OpenRouter, ...) - enables keyless local mode                                   |
| `OPENAI_MODEL`                | `gpt-4o-mini`                                 | Chat model                                                                                                                                            |
| `OPENAI_EMBEDDING_MODEL`      | `text-embedding-3-small`                      | Embedding model                                                                                                                                       |
| `OPENAI_EMBEDDING_BASE_URL`   | _(unset)_                                     | OpenAI-compatible base URL for a separate embedding provider (required for chat-only providers such as OpenCode Zen); falls back to `OPENAI_BASE_URL` |
| `OPENAI_EMBEDDING_API_KEY`    | —                                             | API key for the embedding provider; falls back to `OPENAI_API_KEY`                                                                                    |
| `OPENAI_STT_MODEL`            | `whisper-1`                                   | Server transcription model (`whisper-1`, `gpt-4o-transcribe`, ...)                                                                                    |
| `OPENAI_STT_BASE_URL`         | _(unset)_                                     | Optional dedicated transcription endpoint; falls back to `OPENAI_BASE_URL`                                                                            |
| `OPENAI_STT_API_KEY`          | —                                             | Optional transcription key; falls back to `OPENAI_API_KEY`                                                                                            |
| `OPENAI_TTS_MODEL`            | `tts-1`                                       | Server speech-synthesis model                                                                                                                         |
| `OPENAI_TTS_VOICE`            | `alloy`                                       | Default read-aloud voice (`alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`)                                                                        |
| `OPENAI_TTS_BASE_URL`         | _(unset)_                                     | Optional dedicated speech-synthesis endpoint; falls back to `OPENAI_BASE_URL`                                                                         |
| `OPENAI_TTS_API_KEY`          | —                                             | Optional speech key; falls back to `OPENAI_API_KEY`                                                                                                   |
| `STT_LANGUAGE`                | `auto`                                        | Default dictation language (BCP-47 tag or `auto` to detect)                                                                                           |
| `OPENAI_VISION_MODEL`         | _(falls back to the chat model)_              | Model used for image requests (must accept images, e.g. `gpt-4o-mini`)                                                                                |
| `OPENAI_VISION_BASE_URL`      | _(falls back to `OPENAI_BASE_URL`)_           | Optional dedicated vision endpoint (local VLM, separate provider)                                                                                     |
| `OPENAI_VISION_API_KEY`       | —                                             | Optional vision key; falls back to `OPENAI_API_KEY`                                                                                                   |
| `VISION_MAX_IMAGE_MB`         | `10`                                          | Largest image accepted for vision analysis (also caps the bytes sent per request)                                                                     |
| `OCR_ENABLED`                 | `true`                                        | Run OCR on images and PDFs without a text layer; needs `tesseract-ocr` (and `poppler-utils` for PDFs)                                                 |
| `OCR_LANGUAGES`               | `eng`                                         | Tesseract language codes joined with `+` (`eng`, `deu`, `eng+spa`); extra languages need the matching traineddata                                     |
| `OCR_MAX_PAGES`               | `30`                                          | Pages rasterized and OCR'd per scanned PDF                                                                                                            |
| `OCR_TIMEOUT_MS`              | `60000`                                       | Wall-clock cap for one OCR invocation                                                                                                                 |
| `TESSERACT_BIN`               | `tesseract`                                   | Path to the tesseract binary (useful for containers or unusual installs)                                                                              |
| `PDF_RASTER_BIN`              | `pdftoppm`                                    | Path to poppler's `pdftoppm` used to rasterize scanned PDFs                                                                                           |
| `INGEST_MAX_BYTES`            | `5`                                           | Cap in MB for a URL-ingestion response body                                                                                                           |
| `INGEST_MAX_REDIRECTS`        | `3`                                           | Redirects followed during URL ingestion (each hop is re-validated)                                                                                    |
| `INGEST_TIMEOUT_MS`           | `20000`                                       | Wall-clock budget for one URL ingestion hop                                                                                                           |
| `INGEST_ALLOW_PRIVATE_HOSTS`  | `false`                                       | **Test/self-host override**: allows URL ingestion from private addresses. Keep it off in any deployment that can reach the internet                   |
| `MAX_ZIP_ENTRIES`             | `500`                                         | Entry cap for zip-style containers (EPUB/PPTX/XLSX/ODT/ZIP)                                                                                           |
| `MAX_UNCOMPRESSED_MB`         | `200`                                         | Total uncompressed size cap across a container                                                                                                        |
| `MAX_ZIP_ENTRY_MB`            | `50`                                          | Uncompressed cap for a single container entry                                                                                                         |
| `MAX_ZIP_RATIO`               | `100`                                         | Uncompressed:compressed ratio above which a container is treated as a zip bomb                                                                        |
| `MAX_ZIP_DEPTH`               | `1`                                           | Nested-container depth allowed while parsing                                                                                                          |
| `PARSER_TIMEOUT_MS`           | `60000`                                       | Wall-clock cap for one document parser                                                                                                                |
| `MAX_TEXT_CHARS`              | `4000000`                                     | Extracted text kept per document (protects embeddings and the database)                                                                               |
| `WHISPER_LOCAL_URL`           | _(unset)_                                     | Optional local faster-whisper (OpenAI-compatible) fallback used when the primary transcription provider fails                                         |
| `AUDIO_RETENTION_DAYS`        | `7`                                           | Delete cached speech and retained recordings after this many days (`0` keeps them until the quota evicts)                                             |
| `AUDIO_MAX_STORAGE_MB`        | `200`                                         | Per-user audio cache cap; the oldest assets are evicted first                                                                                         |
| `MAX_AUDIO_MB`                | `25`                                          | Per-recording upload cap for dictation and pronunciation                                                                                              |
| `LOCAL_USER_EMAIL`            | `local@nexus.dev`                             | Identity of the single local user                                                                                                                     |
| `AUTH_PASSWORD`               | _(unset)_                                     | When set, login is required (httpOnly session cookie); unset = no-auth dev mode                                                                       |
| `AUTH_COOKIE_SECURE`          | `false`                                       | `true` when serving over HTTPS (adds `Secure` to the session cookie)                                                                                  |
| `SESSION_TTL_DAYS`            | `30`                                          | Session lifetime in days                                                                                                                              |
| `PORT`                        | `3000`                                        | Backend HTTP/WS port                                                                                                                                  |
| `UPLOAD_DIR`                  | `./uploads`                                   | Directory for uploaded documents                                                                                                                      |
| `MAX_UPLOAD_MB`               | `25`                                          | Per-file upload size limit                                                                                                                            |
| `MAX_IMPORT_MB`               | `100`                                         | Workspace archive import size limit (multipart JSON upload)                                                                                           |
| `FRONTEND_ORIGIN`             | `http://localhost:5173`                       | Allowed CORS origin                                                                                                                                   |
| `LOG_LEVEL`                   | `info`                                        | Structured log level (`debug`, `info`, `warn`, `error`, `silent`)                                                                                     |
| `METRICS_TOKEN`               | _(unset)_                                     | When set, `GET /metrics` requires `Authorization: Bearer <token>` (or `?token=`)                                                                      |
| `WEBHOOK_ALLOW_PRIVATE_HOSTS` | `false`                                       | **Local-testing override**: allow webhook endpoints on private/loopback addresses. Keep it off in any deployment that can reach the internet          |

> ⚠️ Never commit a real `.env` file. It is git-ignored and scanned for secrets in CI (gitleaks).

## Scale & performance

Nexus targets single-user, self-hosted personal corpora. The honest envelope:

| Dimension   | Limit                     | Notes                                                                                                                                                                                                                                                             |
| ----------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Uploads     | 25 MB/file (configurable) | Parsed server-side, chunked, embedded asynchronously                                                                                                                                                                                                              |
| Retrieval   | HNSW ANN index            | One partial HNSW index per supported embedding dimension (384/512/768/1024/1536 as `vector`, 2048/3072 as `halfvec`), so a query plans against the index for its active dimension; the planner still chooses an exact scan on small corpora because it is cheaper |
| History     | unbounded queries         | Conversation lists and message histories load fully; fine at personal scale                                                                                                                                                                                       |
| Query cache | Redis, 24h TTL            | Query embeddings are cached keyed by model + text hash; switching embedding models invalidates automatically                                                                                                                                                      |
| Maintenance | daily 03:00               | Expired sessions, cached speech and trashed documents past the retention window are purged by a BullMQ repeat job                                                                                                                                                 |

**Measured envelope** (this machine, `pnpm --filter @nexus/backend load-test`, synthetic vectors, vector arm only):

| Corpus                | Plan       | p50   | p95   |
| --------------------- | ---------- | ----- | ----- |
| 20k chunks @1536 dims | exact scan | 152ms | 179ms |
| 100k chunks @768 dims | HNSW       | 7ms   | 10ms  |

The 20k case is the planner deliberately preferring an exact scan (all chunks in one document, 1536 dims); the 100k case uses the partial HNSW index. Run the harness with `LOAD_TEST_CHUNKS=100000 LOAD_TEST_DIMS=768 pnpm --filter @nexus/backend load-test` (it seeds a synthetic workspace, prints the plan and percentiles, and removes the workspace unless `--keep` is passed). Indexes cover the dimensions Nexus ships presets for; adding a new embedding dimension needs a matching partial index (migration) or retrieval falls back to an exact scan.

**Tuning knobs** (Settings → Retrieval): smaller `chunk size` → more chunks but finer granularity; lower `top-K` → faster retrieval; adjust vector/keyword weights per corpus. For corpora beyond the envelope, the pragmatic path is partitioning workspaces (retrieval is scoped per workspace) rather than one giant workspace.

## LLM providers

Nexus speaks the OpenAI API protocol, so any OpenAI-compatible endpoint works — pick a preset or type an **API base URL** in the Settings → **Text model** card (or set `OPENAI_BASE_URL`):

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

With a local provider, use a compatible model name (e.g. `llama3.1`) for chat and an embedding model served by the same endpoint. Set the embedding model's **dimensions** in Settings (the `chunks.embedding` column is dimension-flexible). Use the **Test connection** button and each card's **Fetch models from this endpoint** picker to verify.

### Chat-only providers (separate embedding provider)

Some providers — notably **OpenCode Zen** — serve chat models but have **no embeddings endpoint**. Since Nexus embeds both indexed documents and chat queries, point the **Embeddings** card at a provider that does serve embeddings (OpenAI, Ollama, Jina, Mistral, ...):

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
- **Go plan**: use the **OpenCode Zen Go** preset in the **Text model** card (base URL `https://opencode.ai/zen/go/v1`). The Go endpoint serves its own model list (`kimi-k3`, `kimi-k2.7-code`, `glm-5.*`, `minimax-m3`, `longcat-2.0`, `mimo-v2*`, `qwen3.x`, ...) — use **Fetch models from this endpoint** to see it and **Test connection** to verify a model is actually served over `/chat/completions`.
- **Go client requirements**: Nexus sends `User-Agent: nexus/1.0` and a stable `x-opencode-session` header with every request (the conversation id for chats, the document id for indexing), as the [Go docs](https://opencode.ai/docs/go) require. Note that Go is designed for coding agents and traffic is monitored for abuse — using it from a RAG workspace is at your discretion.

## Local LLMs (no API key needed)

Point Nexus at any OpenAI-compatible local server — **no API key required** (chat and embeddings can share the same local endpoint):

1. **Settings → Text model** card → click the **Ollama (local)** preset (or set `OPENAI_BASE_URL` in `.env`)
2. Pull a chat model and an embedding model, e.g.:
   ```bash
   ollama pull llama3.1
   ollama pull nomic-embed-text     # 768-dim embeddings
   ```
3. **Settings → Embeddings** card → click the **Ollama (local)** preset, set embedding model = `nomic-embed-text` and **Embedding dimensions = 768**
4. Back in the **Text model** card, pick chat model = `llama3.1`, then **Fetch models from this endpoint** to verify, and **Test connection**
5. Upload a document — chunks are embedded locally and indexed with the matching dimension

Notes:

- The `chunks.embedding` column is dimension-flexible (migration 0005); the worker validates every vector against the **Embedding dimensions** setting (default 1536 for OpenAI).
- Embeddings are requested as `encoding_format: float` so plain-float local servers (Ollama/LM Studio) work with the OpenAI SDK's base64 default.
- Changing the embedding model/dimensions re-indexes: delete the document and re-upload (or use the retry button after changing settings).
- Retrieval uses exact vector scans (the fixed-dimension HNSW index was removed) — fine at personal-corpus scale.
- **LM Studio**: base URL `http://localhost:1234/v1` (no key needed). **OpenRouter/Groq/OpenCode Zen**: preset buttons in the **Text model** card; OpenCode Zen additionally needs an embedding provider (see above).

## Settings panel

Most configuration can be managed from the **Settings** page in the UI (sidebar → Settings) — no `.env` edits or restarts needed. The page is split into two independent provider cards plus one-time groups:

| Card / group   | What it configures                                                                                                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Text model** | the provider that **answers questions**: endpoint presets (OpenAI, OpenCode Zen/Go, OpenRouter, Groq) or any custom OpenAI-compatible endpoint, API key, chat model (fetch the list from the endpoint), temperature                    |
| **Embeddings** | the provider that **indexes documents and encodes questions**: endpoint presets (OpenAI, Ollama, Jina, Mistral) or a custom endpoint, API key, embedding model, **embedding dimensions** (any value, e.g. 2560 for qwen3-embedding:4b) |
| Retrieval      | chunk size, chunk overlap, sources retrieved (top-K), vector/keyword weights, **search language** (28 PostgreSQL FTS configs)                                                                                                          |
| Vision         | enable vision, vision model / base URL / API key, max image size, OCR on/off and OCR languages                                                                                                                                         |
| Voice          | speech-to-text engine (browser/server) and language, dedicated transcription/speech endpoints and keys, default read-aloud voice and speed, send-after-dictation, correction policy, audio retention days and storage cap              |
| Language       | target language, native language, starting CEFR level (the per-skill estimate is computed from practice)                                                                                                                               |
| Server         | max upload size                                                                                                                                                                                                                        |
| Auth           | session lifetime (days)                                                                                                                                                                                                                |
| Appearance     | app name (sidebar + browser title), **system prompt**                                                                                                                                                                                  |

Precedence: **UI value → environment variable → default**. Emptying a field resets it to the env/default. The **Test connection** button verifies both providers end to end (a tiny completion, a real embedding, and the returned vector dimensions); each card's **Fetch models from this endpoint** button lists the models that endpoint serves — click one to select it.

### Secrets & credentials

- API keys are stored **encrypted at rest** (AES-256-GCM, key derived from `SETTINGS_SECRET` in `.env`) and are **never sent back to the browser in full** — the settings API only returns a masked preview (`sk-…wxyz`), so a full key can never leak through the UI, history, or a compromised session.
- Keys set via environment variables show an `env` badge and are read straight from `.env` (never written to the database).
- Saving keys from the UI requires `SETTINGS_SECRET`; without it the panel shows a banner and rejects secret saves. Generate one with `openssl rand -hex 32`.
- Decrypted keys live only in process memory (with a short-TTL cache) for outgoing requests.

## Document storage (local disk or S3)

Document bytes go through a small storage interface (`services/storage`). The default keeps them under `UPLOAD_DIR`; setting `STORAGE_DRIVER=s3` writes them to any S3-compatible bucket (AWS S3, MinIO, Cloudflare R2, ...). Keys are the workspace-scoped, server-generated paths already stored in the database, so switching backends needs a copy of the objects, not a schema change.

- **Configuration.** `S3_BUCKET` is required; `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` (defaults to true when an endpoint is set, which MinIO needs) and optional `S3_KEY_PREFIX` complete it. See `.env.example`.
- **Parsers and previews.** OCR/PDF/media parsers need a local file, so the S3 driver downloads each object once into `S3_CACHE_DIR` (default `/tmp/nexus-s3-cache`) on first use and serves later reads from there. Image previews are streamed through the API from the bucket, not exposed directly, so bucket ACLs can stay private.
- **Deletion and trash.** Deleting a document removes its object; emptying the trash and deleting a workspace remove every object under that workspace prefix. Trashed documents keep their objects until the purge window elapses, exactly like local disk.
- **Self-test.** `pnpm --filter @nexus/backend storage:selftest` round-trips one object through the configured driver and is the quickest way to validate credentials before switching a deployment.
- **MinIO profile.** `docker-compose.s3.yml` adds a MinIO service and wires the API/worker to it (`STORAGE_DRIVER=s3`); create the bucket once (`mc mb local/nexus`). For a source checkout, install nothing extra: the S3 client is a normal dependency.

## API access

Everything the UI does is available to scripts through a scoped REST API on the backend port (`http://localhost:3000/api/v1` by default). Create a key in **Settings → API keys**: the full key (`ndx_…`) is shown once, only its sha256 hash is stored, and each key carries explicit scopes (`search`, `ask`, `documents:read`, `documents:write`, `reviews:read`, `reviews:write`). Revoking a key takes effect on the next request.

```bash
KEY=ndx_…                                   # from Settings → API keys
BASE=http://localhost:3000/api/v1

curl -H "Authorization: Bearer $KEY" "$BASE/me"
curl -H "Authorization: Bearer $KEY" "$BASE/workspaces"
curl -H "Authorization: Bearer $KEY" "$BASE/documents?workspaceId=$WS"

# Hybrid search: the same ranking a chat answer uses
curl -H "Authorization: Bearer $KEY" "$BASE/search?workspaceId=$WS&q=hybrid+retrieval&limit=5"

# Grounded answer, non-streaming, with cited sources and timings
curl -X POST -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"workspaceId":"'"$WS"'","question":"What is hybrid retrieval?"}' \
  "$BASE/ask"
```

| Endpoint           | Scope             | Returns                                                             |
| ------------------ | ----------------- | ------------------------------------------------------------------- |
| `GET /me`          | any live key      | The key id, owner and granted scopes                                |
| `GET /workspaces`  | `documents:read`  | Workspaces owned by the key's user, with document counts            |
| `GET /documents`   | `documents:read`  | Documents in a workspace (same DTO as the UI, including structure)  |
| `GET /search`      | `search`          | `{ query, sources }` from the chat retrieval pipeline               |
| `POST /ask`        | `ask`             | `{ answer, sources, query, usage, timings }`; sources carry `cited` |
| `POST /documents`  | `documents:write` | Multipart upload (`workspaceId` + `file`); 201, or 200 `duplicate`  |
| `GET /reviews/due` | `reviews:read`    | `{ cards }` due now with the four FSRS interval previews            |
| `POST /reviews`    | `reviews:write`   | `{ cardId, rating }`; next due date and remaining count             |

Behavior worth knowing: authentication is **API-key only** (session cookies are not accepted, so a cross-site request cannot drive an integration), an unknown or revoked key is a `401`, a live key missing the route's scope is a `403` with `requiredScope`, and a workspace the key's user does not own is a `404` rather than a `403`. Provider failures surface as `502`. Every response echoes `X-Request-Id`.

Uploads over the API go through exactly the same admission as the UI (magic-byte format detection, zip/vision limits, duplicate detection by content hash, server-generated filename), so an integration cannot bypass a rule the browser follows:

```bash
curl -X POST -H "Authorization: Bearer $KEY" \
  -F "workspaceId=$WS" -F "file=@notes.epub" \
  "$BASE/documents"
```

### Webhooks

Instead of polling, register an endpoint in **Settings → Webhooks** and Nexus POSTs a signed JSON event when indexing finishes:

```json
{
  "event": "document.indexed",
  "deliveryId": "…",
  "createdAt": "2026-10-25T12:00:00.000Z",
  "data": {
    "documentId": "…",
    "workspaceId": "…",
    "title": "notes.epub",
    "chunkCount": 42
  }
}
```

Headers: `X-Nexus-Event`, `X-Nexus-Delivery`, and `X-Nexus-Signature: sha256=<hex HMAC-SHA256 of the raw body>` keyed with the secret shown once at creation. `document.failed` carries `data.error` instead of a chunk count. Deliveries time out after 5 seconds, do not follow redirects, retry five times with exponential backoff, and record the last status/error on the endpoint so a failing receiver is visible in Settings. The signing secret is encrypted at rest with `SETTINGS_SECRET`; without that key webhook creation is refused with an explanatory error. Targets are address-checked like ingestion (private/loopback/link-local refused) — `WEBHOOK_ALLOW_PRIVATE_HOSTS=true` is a local-testing override only.

### Members and roles

Topics can be shared with other accounts on the same deployment (L-13):

- **Roles.** **Reader** can browse sources, chat, ask questions and practise; **Editor** can also add or remove sources, generate cards/quizzes/notes and export; **Owner** (the creator) additionally manages members, share links and deletion. The creator is always an owner and cannot be removed or demoted.
- **Adding members.** The topic header's **Members** dialog lists everyone with their role. Owners add an existing account by email as reader or editor and can change a role or remove someone at any time; removal revokes access on the next request. A non-owner sees the member list read-only (no management controls).
- **Accounts.** Multi-user deployments authenticate per account. Account creation is opt-in with `ALLOW_REGISTRATION=true` (the login screen then offers **Create account**); otherwise accounts should be provisioned by the administrator. A newly registered account sees no topics until it is added to one.
- **Enforcement is server-side.** Every workspace-scoped procedure resolves the caller's membership and required role before touching data (`workspace_members` plus the creator fallback). Readers get `403` on mutations, non-members get `404` (so workspace ids cannot be probed), and resource-level routes (documents, decks, notes, quizzes, artifacts, conversations, uploads) resolve access through the workspace rather than trusting an id.
- **What is shared.** Documents, conversations, decks, quizzes, notes and progress live in the topic and are visible to all members; personal pronunciation/vocabulary practice currently records per user where the schema has a user column.

### Read-only share links

Any workspace can be shared without an account: **Share** in the workspace toolbar creates a capability URL (`/share/nxs_…`) that lets visitors read the document list and ask grounded questions. It is strictly read-only — no uploads, edits, deletions, settings or exports are reachable from the shared page.

- The token is generated server-side, shown **once**, and stored only as a sha256 hash; if it is lost, revoke the link and create a new one.
- Links can carry a label and an expiry (7/30/90 days or never) and are revocable at any time; a revoked or expired link answers `404` immediately.
- Questions on the shared page run through the same retrieval pipeline as chat and cite the sources, executing as the workspace owner but only in read mode. The shared surface is rate-limited per client IP (30 requests/minute).
- Links are capabilities: anyone who has the URL can use it. Treat them like an unlisted document and revoke when a group is done. `PUBLIC_BASE_URL` controls the host used in the generated URL (defaults to `FRONTEND_ORIGIN` or `http://localhost:5173`).

### MCP, CLI and the browser share target

The same REST surface powers three first-class clients, all authenticated with a scoped key:

- **MCP server** (`pnpm --filter @nexus/backend mcp`) speaks MCP over stdio and exposes `list_workspaces`, `list_documents`, `search`, `ask` and `create_note`, so clients like Claude Desktop or coding agents can use Nexus as a knowledge base. Point the client at the command with `NEXUS_BASE_URL` and `NEXUS_API_KEY` in its env; the server is a thin wrapper over the REST API, so scopes and ownership are enforced exactly as for any other integration.
- **CLI** (`pnpm --filter @nexus/backend cli <command>`) covers `workspaces`, `documents`, `search`, `ask`, `upload`, `url`, `due`, `review` and `note`:

  ```bash
  export NEXUS_API_KEY=ndx_… NEXUS_BASE_URL=http://localhost:3000
  pnpm --filter @nexus/backend cli ask "What does my thesis say about caching?" --workspace "$WS"
  pnpm --filter @nexus/backend cli upload ./paper.pdf --workspace "$WS"
  ```

- **Browser share target** (`extensions/browser/`) is a Manifest V3 extension: set the Nexus URL, API key and workspace once, then click "Save current page" on any article or captioned YouTube video. It posts the URL to `POST /api/v1/urls`; extraction happens server-side, so the browser never handles the page content.

### Storage, trash and backups

- **Indexing queue admin.** Settings → Indexing queue shows waiting/active/delayed/failed/completed counts and every failed job with its document, error and attempt count, plus Retry and Drop. The counts refresh every five seconds; they are the same BullMQ queue the worker drains, so a stuck document can be requeued without restarting anything.
- **Quota.** `storage.quotaMb` (default 5 GB, 0 disables it) caps the bytes a user can store. Uploads and URL imports are refused with a `413` before anything is written; trashed documents still count until they are purged. **Settings → Storage** shows the used/quota bar and the largest workspaces.
- **Trash instead of delete.** Deleting a document removes its chunks immediately (so retrieval can never cite it) but keeps the row and file for `storage.trashDays` (default 30). The library toast offers **Undo**, and **Show trash** lists restorable documents plus **Empty trash permanently**. Restoring re-queues indexing from the stored file. The nightly maintenance job purges expired trash, including the file.
- **Workspace export.** The library's **Export workspace (.zip)** button downloads a zip with `workspace.json` (metadata, document manifest, conversations), `README.txt` and the original stored files under `documents/`. It is owner-scoped and capped at 300 MB per archive; the JSON archive over `workspace.export` remains the round-trip format used by import.
- **Backups.** `pnpm --filter @nexus/backend backup` writes a custom-format `pg_dump` to `BACKUP_DIR` (default `./backups`), prunes files past `BACKUP_RETENTION_DAYS` (default 7) and fails loudly when `pg_dump` is missing or the dump is empty. Set `BACKUP_ENABLED=true` to run the same backup from the nightly maintenance job. The backend image includes `postgresql-client`; from a source checkout install it (or point `PG_DUMP_BIN` at the binary).
- **Restore drill** (run it before you need it):

  ```bash
  createdb nexus_restore_drill
  pg_restore --no-owner --no-privileges -d nexus_restore_drill backups/nexus-<stamp>.dump
  # sanity: row counts match the source for documents/workspaces/api_keys/webhooks
  dropdb nexus_restore_drill
  ```

  The digest is taken with the connection string split into `PG*` variables, so the password never appears in the process list or a log line.

### Installable app and offline review

Nexus ships a web app manifest and a service worker, so browsers offer **Install** and the app opens in its own window:

- The worker precaches the app shell, serves navigations network-first with an offline fallback, caches built assets stale-while-revalidate, and caches `/api/audio/*` cache-first so a read-aloud clip that has already played replays offline. Dev-server module and HMR paths are never intercepted, and the app runs normally when service workers are unavailable.
- The review screen caches the last due-card list per workspace. With the network off it opens from that cache, accepts ratings, advances the session without waiting on a dead request, and stores each rating in a local queue (one pending rating per card) with an offline banner and pending count. When `online` returns, the queue is replayed in order through the normal review mutation (FSRS schedules server-side), then the dashboard and due lists refresh.
- Offline state lives in `localStorage` on that device only: due-card prompts/answers and the rating queue. It is not encrypted, so treat a shared browser profile like a shared notebook. Clearing site data removes it.

### Observability

The API emits structured JSON logs (pino) with a request id, method, path, status and duration; secrets and auth headers are redacted. `GET /metrics` serves Prometheus metrics: `nexus_http_requests_total`, `nexus_http_request_duration_seconds`, `nexus_chat_ttft_seconds`, `nexus_chat_tokens_total`, `nexus_retrieval_duration_seconds{stage}`, `nexus_queue_jobs{queue,state}` (sampled at scrape) and the default process metrics. Set `METRICS_TOKEN` when the API is reachable from the internet:

```bash
curl -H "Authorization: Bearer $METRICS_TOKEN" http://localhost:3000/metrics
```

## Project structure

```
apps/
  backend/          Express + tRPC API, BullMQ worker, Drizzle schema/migrations
  frontend/         React + Vite SPA (tRPC client, workspaces, upload, chat)
packages/
  shared-types/     Shared DTO types between apps
extensions/
  browser/          Manifest V3 share target (save the current page)
docs/
  MISSION.md        Mission, ambition, learning model and success criteria
  decisions/        Architecture decision records (ingestion, retrieval, storage, UI)
.github/
  workflows/        CI, CodeQL, release
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
