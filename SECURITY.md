# Security Policy

Nexus is a self-hosted, single-user tool — but we still take security seriously.

## Supported versions

| Version | Supported    |
| ------- | ------------ |
| 0.4.x   | ✅ (current) |
| < 0.4.0 | ❌           |

Releases are tagged `vX.Y.Z` and published as GitHub Releases with container images on GHCR (`ghcr.io/pranesh-selvaraj/nexus-backend`, `ghcr.io/pranesh-selvaraj/nexus-frontend`). Security fixes land on `main` and ship as patch releases.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

To report a vulnerability:

1. Use GitHub's private reporting: **Security → Report a vulnerability** on the [repository](https://github.com/Pranesh-Selvaraj/Nexus/security/advisories/new), or
2. Email the maintainer (Pranesh Selvaraj) privately via the contact address on their GitHub profile.

Include as much of the following as possible:

- Type of issue (e.g. path traversal, RCE, SSRF, secret exposure, XSS)
- Affected component and file(s)/endpoints
- Steps to reproduce, including payloads or sample requests
- Impact and any suggested fix, if you have one

You will receive a response within **5 business days**. We will work with you to triage and fix the issue, and we will credit you in the advisory unless you prefer to stay anonymous.

## Known items / accepted risk

These are tracked internally and documented publicly so users can make informed decisions:

- **Optional authentication** — set `AUTH_PASSWORD` to require login; when unset the app runs in single-user no-auth mode. Either way, treat the app as a private tool: don't expose it to the public internet without a reverse proxy and TLS (`AUTH_COOKIE_SECURE=true`).
- **Voice recordings leave the device only when server dictation is selected.** Browser dictation uses the Web Speech API and is handled by the browser/OS vendor under their terms. When `voice.sttMode` is `server` (or the browser has no Web Speech support), the recorded clip is uploaded to the configured transcription provider — by default your main OpenAI-compatible endpoint. Point `WHISPER_LOCAL_URL` at a local faster-whisper server to keep audio on-premises. Recordings are not stored unless explicitly requested; cached read-aloud speech is retained for `AUDIO_RETENTION_DAYS` (default 7) and capped by `AUDIO_MAX_STORAGE_MB` (default 200 MB) with oldest-first eviction.
- **Pronunciation feedback is an estimate, not a grade.** It is computed locally by aligning the recogniser's transcript with the target text; cloud pronunciation-assessment APIs are not used.
- **Server-side URL fetching.** Importing a web article or YouTube transcript makes the API fetch a URL the user chose, so the connection originates inside the deployment network. Nexus refuses loopback, RFC1918, CGNAT, link-local, benchmarking, documentation and multicast ranges in IPv4, and ULA, link-local, multicast, documentation, IPv4-mapped, NAT64 and 6to4 ranges in IPv6 — including the `169.254.169.254` cloud-metadata endpoint. The check covers **every** address a hostname resolves to, and the connection is pinned to a validated address through a custom `lookup`, so a DNS-rebinding response between the check and the connect cannot redirect the request. Redirects are followed manually (3 by default) and re-validated at every hop; the body is capped (`INGEST_MAX_BYTES`, 5 MB) and the request has a wall-clock timeout (`INGEST_TIMEOUT_MS`). No cookies, auth headers or query credentials are forwarded, and URLs with embedded credentials are rejected. `INGEST_ALLOW_PRIVATE_HOSTS=true` disables the address classification for tests and private self-hosting — leave it off in any deployment that can reach the internet.
- **Uploaded files are validated by content, not by name.** The declared extension only filters obviously wrong picks; the real format comes from magic bytes (PDF, OOXML/ODF/ZIP containers, EPUB, RTF, HTML, images, audio/video) and an unrecognised payload is rejected with HTTP 400. Zip-style containers are opened under explicit limits (entry count, per-entry and total uncompressed size, compression ratio, nesting depth) so a zip bomb or a decompression loop fails fast instead of exhausting memory or disk; parsers run under a wall-clock timeout (`PARSER_TIMEOUT_MS`) and extracted text is capped (`MAX_TEXT_CHARS`). The stored filename is a server-generated UUID and the title is metadata only — it is never used to build a path.
- **OCR and vision are processed server-side and opt-in per feature.** Tesseract is invoked with a timeout and an 8 MB output cap; PDF rasterization is bounded by `OCR_MAX_PAGES`. Images sent to the vision provider are size-capped by `VISION_MAX_IMAGE_MB` and restricted to PNG/JPEG/WebP/GIF, are encoded in memory as data URLs (never written to a new path), and are never persisted in chat history — the stored message references the document id only. A vision analysis result is cached in process memory keyed by image hash + mode + question + model, and is dropped on restart.
- **Image bytes are served, not published.** `GET /api/images/:id` requires a session, resolves ownership through the workspace, only serves documents whose detected format is an image, and responds with `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox` and `Content-Disposition: inline`, so a crafted image cannot execute as a document in the app's origin.

## Security features

- `main` branch protection: only the repository owner can push directly; everyone else requires a reviewed PR with green CI
- Optional session authentication: scrypt-hashed password, httpOnly+SameSite cookie, server-side sessions stored as sha256 token hashes, login rate limiting (10/15min), uploads also require the session
- Audio upload hardening: dictation/pronunciation recordings are capped by `MAX_AUDIO_MB`, filtered by extension and declared MIME type, buffered in memory and written to server-generated random paths under the uploads volume (never derived from the uploaded filename). The audio streaming endpoint only serves assets owned by the session user and refuses paths outside the audio directory.
- Audio retention and quota: cached speech carries an expiry (`AUDIO_RETENTION_DAYS`, purged by the daily maintenance job) and a per-user storage cap (`AUDIO_MAX_STORAGE_MB`) enforced with oldest-first eviction, so audio cannot grow without bound.
- Ingestion hardening: magic-byte format detection, zip-bomb limits, per-parser timeouts, SSRF-safe URL fetching (see the accepted-risk items above for the full control list), a rate limit on `/api/ingest/url` (10 imports/minute), and OCR/vision output caps.
- Prompt-injection provenance: ingested web pages, transcripts and image descriptions are stored as ordinary document chunks and labelled with their source (`sourceUrl`, `fileType`, OCR/vision/transcript flags), so retrieved context can be attributed and inspected from the citation panel rather than treated as trusted instruction.
- Duplicate detection by `content_hash` is scoped per workspace, so an upload can only ever short-circuit against a document the same user owns.
- **API keys are scoped, hashed and revocable.** `ndx_…` keys are generated with 32 bytes of CSPRNG entropy, returned once at creation, and stored only as a sha256 hash plus a 12-character hex prefix for display and lookup. Comparison is constant-time, revocation is immediate (`401` on the next request), and every REST route checks a specific scope, so a read-only integration can never upload or ask on the owner's behalf. Session cookies are not accepted on `/api/v1`, which keeps a CSRF'd browser request from reaching the API surface, and workspace ownership is enforced per request (`404` rather than `403`). The settings UI and `/trpc/apiKey.*` are session-only, so a leaked key cannot mint or revoke keys.
- **Webhook deliveries are signed and address-checked.** A webhook target is user-supplied infrastructure the server calls, so it gets the ingestion address classification: loopback, RFC1918, link-local, CGNAT and cloud-metadata ranges are refused (including `169.254.169.254`), the check runs again in the worker at delivery time, redirects are not followed (a 30x cannot bounce the POST to an internal host), each request times out after five seconds, and only `http`/`https` targets without embedded credentials are accepted. `WEBHOOK_ALLOW_PRIVATE_HOSTS=true` is a documented local-testing override. The signing secret is 32 random bytes, encrypted at rest with `SETTINGS_SECRET`, shown once at creation, and never returned by the list endpoint; webhook creation is refused when no `SETTINGS_SECRET` is configured rather than storing the secret in the clear.
- **Domain packs install ordinary user data.** The five built-in packs are static, reviewed content compiled into the app; installing one creates a topic, a note, a deck and a welcome conversation owned by the caller. No pack executes code, fetches remote content or grants any permission beyond what the user already has.
- **Workspace access is membership-based and enforced server-side.** Every workspace-scoped operation resolves the caller's role from `workspace_members` (with the creator treated as owner) and requires at least reader/editor/owner for that action before querying or mutating data. Resource-level lookups (a document, deck, card, note, quiz, artifact or conversation id) join through the owning workspace, so a member cannot escape their scope by guessing ids. Non-members receive `404`, members with insufficient role receive `403`, and the creator can never be demoted or removed, so a workspace cannot be orphaned. The owner-only share links and member management are separate from the reader-facing learning endpoints.
- **Registration is opt-in and rate-limited.** `POST /api/auth/register` is disabled unless `ALLOW_REGISTRATION=true` (and authentication is enabled), applies the same login rate limiter, requires an email plus an 8-character password, hashes with scrypt, and gives the new account no access to any existing workspace. Sessions remain the same httpOnly cookie mechanism as login.
- **Share links are bearer capabilities.** A share URL (`/share/nxs_…`) is a secret: the token is 32 random bytes, shown once, stored only as a sha256 hash, optionally time-limited and revocable. The public endpoints (`GET /api/share/:token`, `POST /api/share/:token/ask`) ignore session cookies and API keys, expose only the workspace name, description, visible document metadata and grounded answers, never document contents, file bytes or settings, and are rate-limited per IP (30/min). A revoked or expired link is indistinguishable from an unknown one (`404`). Answers execute as the workspace owner for provider access but cannot write anything. Because possession is the only credential, do not put these links in public indexes or logs, and revoke them when a sharing session ends.
- **Workspace exports are owner-scoped copies.** `GET /api/workspaces/:id/export.zip` requires a session, resolves ownership before building anything, and refuses a workspace the user does not own with `404`. The zip contains the original stored files and conversation history in clear text; treat a downloaded export like the library itself (it is not encrypted).
- **Object storage credentials stay server-side.** With `STORAGE_DRIVER=s3`, bucket credentials are read from the environment, images are proxied through the authenticated API instead of being exposed by the bucket, and parsers download objects into a local cache under `S3_CACHE_DIR` (plaintext copies on disk, same trust boundary as the previous `UPLOAD_DIR`). Keep the bucket private; the API never returns presigned URLs. Deleting a workspace removes every object under its prefix, and the storage self-test only writes and deletes one `selftest/` object.
- **Backups are full copies of the database and must be protected like it.** `pnpm backup` writes a custom-format `pg_dump` (stored provider keys and webhook secrets included, encrypted at rest with `SETTINGS_SECRET`) to `BACKUP_DIR`; that directory needs filesystem permissions and off-host storage appropriate to the deployment, and restores should go to a scratch database first (the documented drill). The connection string is split into `PG*` environment variables so the password never appears in the process list, and the backend image ships `postgresql-client` for `pg_dump`/`pg_restore`.
- **The service worker keeps data on the device.** The PWA caches the app shell, built assets and `/api/audio/*` clips, and the review screen stores the last due-card list plus an offline rating queue in `localStorage`. This data belongs to the signed-in user on that device: clearing site data removes it, and a shared browser profile should be treated as a shared notebook. Cached speech is owner- and content-addressed by the API, but the cache is per browser profile, so do not rely on it as a per-user boundary. The worker never intercepts `/trpc/`, `/api/` other than audio, or dev-server module paths.
- **Trash is not deletion.** Moving a document to the trash removes its chunks (retrieval can no longer cite it) but the row and file remain until the purge window (`storage.trashDays`) elapses or the trash is emptied; disk usage and quotas include trashed documents.
- **Structured logs and metrics do not carry secrets.** Request logs redact `authorization`, `cookie`, `set-cookie` and any token/key/secret field, and `/metrics` can be closed with `METRICS_TOKEN` (bearer or `?token=`) when the API is publicly reachable.
- gitleaks secret scanning on every push and PR (blocking)
- GitHub dependency review on PRs (blocking for high severity)
- CodeQL static analysis on every push/PR plus a weekly schedule
- Dependabot for npm and GitHub Actions updates
- GitHub secret scanning with push protection enabled on the repository
- `pnpm audit` runs fail-closed in CI (zero known advisories as of the langchain 0.3 upgrade)
