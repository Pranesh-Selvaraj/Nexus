# Changelog

All notable changes to Nexus are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versioning follows [Semantic Versioning](https://semver.org/).

Releases are listed newest first. Every release uses the same layout: a `## [X.Y.Z] - YYYY-MM-DD` heading, an emoji on each section, and one emoji-prefixed, single-line entry per change. The release workflow extracts the section matching the pushed tag and publishes it verbatim as the GitHub Release body. Nexus is pre-1.0: the line continues in small, contained steps (`0.3.1 → 0.4.0 → … → 0.4.5`), and a feature-heavy release gets a patch bump rather than a new major.

## [Unreleased]

## [0.4.13] - 2026-10-25

Topics are now genuinely shared. Workspace memberships with reader/editor/owner roles replace "only the creator can touch this", every workspace-scoped query resolves the caller's membership before it runs, and the Members dialog lets an owner add people by email, change roles or revoke access. Account creation is opt-in, so a self-hosted deployment can stay single-user or open registration and build a small study group.

### ✨ Added

- 👥 **Workspace memberships and roles (L-13).** `workspace_members` (migration 0021) stores a role per user per workspace; every existing workspace is backfilled with its creator as owner. **Reader** can browse, chat, ask and practise; **Editor** can add/remove sources, generate cards/quizzes/notes and export; **Owner** (the creator) manages members, share links and deletion. The creator is always an owner and cannot be demoted or removed.
- 🧑‍🤝‍🧑 **A Members dialog.** The topic header shows the caller's role and opens a member list; owners add an existing account by email as reader or editor, change roles and remove people, while other members see the list read-only. Removal takes effect on the next request.
- 🔐 **Opt-in registration.** `ALLOW_REGISTRATION=true` (with `AUTH_PASSWORD` set) enables `POST /api/auth/register` and a **Create account** option on the login screen, with scrypt-hashed passwords and the same login rate limit. Registered accounts have no access to any topic until an owner adds them.
- 🛡️ **Membership-aware UI.** Topic headers show Owner/Editor/Read only, the Share and Delete actions are owner-only, readers lose the upload dropzone and the delete/retry/generate controls in the library, and shared topics appear in Home, Topics and the sidebar with their role.
- 🔌 **Role metadata for clients.** `workspace.list` and the REST `/api/v1/workspaces` payload expose the caller's role and topic metadata, and `members.list/add/updateRole/remove` are session-only.

### 🔧 Changed

- 🔎 **Every workspace query resolves membership.** The routers' ownership helpers and the inline ownership joins now use a shared `workspaceAccessPredicate`/`assertWorkspaceAccess` pair (creator or member), and resource lookups (documents, decks, cards, notes, quizzes, artifacts, conversations) join through the workspace before any mutation. Readers get `403` on writes; non-members get `404`.
- 📚 **The library rail and study tools follow the role.** Uploads, delete/retry/card generation and export are hidden or rejected for readers; review and chat remain available so a shared topic is still a learning space.
- 🧾 **Backups and share links stay owner/editor territory.** Zip export requires editor, share-link management requires owner, and the public share link remains a read-only capability endpoint with no membership involved.

### 🔒 Security

- 🧱 **Server-side role enforcement, not UI-only.** Access is resolved from `workspace_members` (creator fallback) on every request; the UI gating mirrors it but is never the boundary. Resource-id routes resolve the owning workspace, so an id from another topic cannot be used as a shortcut.
- 🕵️ **No workspace probing.** A missing membership and a missing workspace both return `404`; an existing membership without the required role returns `403`, so role names are only revealed to people already inside the topic.
- 👑 **The owner cannot be locked out.** The creator is treated as owner even without a membership row, cannot be removed or demoted, and owner-only operations (member management, share links, deletion, workspace settings) are checked independently of the editor role.
- 🔑 **Registration cannot escalate.** New accounts start with zero memberships, the endpoint is disabled by default, requires authentication to be enabled, validates email/password, hashes with scrypt and shares the login rate limiter; there is no self-service way to join a workspace except being added by its owner.
- 🧾 **Membership changes are auditable through the returned DTOs** (email, role, created date) and removal is immediate; the UI exposes the current role on the topic header.

### 🐛 Fixed

- 🚪 **A shared topic used to be unusable by anyone but its creator.** Inline `workspaces.user_id` checks meant every read and write returned `404` for a member; those checks now resolve membership and role, so a shared topic behaves like a normal topic for readers and editors.
- 👁️ **The UI had no concept of a non-owner.** There was no way to add a collaborator, no role display and no way to revoke access; the Members dialog and role-gated actions cover those gaps.
- 🧪 **Multi-user behaviour is now covered end to end in the smoke suite** (a second account signs in, is added as reader, cannot upload/delete, is promoted to editor, can upload, still cannot delete the workspace, and loses access when removed), so the access boundary is exercised on every run.

### 📝 Notes

- 🧪 **Verification:** 266 unit tests, smoke **174/174** (including the ten new membership/role checks against the auth-mode instance), **6/6** Playwright suites (single-user paths still pass, roles resolve to owner), and **58** visual captures including the Members dialog and the role badge; `typecheck`, `lint`, `format:check`, `build` and `pnpm audit` are clean.
- 🗄️ **Migration 0021** adds the role enum and `workspace_members` and backfills every existing workspace's creator as owner; no other table changes.
- ⏳ **Deliberately deferred:** email invitations and notifications (accounts must already exist), per-conversation or per-artifact sharing, comments, an audit log of membership changes, SSO/OIDC, and workspace-level settings ownership (app settings remain per deployment). Memberships use the existing `workspaces.user_id` as the immutable creator; ownership transfer is not implemented.
- 🧷 **Shared study state:** decks, cards, quizzes, notes and conversations are shared with the topic, so an editor's changes are visible to all members and a reader's reviews affect the shared deck schedule; per-member study state would need a schema change.

## [0.4.12] - 2026-10-25

Learning a new subject now starts from a curated pack. The Topics gallery ships five first-party domain packs (Spanish A1, Python foundations, reading a painting, cell biology, music theory); installing one creates a complete topic with a plan, a starter deck, starter questions and a welcome conversation — all editable, because a pack is a starting point, not a separate product.

### ✨ Added

- 🎒 **Five first-party domain packs (L-14).** Each pack bundles a persona suggestion, a short plan, three starter questions and a starter flashcard deck: Spanish for beginners (A1), Python foundations, How to read a painting, Cell biology essentials and Music theory basics. They are static, reviewed content compiled into the backend — no remote downloads, no code execution.
- 🗂️ **A pack gallery on the Topics page.** Each card shows the domain, description, deck size and plan length with **Install pack**; once installed it becomes **Open topic**, pointing at the workspace that already holds it, so a pack cannot be installed twice by accident.
- 🧭 **Installation creates a real topic.** The installer writes the lesson plan as an editable note (`Practice → Notes`), creates a starter deck whose cards are due immediately (`Practice → Decks`), opens a "Start here" conversation summarising the plan and how to practise, and stores the pack metadata (icon, persona suggestion, plan, starter prompts) on the workspace.
- 💬 **Starter questions in the chat.** Pack topics show a "Try asking" strip above the conversation with the pack's three questions; clicking one copies it for the composer, so the first session has a concrete next action.
- 🏷️ **Pack identity in the UI.** The topic header shows the pack icon and the plan/help text points to the notes; workspace DTOs and the REST `/api/v1/workspaces` payload carry the metadata for clients.

### 🔧 Changed

- 🗃️ **Workspaces gained optional metadata.** Migration 0020 adds `workspaces.metadata` (JSONB) for `packId`, `icon`, `personaId`, starter prompts and plan; ordinary topics leave it null, and the existing workspace payloads include it without changing any other field.
- 🧩 **Topics remain the single object.** Installing a pack creates a normal workspace with a note, deck, conversation and cards rather than a parallel "course" entity, so everything stays editable with the existing study, chat and library tools.
- 📚 **Documentation** describes the packs and their contents and states explicitly that they are starting points.

### 🔒 Security

- 🧱 **Packs are inert content.** Installing a pack only writes rows the caller owns (workspace, deck, cards, note, conversation); it cannot execute code, contact the network or read another user's data, and pack content is shipped in the repository rather than fetched at runtime.
- 🧾 **No new authorization surface.** `packs.list` and `packs.install` are protected procedures scoped to the signed-in user; installation reuses the same workspace ownership rules as manual creation.
- 📦 **`qs` advisory closed (GHSA-6pq8-jhm2-2vcw).** `qs.stringify` with `arrayFormat: 'comma'` could throw an uncaught `TypeError` on array elements with a non-callable own `toString`, a denial-of-service vector reachable through Express query parsing; the workspace override now requires `qs >= 6.16.1` (previously >= 6.16.0, which admitted the vulnerable 6.16.0). `pnpm audit` is back to zero.

### 🐛 Fixed

- 🧭 **New learners faced an empty topic after creating one** with no idea what to do first; a pack now provides a plan, questions and due cards from the first minute.
- 🧪 **The visual harness could not re-install a pack on a reused database** because the pack showed "Open topic"; the harness now removes the previous pack topic first, and the Playwright pack suite does the same so runs are repeatable.

### 📝 Notes

- 🧪 **Verification:** 266 unit tests, smoke **164/164** (packs list shape, install metadata, starter deck with ≥5 cards, plan note, welcome conversation; plus all prior checks), **6/6** Playwright suites including a pack-install flow that opens the plan in Notes and the deck in Decks, and **57** visual captures including the gallery and an installed pack topic. `typecheck`, `lint`, `format:check`, `build`, `pnpm audit` and `pnpm peers check` are clean.
- 🗄️ **Migration 0020** adds the nullable `workspaces.metadata` column; existing topics are unaffected.
- ⏳ **Deliberately deferred:** user-authored/importable packs, pack versioning and updates, pack-specific retrieval profiles, more domains (history, maths, law, music OMR), and the remaining collaboration work (memberships/roles, comments, audit log) and i18n.
- 🧷 **Pack content is intentionally small.** Each starter deck has 5–6 cards and the plans have 5–7 steps; they are seeds for the learner's own sources and questions, not a replacement for a full curriculum.

## [0.4.11] - 2026-10-25

Nexus is now a learning portal rather than a document chat tool. The app opens on a universal dashboard, topics replace workspaces as the primary object, and every topic is organised around four ways to learn: Learn, Practice, Voice and Language. The underlying features are the same ones from the previous phases — the rewrite is the navigation, the framing and the dashboard that makes them feel like a course, not a file manager.

### ✨ Added

- 🏠 **Universal learning dashboard.** Home aggregates everything the learner owns: topics, sources, cards due now, reviews completed today and words ingested, a "Continue learning" grid with due badges, a suggested next step (the topic with the most due cards), suggested activities (ask, make flashcards, take a quiz, practise a language) and the most recently added sources. Backed by one new `dashboard.overview` endpoint instead of N per-workspace calls.
- 🗂️ **Topics as the primary object.** A `Topics` gallery lists every learning space with its source count and due work, searchable, with inline creation (name plus an optional learning goal) and backup import. The sidebar keeps a quick topic list, so switching subjects is one click from anywhere.
- 🧭 **Topic page with four learning modes.** Each topic has **Learn** (grounded chat plus a Sources rail for uploads, URLs and the library), **Practice** (study dashboard, flashcards, quizzes, studio artifacts and notes), **Voice** (push-to-talk tutor) and **Language** (vocabulary, dictation, pronunciation, CEFR progress), with Share, Export, re-index and Delete in the topic header.
- 📊 **A dashboard aggregate with real numbers.** `dashboard.overview` returns per-topic source/due/processing counts, total documents, due cards, reviews today, words ingested and the six most recent documents, so the portal can answer "what should I do now?" without a round-trip per topic.
- 📱 **A responsive shell.** Sidebar navigation on desktop, an off-canvas drawer and compact header on mobile, and an accessible learning-modes navigation (`aria-label="Learning modes"`) on every topic.

### 🔧 Changed

- 🧱 **Workspaces are presented as topics throughout the shell** (the API and database keep the workspace name, so integrations and existing data are unaffected). Creating a topic opens it directly; the old "select or create a workspace" empty state is gone.
- 💬 **Chat and sources no longer compete for the main column.** The Sources rail (upload, URL import, document cards, trash) lives on the Learn mode; Practice, Voice and Language get the full width.
- ⏳ **Chat stays mounted across mode switches**, so a streamed answer or an in-flight request survives moving to Practice and back.
- 🧪 **Test suites and the visual harness were retargeted** to the new navigation and wording (create topic, Learn/Practice/Voice/Language, dashboard first), rather than papering over the change with compatibility labels.
- 📝 **Documentation** now leads with the portal model: a new "learning portal" section, a decision record (ADR 0004) for the shell, and refreshed feature copy.

### 🔒 Security

- 🔐 **The rewrite changes no authorization surface.** Every mode uses the same authenticated tRPC procedures as before; the only public route remains the capability share page, which is rendered outside the authenticated shell exactly as before.
- 📉 **The dashboard aggregate is owner-scoped.** `dashboard.overview` filters workspaces, documents, decks and reviews by `workspaces.user_id`, so a multi-account deployment cannot see another learner's summary.

### 🐛 Fixed

- 🧭 **There was no cross-topic view of due work,** so learners had to open each workspace to discover what needed review; the dashboard and topic badges surface it directly.
- 🗂️ **The old sidebar mixed conversation history, workspaces and settings in one column,** which scaled poorly and made source management fight the chat for space; the new shell separates navigation (topics), learning modes and the sources rail.
- ♿ **The learning-mode navigation is labelled for assistive technology** (`Learning modes`), and the previous ambiguity where a "Mode" label collided with the persona selector was resolved with exact labelling.

### 📝 Notes

- 🧪 **Verification:** 266 unit tests, smoke **159/159** (including a `dashboard.overview` aggregate assertion: topics/documents/due/recent shape and the API workspace counted), **5/5** Playwright suites (updated to the new navigation: create topic → Learn → Practice → Voice/Language, offline review, sharing), and **55** visual captures against the new shell with 0 failed steps (dashboard, topics, topic modes, library rail, settings, queue, sharing, offline, mobile). `typecheck`, `lint`, `format:check`, `build` and `pnpm audit` are clean.
- 🗄️ **No database migration.** The dashboard reads existing tables; "topic" is a presentation name for a workspace.
- ⏳ **Deliberately deferred:** in-app URLs/deep links for topics and conversations (state-based navigation still), a dedicated library mode beyond the Sources rail, onboarding tours, theme switching, and the remaining collaboration work (memberships/roles, comments, audit log) and domain packs from the previous phase plan.
- 🎨 **Visual language:** dark zinc surfaces with an indigo accent retained, but spacing, headings, cards and empty states were reworked for a calmer reading and study experience; all previously shipped screens (settings, API keys, webhooks, storage, queue, sharing, offline) are reachable and unchanged in behaviour.

## [0.4.10] - 2026-10-25

Phase 7 starts the collaboration track with read-only sharing: any workspace can be published as a capability link that lets someone read the library and ask grounded questions without an account — and that cannot modify anything. Token-based sharing is deliberately the first step before memberships and roles, because it adds a new surface instead of rewriting every existing ownership query.

### ✨ Added

- 🔗 **Read-only share links (L-13).** **Share** in the workspace toolbar creates a capability URL (`<PUBLIC_BASE_URL>/share/nxs_…`) with an optional label and expiry (7/30/90 days or never). The token is 32 random bytes, returned exactly once and stored only as a sha256 hash, so the database cannot be replayed into a working link. Existing links are listed with creation date, expiry and status, and can be revoked; the list never re-displays the URL by design.
- 🌐 **A public shared-workspace page.** `/share/<token>` renders without a session: workspace name and description, the visible document list with format/word counts, and a question box whose answers come from the normal retrieval pipeline and cite their sources. It is strictly read-only — there is no path from the shared surface to uploads, edits, deletions, exports, settings, chat history or API keys.
- 🔌 **Two capability endpoints.** `GET /api/share/:token` returns the read-only workspace view and `POST /api/share/:token/ask` answers a question with `{ answer, sources, query }`. Both ignore cookies and API keys, are rate-limited per IP (30 requests/minute), send `Cache-Control: no-store`, and treat revoked, expired and unknown tokens identically (`404`).
- 🧾 **Management API.** `share.list`, `share.create` and `share.revoke` are session-only, so an API key cannot mint a capability URL for a workspace; creation and listing resolve workspace ownership first.

### 🔧 Changed

- 🧭 **The workspace toolbar now has a Share action** next to the Chat/Study/Voice/Language tabs, opening a dialog that explains the read-only semantics before a link is created.
- 🌍 **Link URLs use a configurable public host.** `PUBLIC_BASE_URL` sets the origin written into share URLs (falling back to the first `FRONTEND_ORIGIN`), so links created from a LAN or proxied deployment point at the address visitors can actually reach.
- 📱 **The public page is a separate app entry**, not the authenticated shell: it renders even when logged out, has no sidebar or settings, and does not read a session.

### 🔒 Security

- 🔑 **Tokens are hashed at rest and shown once.** A share URL is a bearer capability; only its sha256 is stored, so a backup or database read does not reveal working links. Revocation takes effect immediately, expiry is checked on every request, and the management list cannot recover a lost token.
- 🚧 **The shared surface is structurally read-only.** The public routes only call the read path of retrieval and the answer pipeline; they cannot reach upload, delete, settings, export, queue admin or key management, and they never return document contents, stored file bytes or conversation history.
- 🧱 **Abuse controls are explicit.** Both endpoints share a 30/minute per-IP limiter, tokens must match the `nxs_` format before any database lookup, and responses are marked non-cacheable so a shared answer does not linger in intermediary caches.
- 🧾 **Sharing is documented as a capability.** SECURITY.md states that possession of the URL is the only credential, so links should not be posted publicly and should be revoked when a sharing session ends; answers execute as the workspace owner for provider access but cannot write anything.
- 🧪 **Verification includes the negative cases:** revoked/expired/unknown tokens return `404`, the management list never contains a token, and the public page cannot trigger a mutation.

### 🐛 Fixed

- 🛠️ **The workspace header had no place for workspace-level actions.** The tab bar now hosts Share without disturbing the mode switch, and the dialog closes on backdrop click while trapping its own interactions.

### 📝 Notes

- 🧪 **Verification:** 266 unit tests, **158/158** smoke checks (link creation returns the URL once, list hides tokens, public view and ask work without a session, revocation and unknown tokens are `404`, plus the existing suites), **5/5** Playwright suites including a share flow that opens the public page, asks a question and sees revocation, and 55 visual captures including the dialog, one-time URL and shared page. `typecheck`, `lint`, `format:check`, `build`, `pnpm audit` and `pnpm peers check` are clean.
- 🗄️ **Migration 0019** adds `workspace_share_links` (workspace/user foreign keys with cascade, unique token hash, expiry, revocation). Links are per-workspace and unaffected by later document changes: the view always reflects the current library.
- ⏳ **Deliberately deferred to the rest of L-13:** workspace memberships and roles (owner/editor/reader), invitations by email, per-conversation or per-artifact share links, comments and the audit log. Memberships require changing every ownership check in every router, so they will land as one migration with a security test per router rather than being mixed into this read-only surface.
- 🧷 **Limits of capability sharing:** there is no per-link usage analytics, no password on a link, no domain restriction, and a link grants access to every visible document in the workspace (trashed documents are excluded). Rotating a link means revoking it and creating a new one.

## [0.4.9] - 2026-10-25

Phase 6 makes Nexus operable: an admin view of the indexing queue with retry/drop, a zip workspace export that contains the original files, and a storage abstraction so documents can live in S3-compatible object storage instead of a single host's disk. Local disk stays the default; object storage is opt-in.

### ✨ Added

- 🛠️ **Indexing queue admin (P-3).** Settings → Indexing queue shows waiting, active, delayed, failed, completed and paused counts read straight from BullMQ, plus every failed job with its document title, sanitized error, attempt count and failure time. Each job can be **Retried** (job id equals document id; the document returns to `processing` with its stored error cleared) or **Dropped** without retrying. The card refreshes every five seconds, and the endpoints are session-only so an API key cannot clear queue state.
- 🗜️ **Zip workspace export (B-5).** The library's **Export workspace (.zip)** button now downloads an archive containing `workspace.json` (workspace metadata, document manifest without inline payloads, and full conversations), `README.txt` and the original stored files under `documents/`. Exports are owner-scoped, capped at 300 MB per archive with an actionable error above that, and the JSON archive over `workspace.export` remains the round-trip format used by import. Both paths share one query/builder in `workspace-archive.service`.
- 🗄️ **S3-compatible document storage (P-6).** `STORAGE_DRIVER=s3` moves document bytes to any S3-compatible bucket (AWS, MinIO, R2); local disk remains the default and needs no configuration change. Keys are the existing workspace-scoped paths, the API proxies image previews so buckets stay private, parsers download objects once into `S3_CACHE_DIR` via a `materialize` step, deletion removes the object, and deleting a workspace removes every object under its prefix. `S3_ENDPOINT`, `S3_REGION`, `S3_FORCE_PATH_STYLE` (defaults to true with an endpoint, as MinIO requires), `S3_KEY_PREFIX` and the credential variables configure it; `docker-compose.s3.yml` adds a MinIO service and wires the API and worker to it.
- 🧪 **`storage:selftest`.** `pnpm --filter @nexus/backend storage:selftest` round-trips one object through the configured driver (put/get/materialize/delete) and prints the backend description, so S3 credentials can be validated before a deployment switches over.

### 🔧 Changed

- 🧩 **Export building is shared.** The tRPC `workspace.export` procedure and the zip download now call one `exportWorkspaceArchive` implementation, so the two formats cannot disagree about documents or conversations.
- 🧱 **All document file I/O goes through the storage driver.** Uploads and URL imports write through `put` (with rollback on enqueue failure), the worker resolves parser input through `materialize`, chat attachments and vision analysis read through `get`, image previews stream through `get`, trash purge deletes the object, and workspace deletion clears the prefix. Audio cache and workspace archives keep their own local directories (they are not document storage).
- 📊 **Startup logs name the backend.** The API and worker print `document storage: local disk (<path>)` or `s3 (<bucket>[/prefix])`, so a deployment can see which backend it is actually using.

### 🔒 Security

- 🔐 **Bucket credentials stay server-side.** S3 credentials come from the environment, previews are proxied through the authenticated API rather than exposed by the bucket, and no presigned URLs are issued. Keep the bucket private.
- 🧾 **Exports are owner-scoped plaintext copies.** `GET /api/workspaces/:id/export.zip` requires a session and returns `404` for a workspace the caller does not own; the zip contains original files and conversation history in clear text, so treat a download like the library itself.
- 🧹 **Queue actions are session-only.** `admin.queue`/`retryJob`/`removeJob` cannot be called with an API key, and job errors are sanitized before display (`sanitizeForLog`), so a provider response cannot inject markup into the admin view.
- 🗂️ **Storage keys are validated.** Absolute paths, backslashes and `..` segments are rejected before any filesystem or object-store operation, and workspace deletion only removes the caller's workspace prefix.

### 🐛 Fixed

- 🧷 **Export failures were silent in the UI.** The previous JSON download resolved through a tRPC refetch and swallowed errors; the zip path reports the API's error message in a toast and uses the server-provided filename.
- 🧪 **Queue failures lacked a document-level explanation.** Failed jobs only surfaced in worker logs; they now show the document title and sanitized error in Settings, with retry/drop actions that update the document state.

### 📝 Notes

- 🧪 **Verification:** 266 backend unit tests across 32 files (5 new local-storage tests: round-trip, materialize, delete/prefix, traversal rejection, description), **152/152** smoke checks (zip magic/content-type, manifest/readme/file entries, foreign-workspace 404, admin counts, unknown-retry NOT_FOUND), **4/4** Playwright suites, and 52 visual captures including the queue card; `typecheck`, `lint`, `format:check`, `build`, `pnpm audit` and `pnpm peers check` are clean.
- 🔬 **S3 was verified end-to-end, not just configured.** Against an S3-compatible mock: uploaded a document through the API, the worker materialized and parsed the object from the bucket, the document reached `ready`, an uploaded PNG was served back through `GET /api/images/:id` with identical bytes, and deleting the workspace removed every object under its prefix. The shared `storage:selftest` repeats the adapter round-trip for any deployment.
- 🧭 **Decision record:** `docs/decisions/0003-document-storage-abstraction.md` explains the `StorageDriver`/`materialize` shape, path-style S3 defaults, keeping local disk as the default, and the alternatives (always-S3, presigned URLs, streaming parsers, a media service).
- ⏳ **Deliberately deferred:** multi-user sharing and roles (L-13), domain packs (L-14), i18n (U-7), cursor pagination across the UI, OpenTelemetry traces / Sentry-compatible reporting, and a Helm chart. The queue is still one `embedding` queue (no parse/embed/tts split); the admin view covers failed jobs, not per-queue priorities. Switching to S3 has no object-copy/migration command — existing local files must be copied into the bucket under their stored keys.

## [0.4.8] - 2026-10-25

Phase 5 is about running Nexus at a size it was not designed for. Retrieval now plans against per-dimension HNSW indexes instead of scanning every vector, the workspace moved onto chunks so the ANN scan can filter without a join, and a load-test harness measures the result rather than guessing (100k chunks: 7ms p50 versus 152ms for the exact-scan path). Release images are built for amd64 and arm64, and an optional GPU profile runs local Whisper.

### ✨ Added

- ⚡ **Approximate retrieval with HNSW (R-17).** Migration 0017 backfills `chunks.embedding_dims` and creates one partial HNSW index per supported embedding dimension (384, 512, 768, 1024 and 1536 as `vector`; 2048 and 3072 as `halfvec`, because `vector` HNSW stops at 2000 dimensions). Retrieval pins the active dimension as a validated literal in the filter and the cast, so the planner can match the right partial index and fall back to an exact scan only when that is actually cheaper.
- 🧱 **The workspace is denormalised onto chunks (R-17).** Migration 0018 adds `chunks.workspace_id` (backfilled from the document, cascade FK, indexed) and the worker writes it on every insert. Retrieval, keyword search and attached-image lookup now filter on the scanned table, so the ANN scan no longer needs a join before it can apply the workspace predicate. The migration is idempotent, and it sets `hnsw.iterative_scan = relaxed_order` per database (skipped on pgvector versions that do not support it) so a selective filter cannot starve the result set.
- 🧪 **A load-test harness (R-17).** `pnpm --filter @nexus/backend load-test` seeds a synthetic workspace with N chunks of the configured dimension, prints the query plan, reports p50/p95/max for the vector arm and removes the workspace unless `--keep` is passed. `LOAD_TEST_CHUNKS`/`LOAD_TEST_DIMS`/`LOAD_TEST_QUERIES` make it reproducible through pnpm. The README envelope table now carries measured numbers instead of an estimate.
- 🏗️ **Multi-arch release images (P-9).** The release workflow sets up QEMU and publishes both the backend and frontend images for `linux/amd64` and `linux/arm64`, so Apple Silicon, ARM servers and Raspberry-Pi-class hosts pull a native image instead of emulating one. Both images still update `latest` on a stable tag.
- 🎙️ **An optional GPU transcription profile (P-9).** `docker-compose.gpu.yml` adds a `faster-whisper` sidecar with an NVIDIA device reservation and points the API and worker at it through `WHISPER_LOCAL_URL`; `WHISPER_MODEL` selects the model. CPU-only deployments are unaffected, and the local sidecar is still only used as the fallback when the configured provider transcription fails.

### 🔧 Changed

- 🔍 **The vector arm's SQL is dimension-pinned.** The query orders by a cast to the active dimension and compares against the same cast type, so the partial index and the similarity expression agree; the similarity column uses the identical expression to keep the distance consistent with the ordering.
- 🗂️ **Storage/workspace counts are explicit.** Library and sidebar counts exclude trashed documents; storage usage and quotas include them (unchanged behaviour, now documented alongside the retrieval changes).
- 📦 **Migration snapshots are back in sync.** The two custom migrations carry real generated snapshots, so the next `db:generate` sees the actual schema (including `chunks.workspace_id`) instead of trying to add it again.

### 🔒 Security

- 🧮 **Approximate retrieval changes recall, not access.** The workspace filter remains in every retrieval query (now on `chunks` as well as through the document join in the surrounding code), and the API's ownership checks are unchanged; ANN only changes which chunks are candidates, never which workspaces are visible.
- 🧱 **The denormalised column is protected by the database.** `chunks.workspace_id` is `NOT NULL` with a `workspaces` FK using `ON DELETE cascade`, so deleting a workspace still removes its chunks and a chunk cannot be orphaned from a workspace.
- 🗄️ **Index builds are migration work.** The HNSW indexes are created inside the migration transaction; on a very large existing corpus expect the upgrade to take longer and plan the maintenance window accordingly. The load-test harness creates and removes its own synthetic workspace and is not part of the product runtime.

### 🐛 Fixed

- 🧷 **A legacy-corpus query path could silently drop chunks.** Retrieval used to match legacy rows with `vector_dims(embedding)`; the dimension backfill makes `embedding_dims` authoritative, so those rows are now indexed like any other instead of depending on a runtime function in the filter.
- 🧪 **Two smoke seeds broke after the denormalisation.** The direct chunk inserts in the smoke suite now set `workspace_id` (and the legacy-reindex fixture keeps its NULL dims deliberately), which keeps the reindex and hybrid-retrieval checks honest.

### 📝 Notes

- 📊 **Measured envelope** (this machine, synthetic vectors, vector arm only): 20k chunks @1536 dims → exact scan chosen by the planner, p50 152ms / p95 179ms; 100k chunks @768 dims → partial HNSW index used, p50 7ms / p95 10ms. Numbers and the harness command are in the README.
- 🗄️ **Migrations 0017–0018** backfill `chunks.embedding_dims` and `chunks.workspace_id`, add the seven partial HNSW indexes, the workspace FK/index and the pgvector iterative-scan setting. No table is rewritten beyond the two backfills.
- 🧠 **Decision record:** `docs/decisions/0002-approximate-retrieval-at-scale.md` explains why the per-dimension partial indexes, the chunk-level workspace and iterative scans were chosen over halfvec-everywhere, per-dimension columns, partitioning or a separate vector store.
- ⏳ **Still deferred from the platform phase:** the S3/MinIO storage driver, zip workspace export, multi-user sharing and roles (L-13), domain packs (L-14), i18n (U-7), the queue split with a dead-letter admin view (P-3), cursor pagination across the UI, and OTel/Sentry reporting. ARM images and the GPU profile ship here; a Helm chart does not.
- 🔬 **The load test measures the vector arm, not a full chat turn.** Query rewriting, reranking (off by default), embedding the query and the model call are outside its numbers; the README says so next to the table.

## [0.4.7] - 2026-10-25

Phase 4b opens Nexus up and makes it operable. A scoped REST API, signed webhooks, an MCP server, a CLI and a browser share target let other tools use the same workspace; request ids, structured logs and Prometheus metrics make a chat turn observable; storage quotas, a restorable trash and tested `pg_dump` backups make the data safe to keep; and an installable PWA lets you review cards offline and sync when you reconnect. This is the release where Nexus stops being only a browser tab and becomes a platform you can run, integrate with and trust with your library.

### ✨ Added

- 🔑 **Scoped API keys and a REST API (P-5).** Settings → API keys creates `ndx_<prefix>_<secret>` keys with 32 bytes of CSPRNG entropy, returned once and stored only as a sha256 hash plus the display prefix; comparison is constant-time, the last-used timestamp refreshes at most once a minute, revocation takes effect on the next request, and scopes are additive and checked per route. `/api/v1` exposes `GET /me`, `GET /workspaces`, `GET /documents`, `GET /search`, `POST /ask`, `POST /documents` (multipart), `POST /urls`, `POST /notes`, `GET /reviews/due` and `POST /reviews`. Search and ask reuse the chat retrieval pipeline, so an integration sees the same ranking and cited sources; ask returns one non-streaming payload with usage and retrieval/first-token/total timings.
- 🪝 **Signed webhooks (P-5).** Settings → Webhooks registers an endpoint for `document.indexed` and `document.failed`. Deliveries carry `X-Nexus-Signature: sha256=<HMAC-SHA256 of the raw body>` (secret shown once, AES-256-GCM encrypted with `SETTINGS_SECRET`), `X-Nexus-Event` and `X-Nexus-Delivery`, time out after five seconds, do not follow redirects, and retry five times with exponential backoff; the last status/error is recorded on the endpoint so a receiver that starts failing is visible in Settings.
- 🧠 **MCP server, CLI and a share target (P-5).** `pnpm --filter @nexus/backend mcp` speaks MCP over stdio and exposes `list_workspaces`, `list_documents`, `search`, `ask` and `create_note`, configured with `NEXUS_BASE_URL` and `NEXUS_API_KEY`; every call goes through the scoped REST API, so scopes and ownership are enforced in one place. `pnpm --filter @nexus/backend cli` covers `workspaces`, `documents`, `search`, `ask`, `upload`, `url`, `due`, `review` and `note`. `extensions/browser` is a Manifest V3 share target that saves the current tab URL into a workspace — extraction happens server-side, and host access is optional and requested only for the configured Nexus origin.
- 📈 **Observability (P-1).** Every request gets an id (caller-supplied `X-Request-Id` or generated) echoed in the response, pino writes structured request logs with authorization/cookie/token fields redacted, and `GET /metrics` publishes Prometheus series for request count/duration, chat time-to-first-token, token usage, retrieval stage timings (`rewrite`, `candidates`, `rerank`, `total`, plus `api-search`/`api-ask`) and embedding queue depth sampled at scrape. Set `METRICS_TOKEN` to require a bearer token (or `?token=`) on the scrape endpoint.
- 🗄️ **Storage quotas and a restorable trash (P-6).** Documents record `size_bytes`; `storage.quotaMb` (default 5 GB, `0` disables) is enforced before an upload or URL import writes anything, returning `413` with the used/quota numbers, and trashed documents keep counting until purged. Deleting is now a soft delete: the document moves to `status = 'deleted'` with `deleted_at`, its chunks are removed immediately so retrieval can never cite it, and the row plus file are kept for `storage.trashDays` (default 30). The delete toast offers **Undo** (12 seconds), the library has a **Show trash** section with Restore per document and Empty trash permanently, and restoring re-queues indexing from the stored file. The nightly maintenance job purges expired trash (row and file).
- 📊 **Storage dashboard.** Settings → Storage shows used bytes against the quota, document and trash counts, the three largest workspaces and the retention policy; a new Storage & trash settings group exposes the quota and retention values.
- 💾 **Backups with a restore drill (P-6).** `pnpm --filter @nexus/backend backup` writes a custom-format `pg_dump` to `BACKUP_DIR` (default `./backups`), prunes files past `BACKUP_RETENTION_DAYS` (default 7) and fails loudly when `pg_dump` is missing, the connection fails or the dump is empty. The connection string is split into `PG*` environment variables so the password never appears in the process list, `BACKUP_ENABLED=true` runs the same backup from the nightly maintenance job, and the backend image now bundles `postgresql-client` for `pg_dump`/`pg_restore`.
- 📱 **Installable PWA with offline review (P-8).** A web app manifest (maskable 192/512 icons, standalone display) and a service worker make Nexus installable. The worker precaches the shell, serves navigations network-first with an offline fallback, caches runtime assets stale-while-revalidate and caches `/api/audio/*` cache-first so speech already played replays offline; dev-server module paths are never intercepted and the app works without a worker. The review screen caches the last due-card list per workspace; with the network off it opens from that cache, accepts ratings, shows an offline banner with the pending count and queues each rating locally (one pending rating per card). When the connection returns the queue replays in order through the normal review mutation, FSRS schedules server-side, and the dashboard, decks and due lists refresh.

### 🔧 Changed

- 🧩 **One upload path, one review path.** Magic-byte admission, duplicate detection, file writing and queueing moved into `ingestUpload`, shared by `/api/upload` and `POST /api/v1/documents`; URL extraction moved into `ingestUrlForWorkspace`; due-card listing and FSRS review submission moved into `review.service`, shared by the study UI and `/api/v1/reviews/*`. The API can no longer drift from a rule the browser follows.
- 🚪 **API authentication is key-only.** `/api/v1` deliberately does not read session cookies, so a cross-site form post cannot drive an integration; unknown or revoked keys are `401`, a live key missing the route's scope is `403` with `requiredScope`, and another user's workspace is `404` rather than `403`. Key management itself is session-only, so a leaked key cannot mint or extend keys.
- 🧮 **Library and storage counts answer different questions.** The library and workspace sidebar count documents you can see (trash excluded), while storage usage and quotas include trashed files until they are purged — the quota protects disk, the library describes the corpus.
- 🔔 **Toasts can carry an action and moved below the mode tabs**, so "Undo" cannot be missed and a toast never covers the library trash/export controls, the composer or the tab bar (the visual harness caught a delete blocked by the old bottom-right placement).
- 🧹 **Privileges that no route enforces are not offered.** The API-key dialog initially listed upload/review scopes before their endpoints existed; scopes now ship together with the routes that enforce them, and a stored scope this build does not know grants nothing.

### 🐛 Fixed

- 📉 **Every workspace reported 0 documents on the REST API.** The `/api/v1/workspaces` count interpolated `${workspaces.id}` inside a correlated subquery; drizzle rendered it as a bare `"id"`, which resolved to `documents.id` and never matched. The outer column is now fully qualified, and the smoke suite asserts the count itself instead of only the shape.
- 💥 **Every upload failed after storage accounting landed.** The storage aggregate used a `d.size_bytes` alias that drizzle never emits (the generated SQL says `from "documents"`, not `documents d`), so the quota check threw and uploads returned 500. The aggregate now uses the quoted table name, and the smoke suite exercises a real upload before checking usage.
- 🗑️ **The sidebar still counted trashed documents.** After a delete the library showed two documents while the workspace badge showed three; workspace counts in both the tRPC list and the REST route now exclude `deleted` rows.
- 🧵 **A document deleted while indexing was reported as a failure.** The worker's failure handler now checks whether the row still exists and logs a dropped job instead of marking a deleted document failed or retrying forever (carried over from the ingestion work).

### 🔒 Security

- 🔐 **API keys are hashed, scoped and revocable.** Secrets are 32 random bytes, stored only as sha256 plus a display prefix, compared in constant time, revocable immediately, and managed only through a session — the key cannot escalate itself. Session cookies are not accepted on `/api/v1`.
- 🪝 **Webhook targets get the ingestion address classification twice.** The URL is validated when it is saved and again in the delivery worker: loopback, RFC1918, link-local, CGNAT and cloud-metadata ranges are refused, redirects are not followed (a 30x cannot bounce the POST to an internal host), each request times out after five seconds, and `WEBHOOK_ALLOW_PRIVATE_HOSTS=true` is a documented local-testing override. The signing secret is encrypted at rest, shown once and never returned by the list; creation is refused when `SETTINGS_SECRET` is missing rather than storing it in the clear.
- 📊 **Metrics and logs do not leak secrets.** Request logs redact authorization, cookies, tokens, keys and secrets; `/metrics` can be closed with `METRICS_TOKEN`; `X-Request-Id` values are length-capped before being echoed.
- 💾 **Backups are full copies of the database and are treated as such.** `pg_dump` receives the connection split into `PG*` variables (no password in argv or logs), the image ships `postgresql-client`, and the documented restore drill restores into a scratch database before anything touches the live one. Stored provider keys and webhook secrets inside a backup are still encrypted with `SETTINGS_SECRET`, so protect the backup directory and the secret with the same care as the database.
- 📱 **The service worker keeps data on the device by design.** Cached shell/assets, cached speech and the offline review queue live in the browser profile; clearing site data removes them, and a shared profile should be treated as a shared notebook. The worker only intercepts same-origin GETs (never `/trpc/`, `/api/` other than audio, or dev-server module paths).
- 📦 **`pnpm audit` reports zero vulnerabilities and `pnpm peers check` is clean** after this phase's dependency work; no new advisories were suppressed or ignored.

### 📝 Notes

- 🧪 **Verification:** 261 backend unit tests across 31 files plus 6 shared-types tests, **146/146** smoke checks against real Postgres/Redis with the deterministic provider (API-key auth/scope/404 matrix, REST search/ask/upload/duplicate/URL SSRF refusal/notes/reviews, webhook signing and a real `document.indexed` fan-out, trash/restore and storage accounting, metrics), **4** Playwright suites (happy path, ingestion + vision + URL import, voice & language, and the new offline-review flow), and **51** visual-QA captures including the trash, storage, webhook and offline-review screens. `typecheck`, `lint`, `format:check`, `build`, `pnpm audit` and `pnpm peers check` are clean.
- 🗄️ **Migrations 0014–0016** add `api_keys`, `webhooks`, `documents.size_bytes`, `documents.deleted_at` and the `deleted` document status. Existing documents start with `size_bytes = 0` (so the dashboard under-reports until they are re-uploaded) and none are trashed; no backfill is required.
- 🧪 **The restore drill was executed, not just documented:** a 0.55 MB custom-format dump was restored into a scratch database, row counts matched the source exactly (documents, workspaces, api keys, webhooks) and the scratch database was dropped.
- ⏳ **Deliberately deferred:** the S3/MinIO storage driver (local disk remains the only driver), zip-based workspace export, orphan-file cleanup and audio quotas; multi-user sharing and roles (L-13); domain packs (L-14); i18n (U-7); the queue split with a dead-letter admin view (P-3); HNSW/halfvec indexing, cursor pagination everywhere and the 100k-chunk load test (R-17); multi-arch images, a GPU/whisper compose profile and Helm/upgrade documentation (P-9); and OTel traces / Sentry-compatible reporting. These are tracked in the repository's phase plan, not silently dropped.
- 🔌 **MCP is stdio-only with five tools** and no subscriptions, resources or prompts; a remote HTTP transport is not implemented. The CLI and share target are thin REST clients, so their behaviour is exactly the API's behaviour.
- 🖼️ **Offline mode covers review, not the whole app.** Chat, search, uploads and settings need a connection; the shell and cached speech make the installed app feel native but do not make it a full offline client.
- 🧾 **Webhooks are best-effort at the edges:** the fan-out is queued and never fails indexing, deliveries retry five times, and a permanently failing endpoint is visible in Settings but is not automatically disabled.

## [0.4.6] - 2026-10-25

Phase 4a turns Nexus into a workspace that can hold almost anything a learner already owns. Books, slides, spreadsheets, open-document and RTF files, HTML and ZIP folders, subtitles, audio and video, web articles, YouTube transcripts, images and scanned pages all become indexed documents with structure metadata, provenance labels and citations, and images can be discussed directly, with art-critique, diagram and equation modes and citations back to the picture. This is the release where "ask my documents" stops meaning "ask my PDFs".

### ✨ Added

- 📚 **Ingestion breadth (L-1).** EPUB (spine order plus chapter and section headings kept as the document's table of contents), PPTX (slides and notes), XLSX (sheets), ODT, RTF, HTML files and ZIP folders (parsed per entry under the container limits), SRT/VTT subtitles (timestamps preserved), and audio/video (MP3, WAV, OGG, FLAC, M4A, AAC, WebM, MP4, MOV) transcribed through the existing STT pipeline. Every format is registered in one parser registry, and the format that decides which parser runs comes from the file's magic bytes rather than its extension, so a renamed file can never be handed to the wrong parser.
- 🌐 **Web articles and YouTube (L-1).** `POST /api/ingest/url` fetches a URL behind the SSRF guard, extracts the main content with an in-repo Readability implementation (block scoring, `article`/`main` preference, chrome stripping, Markdown conversion, no jsdom dependency), stores the canonical URL for citations, and resolves YouTube watch/shorts/youtu.be links to their caption track without an API key. URL imports are rate-limited at 10 per minute.
- 🖼️ **Images, scanned PDFs and OCR (L-1).** A PDF without a usable text layer is detected, rasterized with poppler's `pdftoppm` and OCR'd page by page with the system `tesseract` binary, bounded by `OCR_MAX_PAGES`, `OCR_TIMEOUT_MS` and an output cap; images are OCR'd and, when vision is enabled, described by the vision model. The OCR text and the description are what retrieval searches, so a photographed page or a diagram is as citable as a text file. OCR is optional: without `tesseract` images still go through vision, and a scanned PDF fails with an actionable message instead of becoming an empty document.
- 👁️ **Vision chat (L-1).** Up to four library images can be attached to a question from the composer. Ownership, image format, size and readiness are checked server-side, the bytes are encoded in memory and never persisted in the conversation, and the answer cites the image chunk like any other source. A reloaded conversation still shows the attached images because the message stores document ids only.
- 🎨 **Image analysis modes.** Any image document can be analysed from its library card in Describe, Art critique (composition, colour, technique, art-historical context), Diagram (components and flows) or Equations (LaTeX transcription) mode, with an optional question. Results are cached in process memory keyed by image hash, mode, question and model, so reopening a panel does not pay for a second request.
- 🧬 **Duplicate detection and structure metadata.** Uploads are hashed (sha256) and a same-bytes upload into the same workspace returns the existing document with `duplicate: true` instead of indexing it twice (a previously failed document does not block a retry). Documents now record their detected format, `source_url`, a structure object (TOC, word count, reading time, OCR/vision/transcript flags) and the chunk provenance needed for citations.
- 🗂️ **Library cards that explain the file.** Document cards show a format chip, word count, reading time, chunk count, the source URL for web imports, provenance chips (OCR, VISION, transcript) and an analyse action for images; the dropzone and its copy advertise the new accepted formats and the separate image limit.
- ⚙️ **Vision settings.** Settings → Vision enables image requests and configures an optional model, base URL and key that fall back to the main chat provider, plus a per-image size cap (`VISION_MAX_IMAGE_MB`, 10 MB by default).

### 🔧 Changed

- 🧩 **The document format is a first-class value.** `fileFormatSchema` in `@nexus/shared-types` enumerates every supported format, the parser registry keys off it, and the stored type can legitimately differ from the uploaded name (a PNG named `notes.docx` is stored and served as `png`).
- 📈 **Text extraction keeps structure instead of one flat blob.** Parsers return pages, sections, slides or cues, chunking keeps the heading trail (prepended only for the embedding text, never the stored content), and documents carry their table of contents into the UI.
- 🔌 **Vision is a provider capability, not a hard dependency.** With vision disabled or unconfigured, images are still indexed through their OCR text and the rest of the app behaves exactly as before.
- 🧹 **`langchain` was retired.** Only `RecursiveCharacterTextSplitter` was used, so the dependency moved to `@langchain/textsplitters` with `@langchain/core` 1.3, which also removed the last zod 3 copy from the tree.

### 🔒 Security

- 🛡️ **Uploads are admitted by content, not by name (S-2).** Magic bytes decide the format, unrecognised payloads are rejected with HTTP 400, zip-style containers are opened under entry-count, per-entry size, total uncompressed size, compression-ratio and nesting-depth limits so a zip bomb or a decompression loop fails fast, every parser runs under a wall-clock timeout, extracted text is capped (`MAX_TEXT_CHARS`), and stored filenames remain server-generated UUIDs.
- 🌐 **URL ingestion is SSRF-safe (S-2).** The hostname is resolved and every resolved address is classified: loopback, RFC1918, CGNAT, link-local, benchmarking, documentation, multicast, ULA, IPv4-mapped, NAT64 and 6to4 ranges are refused, including `169.254.169.254`. The connection is pinned to the validated address through a custom `lookup`, so a DNS-rebinding answer between the check and the connect cannot redirect it, redirects are followed manually and re-validated at every hop, the body is size-capped, the request has a wall-clock budget, credentials in URLs are rejected, and no cookies or auth headers are forwarded. `INGEST_ALLOW_PRIVATE_HOSTS=true` is documented as a test/self-host override only.
- 🖼️ **Image bytes are served, not published.** `GET /api/images/:id` requires a session, resolves ownership through the workspace, serves only documents whose detected format is an image, and responds with `X-Content-Type-Options: nosniff`, a restrictive CSP and an inline disposition.
- 🧾 **Provenance is stored (S-4).** Web pages, transcripts and image descriptions keep their `source_url` and OCR/vision/transcript flags and are labelled in the citation UI, so retrieved content is attributable instead of silently trusted.
- 📦 **Advisories closed in this release.** `zod` below 4.6.6 could exhaust memory validating a large array with no length constraint (GHSA-mrhx-c7xc-m3w5 / CVE-2023-54404): removing `langchain` 0.3 eliminated the zod 3 copy, `openai` moved to 6.x whose peer range accepts zod 4, and the tree now resolves a single `zod` 4.6.7. `body-parser` below 2.4.0 could be stalled by trailing bytes after a compressed request body (GHSA-27r3-jxmh-p828): `express` 5.3 plus a `>=2.4.0` override. `multer` below 2.5.0 could crash the process when an async `fileFilter` resumed after request teardown (GHSA-q7qp-rjg7-q26m): multer 2.5.0. `@vitest/mocker` below 4.1.12 allowed code injection through unauthenticated manual mock registration and a Windows backslash traversal past the redirect allowlist (GHSA-qxg6-89mg-rqv8, GHSA-xp26-3454-mjgp): vitest 4.1.12. `ip-address` up to 10.7.3 matched a zone identifier in quadratic time (GHSA-rxp7-6hxx-x8q5): forced to 10.7.4 or newer. `pnpm audit` reports zero vulnerabilities and `pnpm peers check` is clean.

### 🐛 Fixed

- 🗑️ **A document deleted while it was being indexed was reported as an indexing failure.** Deleting a workspace cascades to its documents and chunks, but a BullMQ job already running then failed on the `chunks` foreign key (or on the now-missing upload file) and the worker logged it as an error and retried a row that no longer existed. The failure handler now checks whether the document still exists and reports a dropped job instead, so a teardown race can no longer mark anything failed or exhaust attempts on a deleted document.

### 📝 Notes

- 🧪 **Verification:** 247 backend unit tests across 29 files (90 more than the previous release) plus 6 shared-types tests, 116/116 smoke checks against real Postgres and Redis with the deterministic mock provider, three Playwright suites (happy path, ingestion plus vision plus URL import, voice and language), and 43 visual-QA captures across desktop and mobile; `typecheck`, `lint`, `format:check`, `build` and `pnpm audit` are clean, and `pnpm peers check` reports no issues.
- 🗄️ **Migration 0013** adds `documents.content_hash`, `documents.source_url`, `documents.metadata` and `messages.attachments`; no existing column changes type and no backfill is required, so older documents simply have no structure metadata and do not participate in duplicate detection until they are re-uploaded.
- ⏳ **Deliberately deferred to 4b:** bulk and folder upload with per-file progress, retry and cancel; tags and folders; versioned re-upload with changed-section flags; LaTeX/Jupyter, Obsidian/Notion/Anki folder import and RSS/podcast feeds; domain packs (L-14); multi-user sharing (L-13); API keys, REST/MCP and the browser extension (P-5); observability, S3/backups, PWA and i18n.
- 🖼️ **Images are indexed by OCR text and a vision caption, not multimodal embeddings.** Visual-similarity search and diagram-interior understanding across formats remain open; the existing hybrid text search over the caption is what cites them today.
- 📺 **YouTube ingestion needs a caption track**, there is no audio-download and transcription fallback, and Readability is a heuristic extractor rather than a browser engine, so unusual pages may keep navigation text or drop marginal content.
- 🔤 **OCR is a system dependency.** The published backend image bundles `tesseract-ocr` and `poppler-utils`, a source checkout must install them, and scanned PDFs are OCR'd for the first 30 pages by default. Vision likewise needs a model that accepts images, is configured globally in Settings rather than per workspace, and its analysis results are cached in process memory only.

## [0.4.5] - 2026-10-21

Phase 3 gives Nexus a voice and turns it into a language-learning system. You can dictate questions, hear answers read aloud with sentence-by-sentence highlighting, hold a push-to-talk conversation with the tutor, and practise a language: mine vocabulary into spaced-repetition cards, score dictation and pronunciation, and track a CEFR estimate for every skill. This is the release where the workspace becomes something you can speak with and learn from, not just read.

### ✨ Added

- 🎙️ **Dictation in the composer (V-1).** The microphone supports click-to-toggle and press-and-hold, a live waveform, language selection and silence auto-stop. It uses the browser Web Speech API when available and otherwise records with `MediaRecorder` and posts the clip to `POST /api/transcribe`, which tries the configured OpenAI-compatible transcription model and falls back to a local faster-whisper sidecar (`WHISPER_LOCAL_URL`) when the provider fails. Recordings are capped, type-checked, written to server-generated paths, and not retained unless explicitly requested.
- 🔊 **Read-aloud with a cached server voice (V-2).** `POST /api/tts` synthesizes speech server-side and caches it under a content address of owner, model, voice, speed, format and text, so identical requests never re-synthesize and one user can never receive another user's audio. `GET /api/audio/:id` serves the clip with HTTP Range support, owner scoping, `X-Content-Type-Options: nosniff` and an inline disposition, so playback starts fast and is seekable and downloadable. Any answer, selection or vocabulary term gets Play/Pause/Stop, speed and voice controls, the active sentence is highlighted by distributing the sentence list over the clip's real duration, and the operating system's `SpeechSynthesis` voices are the automatic fallback when no server provider is configured.
- 🗣️ **Push-to-talk voice chat (V-3).** A Voice workspace mode runs the turn-based loop transcribe → grounded chat → spoken reply using the language-partner persona and the configured correction policy. Transcripts are ordinary persisted messages, so a spoken session appears in the conversation list and can be continued as text with one click; a latency HUD reports time-to-first-token and time-to-audio.
- 🎯 **Pronunciation practice (V-4).** Record a word or sentence and get a per-word score with the aligned text the recognizer heard, colour-coded feedback, minimal-pair drills, attempt history and speaking progress events. Scoring is deliberately local and transparent (character-level alignment), presented as feedback rather than a grade.
- ✍️ **Dictation practice (L-8).** Play a sentence, type what you heard, and get a word-level diff with accuracy, correct/total counts and per-word markers; every attempt records a listening progress event.
- 📚 **Vocabulary mining with spaced repetition (L-10, L-6).** Mine terms from any passage or chat selection. The model returns terms with translation, part of speech and an example sentence, with a heuristic fallback when the provider is unavailable, and each new term is stored with a `known/learning/ignored` state and a spaced-repetition card in the workspace's default deck. Terms can be replayed with the cached speech engine.
- 🏅 **CEFR estimates per skill (L-10).** Reading, writing, listening and speaking are estimated from card reviews, dictation, pronunciation and quiz evidence, stored per skill in `cefr_estimates`, and shown as level badges on the Study dashboard and in Language → Progress, with a configured starting level until enough evidence exists.
- 🧰 **Provider capability matrix extended to speech (P-2).** The provider client resolves dedicated `stt` and `tts` connections that fall back field-by-field to the main OpenAI-compatible provider, and the settings registry gained Voice and Language groups so both render automatically in Settings. Transcription and speech models, voices, base URLs and keys are configurable without a restart.
- 💾 **Audio retention and quota (S-5).** Cached speech expires after `voice.retentionDays` (purged by the daily maintenance job) and the per-user audio cache is capped by `voice.maxStorageMb`, evicting the oldest assets first so audio cannot grow without bound.
- 🎛️ **Voice and Language settings cards.** Engine/mode, model, language, voice, speed, auto-send, correction policy, retention and quota are first-class settings rendered by the generic settings panel, alongside the language-learning defaults.

### 🔧 Changed

- 🧭 **The workspace modes grew to Chat, Study, Voice and Language.** Voice is the push-to-talk tutor loop, and Language bundles vocabulary, dictation, pronunciation and the per-skill progress view; both reuse the existing workspace and conversation state rather than forking it.
- 🔤 **The selection toolbar gained Speak and Mine.** Selecting text in a chat answer now offers Speak (read the passage with the cached voice) and Mine (extract vocabulary and create cards) next to Ask, Highlight and Cards.
- 🧹 **The daily maintenance job now also purges expired audio.** It previously only removed expired sessions; it now deletes cached speech past `voice.retentionDays` and enforces the per-user quota, so retention keeps working without a request touching the asset.
- 🔉 **Read-aloud prefers the server voice and falls back to the browser.** The browser `SpeechSynthesis` path is used automatically when no TTS provider is configured or synthesis fails, so the feature still works without a key.

### 🐛 Fixed

- 🎤 **The microphone could stay active when recording was stopped before the permission prompt resolved.** The recorder awaited `getUserMedia` and only afterwards created the `MediaRecorder`, so a stop or unmount during the await was a no-op and the audio track leaked. A cancellation flag is now checked after the await and the stream is disposed immediately.
- 📝 **Browser dictation could silently discard the final transcript.** The accumulated text was published before recognition flushed its last result, and a recognition session that ended on its own never published at all. Publishing now happens once from the recognition `end` event, with a timeout fallback.
- ⏩ **Changing read-aloud speed re-synthesized at the previous speed.** The restart was scheduled through a closure that still held the old state value; the speech request and browser utterance now read the speed from a ref updated synchronously with the control.
- 🎭 **The stored content type of an uploaded recording was client-controlled.** The audio filter accepted a file when either the extension or the declared MIME looked valid, and the declared MIME was stored and echoed back on playback. The type is now derived from the allowlisted extension, and the streaming endpoint sends `nosniff` and an inline disposition.
- 🗂️ **`voice.audio.list` ignored its `workspaceId` parameter**, listing every asset for the user; it now scopes to the workspace as well.
- ⚖️ **Audio quota eviction was nondeterministic on equal timestamps**, so the evicted asset could vary between runs; ties now break on id.
- 🔇 **The browser voice-list helper leaked its global `onvoiceschanged` handler**, accumulating listeners page-long; it is now cleared on resolve.
- 🧪 **The voice e2e setup call targeted Vite's address family instead of the API.** On runners where the dev server binds a single address family the setup request was refused while the browser still worked; the test now posts to the API port directly. Test-only change, no product behavior.

### 🔒 Security

- 🛡️ **Audio uploads are hardened (S-2).** Transcription clips are capped by `MAX_AUDIO_MB`, filtered by an extension **and** MIME allowlist, buffered in memory and written only to a server-generated path, and nothing is persisted unless the user opts in to keeping recordings.
- 🔐 **Cached speech is owner-scoped and served defensively.** Audio assets are looked up by owner, streamed with `X-Content-Type-Options: nosniff`, an inline disposition and Range support, and the stored MIME is derived from the extension rather than trusted from the upload.
- 📦 **Vite 8.2.1 → 8.3.5 (GHSA-587h-7wmj-h5pm, GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw).** A high-severity `launch-editor` file-existence issue and two moderate argument-handling issues, all build/dev-time through the Vite toolchain; `pnpm audit` is back to 0 vulnerabilities on both the full and production graphs.
- 🧹 **Retention defaults stay conservative.** Cached speech is kept for 7 days by default and capped at 200 MB per user; recordings are not stored unless explicitly requested.

### 📝 Notes

- 🧪 **Verification:** 157 backend unit tests across 18 files (plus 6 shared), 94/94 smoke checks against real Postgres and Redis with the deterministic mock provider, two Playwright suites (happy path plus a full voice/language flow that records through a fake media device), and 35 visual-QA captures; `typecheck`, `lint`, `format:check`, `build` and `pnpm audit` are clean.
- ⏳ **Deliberately deferred:** audio overviews (V-5, two-host podcast generation and listen-to-my-cards playlists), graded readers, grammar explanation and drills, exam presets, roleplay scenarios, fluency metrics (rate/pauses/fillers), parallel text, and PWA offline/sleep-timer playback.
- 🎙️ **Voice chat is turn-based push-to-talk.** Full-duplex barge-in and streaming partial transcripts over WebSocket are not implemented; pronunciation scoring is local alignment, not a cloud phoneme assessment API, and is presented as feedback rather than a grade.
- 🔊 **Server speech has no word timestamps**, so sentence highlighting is proportional to sentence length over the real clip duration; the local STT fallback expects an externally run faster-whisper server (no bundled sidecar or container).
- 🗄️ **Migrations 0011 and 0012** add `audio_assets`, `vocabulary_items`, `cefr_estimates` and `pronunciation_attempts`, plus the unique vocabulary/CEFR indexes; the e2e voice suite forces `voice.sttMode=server` for determinism (the per-run database is disposable).

## [0.4.4] - 2026-10-01

Phase 2 adds the complete study loop to each workspace: highlights and notes, flashcards generated from your own documents and scheduled with FSRS, review sessions with interval previews, quiz generation with grading and a mistake notebook, tutor personas, Mermaid-capable studio artifacts, and a dashboard that reports what is due and how retention is trending. This is the release where Nexus stops being only a place to ask questions and becomes a place to remember, practise and be examined.

### ✨ Added

- 🧠 **Study mode per workspace.** A Chat / Study switch sits above each workspace; Study contains Dashboard, Review, Decks, Quizzes, Artifacts and Notes. The chat view stays mounted while Study is open, so the conversation and any in-flight answer survive tab switches.
- 🃏 **AI-generated flashcards.** A document (via the cards button on a ready document, or the Decks tab) or any selected passage is sent to the chat model with a strict JSON contract; the response is parsed tolerantly (code fences stripped, malformed entries dropped) and creates QA cards in the workspace's default deck. Generation reports how many cards were created and surfaces a friendly error when the material yields none.
- ⏱️ **FSRS spaced repetition.** Cards are scheduled with ts-fsrs: the full scheduler state (due date, stability, difficulty, elapsed/scheduled days, learning steps, reps, lapses, state) is stored per card, so scheduling is deterministic across restarts and instances. New cards are due immediately; every rating produces a real next interval.
- 🎯 **Review sessions.** The queue shows the card front, reveals the answer on Space, and offers Again / Hard / Good / Easy buttons with the interval each rating would schedule plus number-key shortcuts (1–4). The session ends with a reviewed count and returns to the dashboard.
- 🗂️ **Deck management and Anki export.** Create, review and delete decks; each deck reports total, due and new counts. Cards export as a quoted `front,back` CSV that Anki imports directly.
- 🖍️ **Highlights and notes.** Selecting text in a chat answer opens a toolbar with **Ask** (prefills the composer with the passage), **Highlight** (stores the passage with an optional note) and **Cards** (generates flashcards from the passage). The Notes tab lists highlights and Markdown notes with tags, both editable in place.
- 📊 **Progress dashboard.** Due now, new cards, reviews today, streak (consecutive UTC review days), 30-day retention and cards added in the last seven days, aggregated from the review and progress-event tables.
- 🎓 **Tutor personas.** Eight built-in modes — default, Socratic tutor, patient explainer, exam coach, writing coach, debate partner, language partner and code mentor — layer a mode-specific instruction on top of the configured system prompt, so grounding and citation rules always apply. The default is stored in settings and the composer overrides it per chat.
- ❓ **Quizzes with grading.** Quizzes are generated from a document (or a selected passage) as multiple choice, true/false and short-answer questions. Objective answers are graded exactly; short answers are graded by meaning with one model call and fall back to keyword overlap when the provider is unavailable. Every attempt is scored and stored.
- 📓 **The mistake notebook.** Wrong answers can be turned into flashcards in the default deck in the same submission, so a failed quiz immediately feeds the spaced-repetition queue. The result screen explains each question and shows the cards created.
- 🎨 **Studio artifacts.** A per-workspace studio generates summaries, study guides, glossaries (Markdown tables) and Mermaid mind maps from any indexed document, renders them with the same Markdown/KaTeX renderer used by chat, and supports copy and delete.
- 🖱️ **Per-document card generation.** Every ready document row has a cards button that generates a starter deck in one click.

### 🔧 Changed

- 🧭 **The study shell is a first-class workspace mode.** Switching to Study no longer unmounts the chat panel (the open conversation is preserved), and the Notes panel, deck list and review runner all live inside one consistent shell.
- 🎛️ **Settings render boolean fields and new retrieval/study groups.** The generic settings panel gained checkbox rendering for toggles and the new job-model and retrieval controls, without bespoke UI per field.

### 🐛 Fixed

- 🧮 **FSRS cards never graduated from the learning state.** The scheduler's `learning_steps` counter was not persisted with the rest of the card state, so every review restarted the learning steps and cards never reached the review state. The column is now stored (migration 0009) with a regression test that asserts graduation after two successful steps.
- 🖱️ **The selection toolbar missed keyboard and programmatic selections** because it only listened to `mouseup`; it now reacts to `selectionchange` scoped to the message log.
- 🎯 **Hybrid search silently excluded semantic-only candidates (B-2).** The old query required a full-text match before ranking; retrieval now fetches a vector arm and a keyword arm independently and fuses them with Reciprocal Rank Fusion, so a paraphrased question still finds the right passage. Covered by the smoke check "hybrid retrieval keeps semantic-only matches (B-2)" and `fuseRrf` unit tests.
- 🧬 **Switching embedding models could break chat with a pgvector dimension error (B-3).** Vector comparisons are scoped to the active model, legacy rows are matched by `vector_dims()`, and a workspace banner with a bulk re-index action replaces the old "delete and re-upload" advice.
- 🔎 **Non-English keyword search bypassed its index (B-10).** The English-only expression index is replaced by a GIN index on a populated `content_fts` tsvector written at ingestion with the configured language, and migration 0007 backfills existing chunks.
- 📏 **Source relevance was vector-only and never thresholded (B-15).** Sources expose vector, keyword and fused scores; `rag.minScore` drops weak vector matches while keeping keyword hits; citation numbers are validated and cited sources are marked ✓.
- 🖼️ **Source rows overlapped on narrow screens** because the relevance percentage floated over wrapped titles; the summary is now a flex row with a truncated title.
- 🔐 **Dependency advisories: five cleared, including two criticals.** `proxy-addr` 2.0.7 → 2.0.8 (GHSA-jqcg-44mw-7w3h, critical, IP spoofing reachable through express/express-rate-limit in production), `shell-quote` 1.9.0 → 1.12.0 (GHSA-pqg4-j6r4-53mv, critical, concurrently dev tooling), `source-map-js` 1.2.1 → 1.2.2 (GHSA-68fv-2mgg-jv7q, high, vite/tailwind), `katex` 0.16.47 → 0.18.9 (GHSA-238p-pmpm-9mq7, low, via rehype-katex), and `sprintf-js` removed by overriding mammoth's CLI-only `argparse` to 2.x (GHSA-hp3w-g68c-fv3c, moderate).

### 📝 Notes

- 🧪 **Verification:** 103 backend unit tests across 13 files (plus 6 shared), 78/78 smoke checks, an extended Playwright happy path covering cards, review, highlight, persona, a 100% quiz and an artifact, and 24 visual-QA captures; `typecheck`, `lint`, `format:check`, `build` and `pnpm audit` are clean.
- 🗄️ **Migrations 0008–0010** add decks, flashcards, card reviews, highlights, notes, progress events, quizzes, quiz attempts and artifacts (plus the FSRS learning-step column).
- ⏳ **Deliberately deferred:** `.apkg` export (CSV imports directly into Anki), cloze and image-occlusion cards, a manual card editor, notes indexed into retrieval, per-workspace persona defaults and learner-context injection, workspace-wide quizzes, and FSRS parameter optimization. Study plans and reminders are not implemented yet.

## [0.4.3] - 2026-10-01

Phase 1 makes retrieval trustworthy and the workspace usable on a phone. The headline fix is that semantic-only matches are no longer silently dropped by a keyword filter; around it, answers now use a token budget, cite verifiable sources, and can be inspected, while changing the embedding model surfaces a re-index banner instead of a pgvector error.

### ✨ Added

- 🔀 **Hybrid retrieval with Reciprocal Rank Fusion.** Retrieval fetches two independent candidate arms — the 50 nearest vectors and the 50 best keyword matches (`websearch_to_tsquery` on a populated `chunks.content_fts` column) — and fuses them by rank rather than filtering one arm by the other. A chunk that matches only semantically is therefore retrieved even when other chunks contain the query words, which was the single largest quality defect in the product (B-2). Chunks carry heading context when embedded, and the fused result is diversified (at most three chunks per document, content-hash dedupe) before selection.
- 🎚️ **Retrieval profiles: Fast, Balanced, Thorough.** Fast is union fusion only; Balanced also rewrites follow-up questions and enforces the context budget; Thorough additionally reranks candidates with the text model. The profile is a setting, so cost and latency are predictable.
- ✍️ **Follow-up question rewriting.** When a conversation has history, the cheapest configured model rewrites the latest message into a standalone search query before retrieval (cached for 10 minutes); the query actually used is shown during streaming and in the inspector. `job.queryRewrite.model` can point this at a cheap model.
- 🏆 **LLM listwise reranking.** Thorough (or an explicit toggle) asks the text model to reorder the top 20 candidates by relevance, tolerant of any parse failure. Reranked positions are visible in the inspector. `job.rerank.model` overrides the model used.
- 🔬 **Retrieval inspector.** Every assistant answer stores a debug payload (profile, original vs rewritten query, candidate counts, vector/keyword/fused score per candidate, selection and rerank positions, token budget). "Why these sources?" opens a modal showing exactly how the answer's context was chosen — the tool that makes every later retrieval change measurable.
- 👍 **Answer feedback.** Thumbs up/down are stored per assistant message (`messages.feedback`, `chat.feedback`) and survive reloads, giving evaluation work a real signal.
- 🧬 **Embedding provenance and bulk re-index.** Chunks store `embedding_model`, `embedding_dims`, `embedding_version` and `content_hash`; a workspace banner reports how many documents were indexed with a different setup and re-indexes them in one click (`document.retrievalStatus`, `document.reindexAll`), with a REINDEX badge per document.
- 📚 **Heading-aware chunk metadata.** Markdown headings split documents into sections; every chunk stores `heading_path`, page range, token estimate and content hash. Heading context is prepended before embedding (so sections are searchable by name) but not stored in the chunk text.
- ⚙️ **New settings:** `rag.profile`, `rag.queryRewrite`, `rag.rerank`, `rag.minScore`, `rag.maxContextTokens`, `job.queryRewrite.model`, `job.rerank.model`, plus checkbox rendering for boolean settings.

### 🔧 Changed

- 📱 **The workspace is usable on a phone.** The sidebar is an off-canvas drawer below `md`, the document panel stacks under the chat below `xl`, the conversation history becomes a header picker below `lg`, and the header/composer wrap without overlap.
- 📏 **Source relevance is transparent.** The source list shows vector, keyword and fused scores, page ranges, heading trails and a ✓ on cited sources; the inline `<details>` expands the full chunk instead of clamping it.
- 🆔 **The stream done event returns the persisted message id**, so client-side ids are replaced immediately and per-message actions (feedback) target the stored row.
- 🧾 **Prompt-injection guardrail.** Retrieved chunks are wrapped in `<source>` delimiters and the system prompt states that source text is reference material whose instructions must be ignored.
- 🧮 **Context budgeting.** `rag.maxContextTokens` budgets the retrieved sources (always keeping the best hit), and the inspector reports used vs allowed tokens.

### 🐛 Fixed

- 🔀 **B-2: hybrid search dropped semantic-only candidates.** The keyword arm is now an addition, never a filter; covered by the smoke check and `fuseRrf` unit tests.
- 🧬 **B-3: switching embedding models could break chat with a dimension error.** Vector comparisons are scoped to the active model and legacy rows are matched by `vector_dims()`; the banner and bulk re-index replace manual deletion and re-upload.
- 🔎 **B-10: non-English keyword search bypassed its index.** The English-only expression index is replaced by a GIN index on a populated `content_fts` tsvector, with migration 0007 backfilling existing chunks.
- 📏 **B-15: relevance was vector-only and unthresholded.** Three scores, `rag.minScore` and validated citations replace the single number.
- 💉 **Prompt injection through documents had no guardrail**; source delimiters and the system rule close it.
- 🧮 **The context window could overflow silently**; the token budget and the inspector prevent it.
- 🖼️ **Source rows overlapped on narrow screens** because the percentage floated over wrapped titles; the summary is now a flex row.
- 🔐 **Dev-dependency advisories cleared:** vitest 4.1.10 → 4.1.11 (GHSA-82fw-gwwq-j7x9) and `brace-expansion` forced to ≥ 5.0.12 (GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p, GHSA-q2hr-2g5m-vwhr), so the full `pnpm audit` is clean.

### 📝 Notes

- 🧪 **Verification:** 75 backend unit tests (plus 6 shared), 59/59 smoke checks, the extended Playwright happy path, and 14 visual-QA captures; `typecheck`, `lint`, `format:check`, `build` and `pnpm audit` are clean.
- 🗄️ **Migration 0007** adds embedding provenance and heading metadata to chunks, the content FTS column, message feedback and retrieval debug storage.
- ⏳ **Deliberately deferred:** a golden-set evaluation harness (Recall@k/MRR/nDCG/LLM judge), neighbor expansion and parent-child retrieval, cross-encoder or provider reranking, and language changes after ingestion still requiring a re-index for keyword matching. Pre-Phase-1 documents show the re-index banner because the embedding input now includes heading context.

## [0.4.2] - 2026-10-01

Phase 0 is the hygiene and blockers release: every item here was a correctness bug, a security or dependency issue, or infrastructure the later phases depend on. Retrieval quality, embedding-model changes and the mobile layout were deliberately left to the next release and are listed under the notes.

### ✨ Added

- 🩺 **Indexing diagnostics.** Documents store a sanitized failure reason, the number of attempts and an update timestamp (`documents.error_message`, `documents.attempts`, `documents.updated_at`, migration 0006). Failed rows show the reason and attempt count and offer **Retry** and **Delete** independently.
- 📦 **Streaming workspace import.** `POST /api/workspace/import` accepts an exported archive as a multipart file with `MAX_IMPORT_MB` (default 100 MB), validates decoded payload size and row counts, validates document file types, and restores per-message token usage. The old tRPC import path remains for API clients.
- 🧾 **Batch settings endpoint.** `settings.updateMany` validates and persists several settings in one call, so cross-field invariants are checked against the final state rather than save order.
- 🧩 **Public config endpoint.** `config.public` exposes the app name and the effective upload limit before login.
- 💬 **Chat message actions.** Stop generation, Copy, Retry on errors and Regenerate (re-answers the last user message and replaces the trailing assistant/error row).
- 🎨 **Rich answer rendering.** GFM tables, KaTeX math, syntax-highlighted code with per-block copy, safe external links, and a lazy-loaded renderer that keeps the workspace chunk small.
- 🔔 **Toasts and session expiry.** Toasts replace `alert()` and silent failures; deleting the active workspace clears the selection; any UNAUTHORIZED tRPC error routes back to login.

### 🔧 Changed

- 🚿 **Streaming performance and control.** Tokens are batched into state every 50 ms, the message list auto-scrolls only while the user is near the bottom, and conversation switching is disabled while an answer streams.
- ♿ **Accessibility.** The streaming phase is announced through a polite live region, icon buttons have labels, the message list is a labelled log, and source text expands fully.
- 🧪 **Developer experience.** The smoke suite grew from 49 to 55 checks, e2e ports are overridable, `e2e-server.sh` starts Vite from the frontend package, and generated Drizzle meta files are formatted.

### 🐛 Fixed

- 💬 **Conversation titles regenerated on every message.** The title job sat outside the "new conversation" branch, so each follow-up burned an extra completion and renamed the conversation. Titles are now generated only on creation.
- 📄 **PDF page numbers were always 1.** `pdf-parse` joins pages with blank lines, not form feeds, so every chunk reported page 1; extraction now uses a custom page renderer, numbers pages before filtering empty ones, and passes a `Uint8Array` because pdf.js v1 misparses some Node buffers. Regression tests build real multi-page PDFs with a blank page.
- 🧾 **Provider errors were stored as assistant answers.** A failed generation persisted the friendly error as a normal assistant message, replaying it to the model on the next turn. Messages carry `kind` (`answer`/`error`), errors render distinctly, are excluded from prompts, and history is built server-side.
- 🔑 **Removing `SETTINGS_SECRET` took down settings and chat.** Decryption is now guarded; reads fall back to env/default, and the UI flags unreadable keys for re-entry.
- 📏 **Chunk size/overlap validation was one-directional and save-order dependent.** The batch endpoint validates `overlap < size` against the post-save pair.
- 🔐 **Changing `AUTH_PASSWORD` left old sessions valid.** The boot path verifies the password against the stored hash and, when it changed, re-hashes and deletes the user's sessions.
- 📦 **Workspace import failed above ~1 MB** because the archive was a tRPC JSON body under the global 1 MB cap; the streaming endpoint removes that limit.
- 📤 **Upload limits disagreed across four places.** The dropzone uses the public config, multer is a 100 MB backstop, and nginx was raised to 110 MB as a backstop.
- 🧵 **Deleting a document could still burn provider tokens**; jobs use the document id as their BullMQ job id and deletion removes the queued job.
- 🧯 **The worker marked documents failed mid-retry.** BullMQ emits `failed` on every attempt; the worker now records the error/attempts and only sets `failed` once retries are exhausted.
- 🧾 **Workspace export lost token usage** and imports skipped it; both paths preserve usage.
- 🗄️ **The query-embedding cache ignored the embedding provider**; the key now includes the provider base URL.
- 🔒 **The chat stream trusted an arbitrary conversation id** after checking only workspace ownership; reused conversations are now verified against the caller's workspace.
- 🐞 **Dependency advisories cleared:** `multer` 2.3.0 → 2.4.0 (GHSA-3pph-fpjx-jg34), `express-rate-limit` 8.6.2 → 8.7.0 which pulls fixed `ip-address` (GHSA-rpw4-54j3-4h4q, GHSA-2vr4-cq9g-pvrc, GHSA-j6r3-76f7-8jcv, GHSA-h3mg-xc3c-68pw), and `qs` ≥ 6.16.0 (GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g).
- 🖼️ **Streaming showed a duplicate empty assistant bubble**; the empty placeholder is skipped while the live bubble streams.
- 📊 **The sidebar document count was stale after upload/delete**; document mutations now invalidate `workspace.list`, and the upload notice clears itself.

### 📝 Notes

- 🧪 **Verification:** 60 backend unit tests (plus 6 shared), 55/55 smoke checks, the Playwright happy path, and 10 visual-QA captures; `typecheck`, `lint`, `format:check`, `build` and `pnpm audit` are clean.
- 🗄️ **Migration 0006** adds document failure metadata and message kinds.
- ⏳ **Deliberately deferred:** hybrid retrieval fusion (B-2), embedding re-index guards (B-3), language-agnostic FTS (B-10), a mobile layout (B-22), and undo for deletes (needs soft-delete plus a purge window). `pdf-parse` still has no OCR path for scanned PDFs.

## [0.4.1] - 2026-09-09

Provider flexibility: Nexus can now talk to OpenCode Zen and Zen Go, point chat and embeddings at different OpenAI-compatible endpoints, and verify a provider end to end from the Settings panel.

### ✨ Added

- 🔌 **OpenCode Zen and Zen Go support.** Presets for both endpoints, model discovery through `/models`, a connection test that sends a tiny completion (Zen's model list is public, so reachability alone is not proof), and the Go-required `User-Agent: nexus/1.0` plus stable `x-opencode-session` headers per conversation and document.
- 🧠 **Separate embedding provider.** Chat-only providers (Zen, Groq, ...) can pair with OpenAI, Ollama, Jina or Mistral for embeddings through dedicated base URL/key/model settings that fall back field-by-field to the main provider.
- ⚙️ **Settings UX.** Provider presets, "Fetch models from this endpoint" pickers for chat and embeddings, masked secrets, an `env` badge for environment-provided values, and a per-card connection test.
- 📚 **Documentation refresh** covering local providers, separate embeddings, model discovery, container tags and branch/tag protection.

### 🔧 Changed

- 🧪 **The connection test is provider-aware.** It validates the configured chat model with a real completion and the embedding model with a real embedding, reporting dimension mismatches and chat-only 404s with actionable messages.
- 🔗 **Base URL validation.** A URL that already contains an endpoint path (e.g. a full `/chat/completions` URL copied from a dashboard) is rejected with the corrected base URL to use.

### 🐛 Fixed

- 🚫 **The placeholder key in `.env.example` no longer counts as a configured key**, so a fresh checkout without a real key fails with a clear local-provider hint instead of a confusing auth error.
- 🧭 **Chat-only embedding failures now name the missing embedding provider** instead of surfacing a bare 404.

### 📝 Notes

- 🐳 Container images are published as `ghcr.io/pranesh-selvaraj/nexus-backend:0.4.1` and `nexus-frontend:0.4.1`; `latest` tracks the newest release.
- ⏳ Zen/Go models that are only served over non-OpenAI protocols (Anthropic/OpenAI-native routes) are not supported and the connection test reports that clearly.

## [0.4.0] - 2026-08-25

The first production-readiness milestone: document ingestion grew beyond plain text, answers got titles, retrieval got a cache, the frontend split into lazy panels, and CI gained a deterministic smoke suite and a browser end-to-end test.

### ✨ Added

- 📄 **DOCX ingestion** via mammoth: Word documents are parsed to raw text, chunked and embedded like any other source.
- 💬 **LLM-generated conversation titles.** A background completion names each new conversation, with the message-prefix fallback when the provider is unavailable.
- ⚡ **Redis query-embedding cache.** Repeated questions skip the embedding round-trip for 24 hours; the cache key includes the model and dimensions.
- 🧩 **Code-split frontend.** Settings and workspace panels load lazily, keeping the initial bundle small.
- 🧪 **Deterministic smoke suite in CI.** A mock OpenAI provider plus the real API and worker exercise upload → index → retrieval → settings → auth → archive flows.
- 🧹 **Daily session purge.** A BullMQ repeat job removes expired sessions so the table cannot grow forever.
- 🛡️ **Last-resort error boundary** so a render error shows a recoverable screen instead of a blank app.
- 🎭 **Playwright end-to-end test** for workspace → upload → index → streamed chat.
- ⚙️ **Settings TTL cache and cached OpenAI clients.** Hot paths read settings from memory for a few seconds and reuse provider connections instead of rebuilding clients per request.

### 🔧 Changed

- 🚀 **Release pipeline and docs.** Version bump, GHCR image publishing, changelog-driven releases and a documentation pass for the 1.0 milestone.
- 🧪 **Test and CI hardening.** Unit tests, smoke checks and the browser test are required gates on `main`.

### 🐛 Fixed

- 🧵 **Session and client churn** in the request hot path: cached clients remove repeated auth/connection setup, and the settings cache removes repeated Postgres reads.
- 🧱 **Recoverable render failures** no longer leave a blank page.

### 📝 Notes

- 🧪 Verification at the time: unit tests, the new smoke suite and the Playwright happy path were green; the release was the first tagged as production-ready.
- ⏳ Still missing at this point: PDF page metadata, indexing diagnostics, hybrid fusion, a mobile layout, and the study/voice features that arrive in later releases.

## [0.3.1] - 2026-08-18

A focused local-model release: Nexus no longer requires a key when it talks to an OpenAI-compatible server, discovers models, and accepts embedding models whose dimensions differ from OpenAI's.

### ✨ Added

- 🖥️ **Full local LLM support.** Ollama and LM Studio work without an API key; model discovery lists what the endpoint serves; embeddings can have any dimension, with the expected size configured in Settings.
- 📐 **Flexible embedding dimensions.** Migration 0005 makes `chunks.embedding` dimension-flexible and removes the fixed-dimension HNSW index (exact scans are fine at personal scale); the worker validates every new vector against the configured dimensions.

### 🔧 Changed

- 🔤 **Embeddings request plain floats** (`encoding_format: float`) so local servers that ignore base64 work correctly.
- 🧭 **Provider error messages** distinguish missing keys, unreachable endpoints and dimension mismatches.
- 📚 **Documentation** for local models, embedding dimension matching, and re-indexing after a model change.

### 🐛 Fixed

- 🧮 **Dimension mismatches** now fail at indexing with a clear message instead of corrupting retrieval later.
- 🚫 **Placeholder keys** in `.env.example` are not treated as configured credentials.

### 📝 Notes

- ⏳ Changing the embedding model still requires deleting and re-uploading affected documents; the re-index banner arrives in `0.4.3`.
- 🐳 Images: `ghcr.io/pranesh-selvaraj/nexus-backend:0.3.1` and `nexus-frontend:0.3.1`.

## [0.3.0] - 2026-08-18

The configuration and portability release: settings moved into the UI, providers became pluggable, answers gained token accounting, and workspaces became portable.

### ✨ Added

- ⚙️ **UI-managed settings** with env fallback and AES-256-GCM encrypted secrets; precedence is UI → environment → default, and secret fields are only ever returned masked.
- 🔌 **OpenAI-compatible base URLs** so Ollama, OpenRouter, Groq and any compatible endpoint can serve chat and embeddings.
- 📝 **UI-managed system prompt** prepended to every chat request.
- 🌍 **Configurable full-text search language** (28+ PostgreSQL text-search configurations) for keyword retrieval.
- 🧮 **Per-message token usage** (prompt, completion, total) stored with each assistant answer.
- 📦 **Workspace backup and restore**: export documents and chat history as JSON and import them back, re-indexing the documents.

### 🔧 Changed

- 🔐 **Secrets are never sent back in full** — the settings API returns a mask and keeps decrypted keys in process memory only.
- 🧾 **The settings panel renders generically** from the registry, so bounds, groups and descriptions stay in one place.
- 📚 **Release notes and GHCR documentation** were corrected (container tags are semver without the `v` prefix).

### 🐛 Fixed

- 🧩 **Settings precedence** matches documentation in every combination of UI value, environment variable and default.
- 🔒 **Secret settings require `SETTINGS_SECRET`**; saving keys without it fails with an actionable banner instead of storing plaintext.

### 📝 Notes

- 🐳 Images: `ghcr.io/pranesh-selvaraj/nexus-backend:0.3.0` and `nexus-frontend:0.3.0`.
- ⏳ Local model support (no key, flexible dimensions) lands in `0.3.1`.

## [0.2.0] - 2026-08-12

The first tagged release: a self-hosted RAG workspace with asynchronous ingestion, hybrid retrieval, streamed grounded chat, optional authentication, production images and CI.

### ✨ Added

- 🏗️ **Full-stack monorepo.** React + Vite + tRPC + TanStack Query on the frontend, Express + tRPC + Drizzle on the backend, a BullMQ embedding worker, PostgreSQL with pgvector, and Redis.
- 📁 **Workspaces and documents.** Upload PDF, TXT, Markdown, CSV and JSON files; documents are parsed, chunked, embedded and indexed asynchronously with retry.
- 🔍 **Hybrid retrieval and streamed RAG chat.** Vector similarity and PostgreSQL full-text search with weighted ranking, streamed answers over WebSocket, and inline source citations.
- 🔐 **Optional password authentication** with httpOnly session cookies and scrypt password hashing; without `AUTH_PASSWORD` the app runs in single-user no-auth mode.
- ❤️ **Dependency-aware health check** (`/healthz` probes Postgres and Redis with memoized results).
- 🐳 **Production deployment** through multi-stage Docker images and a Compose stack (frontend nginx proxy, API, worker, Postgres, Redis).
- 🧪 **CI/CD, linting and tests.** ESLint + Prettier, Vitest unit tests, secret scanning, dependency review, CodeQL, Dependabot, and a tag-triggered release workflow that publishes GHCR images.
- 🛡️ **Upload and input hardening.** Workspace ids are validated before any path is built, files are staged and cleaned up safely, inputs are trimmed, embedding dimensions are validated, and every conversation procedure enforces ownership.

### 🔧 Changed

- ⬆️ **Dependency refresh:** tRPC v11, TanStack Query v5, Vite 8, Zod 4, react-markdown 10, Drizzle Kit 0.31, and LangChain 0.3.37 with a clean production audit.

### 🐛 Fixed

- 📤 **Uploads could stage files outside the intended workspace** or orphan them on failure; the route now validates the workspace, writes to a server-controlled path, and removes leftovers on every failure path.
- 🔒 **Conversation access was not consistently scoped to the owner**; every conversation procedure now checks it.
- 🧾 **Validation gaps** in trimming, embedding dimensions and a missing key now fail fast with clear errors.
- ❤️ **The dependency-aware health check had been dropped in a merge** and was restored.

### 📝 Notes

- 🐳 Images: `ghcr.io/pranesh-selvaraj/nexus-backend:0.2.0` and `nexus-frontend:0.2.0`.
- ⏳ At this point settings lived in `.env` only, providers were OpenAI-only, and there was no DOCX support, no conversation titles, no backup/restore and no study features.
