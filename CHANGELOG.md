# Changelog

Every Nexus release is documented here in detail. The release workflow extracts the section for the pushed tag and uses it verbatim as the GitHub Release body, so each entry is self-contained: what was added, changed, improved and fixed, why it happened, and what the user-visible effect is. Phase tags are annotated semver prereleases (`vX.Y.Z-phase.N`); the stable tag for a phase set is `vX.Y.Z`. Newest entries first.

## [Unreleased]

## [v1.2.0-phase.0] - 2026-10-01

Phase 0 is the hygiene and blockers phase: every item here was either a correctness bug, a security/dependency issue, or the infrastructure needed for the later phases. Retrieval quality itself (hybrid fusion, reranking, mixed embedding dimensions, multilingual FTS indexing, mobile layout) is deliberately **not** in this release; it is Phase 1 and is listed under limitations below.

### Added

- **Indexing diagnostics.** Documents now store a sanitized failure reason, the number of attempts, and an update timestamp (`documents.error_message`, `documents.attempts`, `documents.updated_at`, migration `0006`). Failed rows show the reason and attempt count, and offer **Retry** and **Delete** independently. Previously a failed document could only be retried — never removed — and the actual error existed only in the worker console.
- **Workspace archive import over a streaming endpoint.** `POST /api/workspace/import` accepts the exported JSON as a multipart file with `MAX_IMPORT_MB` (default 100 MB), so real backups are no longer rejected by the 1 MB JSON body cap that applies to tRPC calls. The endpoint validates the decoded payload against document-count and total-size limits, validates document file types against the ingestion allowlist, restores per-message token usage (which the old importer silently dropped), and shares its implementation with the tRPC mutation.
- **Batch settings endpoint.** `settings.updateMany` validates and persists several settings in one call, so cross-field invariants are checked against the final state instead of the order in which fields happen to be saved.
- **Public config endpoint.** `config.public` exposes the app name and the effective upload limit before login, so the shell and upload dropzone no longer depend on the protected settings list.
- **Chat message actions.** Stop generation (disabling the subscription tears the stream down server-side), Copy, Retry on errors, and Regenerate (re-answers the last user message and replaces the trailing assistant/error row instead of duplicating the question).
- **Rich answer rendering.** GFM tables, KaTeX math (`remark-math` + `rehype-katex`), syntax-highlighted code with a per-block copy button, and safe external links. The renderer is lazy-loaded so KaTeX/highlight.js stay out of the workspace bundle (the workspace chunk dropped from 675 kB to 83 kB).
- **Toasts** replace `alert()` and silent failures for import, export, delete, copy, and mutation errors; deleting the active workspace clears the selection instead of leaving a dead panel.
- **Session-expiry handling.** Any `UNAUTHORIZED` tRPC error now routes the app back to the login screen; previously an expired cookie left every panel stuck in a failed state.
- **Release notes pipeline.** `CHANGELOG.md` is now the source of truth for release bodies: the release workflow extracts the section for the pushed tag and passes it to `gh release create --notes-file` instead of using generated notes. Prerelease tags no longer move the `latest` container tag.

### Fixed

- **Conversation titles were regenerated on every message.** The title job sat outside the "new conversation" branch, so each follow-up burned an extra LLM completion and renamed the conversation to match the latest question. Titles are now generated only when a conversation is created.
- **PDF page numbers were always 1.** `pdf-parse` joins pages with blank lines, not form feeds, so the split never found page boundaries and every chunk reported page 1; blank pages would additionally have shifted later numbers. Extraction now uses a custom page renderer that appends a page marker, numbers pages before filtering empty ones, and passes a `Uint8Array` because pdf.js v1 misparses some Node `Buffer`s with "bad XRef entry". Regression tests build real multi-page PDFs including a blank page.
- **Provider errors were stored as assistant answers.** A failed generation persisted the friendly error text as a normal assistant message, so after reload it rendered as an answer and was replayed to the model as history. Messages now carry `kind` (`answer`/`error`, migration `0006`); errors render distinctly, are excluded from prompts, and chat history is built server-side from persisted non-error messages instead of trusting client-supplied turns.
- **Removing or rotating `SETTINGS_SECRET` took down the settings page and chat.** Decryption ran unguarded during reads, so one unreadable secret made `settings.list` throw and chat fail with a crypto error. Reads now fall back to the environment/default value, and the settings UI flags unreadable keys with a re-entry banner.
- **Chunk size/overlap validation was one-directional and save-order dependent.** Only the overlap field was checked against the currently stored size, so `chunkSize=200` with overlap 200 was accepted and every subsequent upload failed in the worker. The new batch endpoint validates `overlap < size` against the post-save values.
- **Changing `AUTH_PASSWORD` left old sessions valid.** The boot path now verifies the configured password against the stored hash, and only when it changed re-hashes and deletes the user's sessions, so a leaked cookie cannot outlive a credential change.
- **Workspace import failed above ~1 MB** because the archive was sent as a tRPC JSON body under the global 1 MB limit; see the streaming endpoint above.
- **Upload limits disagreed across four places.** The dropzone hardcoded 25 MB, multer followed the `MAX_UPLOAD_MB` environment value, the request guard followed the `server.maxUploadMb` setting, and nginx capped `/api` at 30 MB. The dropzone now uses the public config, multer is a 100 MB backstop, and nginx was raised to 110 MB as a backstop so the backend's configured limit is what users experience.
- **Deleting a document could still burn provider tokens.** Indexing jobs now use the document id as their BullMQ job id (so retries cannot create duplicate work) and deleting a document removes its queued job.
- **The worker marked documents failed mid-retry.** BullMQ emits `failed` on every attempt, so a document briefly showed as failed while retries were still pending and the error text was never stored. The worker now records the error and attempt count on every failure but only sets `failed` once attempts are exhausted.
- **Workspace archive export lost token usage** (it hardcoded `usage: null`) and imported messages skipped it; both paths now preserve usage, and invalid archive timestamps no longer reach the database.
- **Streaming showed a duplicate empty assistant bubble.** The pending assistant message (rendered as "Thinking...") and the live streaming bubble were both visible mid-answer; the empty placeholder is now skipped while streaming, so there is exactly one growing bubble with sources, caret, and Stop.
- **The sidebar document count stayed stale after upload/delete.** The sidebar reads `workspace.list`, which was never invalidated by document mutations; upload, delete, and retry now invalidate it, and the upload success notice clears itself after six seconds.
- **Query-embedding cache ignored the embedding provider.** Switching endpoints while keeping the same model name and dimensions served vectors from the previous provider for up to 24 hours; the cache key now includes the provider base URL.
- **The chat stream trusted an arbitrary conversation id.** After checking only workspace ownership, a reused `conversationId` could point at another user's conversation. Reused conversations are now verified to belong to the caller's workspace.
- **Dependency advisories:** 7 moderate advisories are cleared. `multer` 2.3.0 → 2.4.0 (GHSA-3pph-fpjx-jg34), `express-rate-limit` 8.6.2 → 8.7.0 which pulls `ip-address` ≥ 10.7.1 (GHSA-rpw4-54j3-4h4q, GHSA-2vr4-cq9g-pvrc, GHSA-j6r3-76f7-8jcv, GHSA-h3mg-xc3c-68pw), and a `qs` override ≥ 6.16.0 (GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g) reachable through express/body-parser. `pnpm audit --prod` is clean again, restoring the fail-closed audit gate.

### Improved

- **Streaming performance and control.** Tokens are batched into state every 50 ms instead of re-rendering markdown per token, the message list auto-scrolls only while the user is near the bottom (with a "jump to latest" button otherwise), and conversation switching is disabled while an answer streams so the live bubble and query invalidation cannot target the wrong conversation.
- **Accessibility.** The streaming phase is announced through a polite live region (not per token), icon buttons have labels, the message list is a labelled log, and source text expands fully instead of being clamped.
- **Error surfaces.** Upload rejections name the configured size limit, workspace import errors are specific (invalid JSON, invalid archive, too many documents, size limit), and settings errors return actionable messages.
- **Developer experience.** The smoke suite grew from 49 to 55 checks (batch settings validation, archive export/import round-trip, invalid archive rejection), e2e ports are overridable (`E2E_PORT`, `E2E_API_PORT`) so the suite runs when another service owns 3000/5173, `e2e-server.sh` starts Vite from the frontend package regardless of the caller's directory, the mock provider's stream delay is configurable (`MOCK_STREAM_DELAY_MS`) so visual QA can observe mid-stream states, and generated Drizzle meta files are formatted so `pnpm format:check` stays green.

### Security

- Session invalidation on password change; global UNAUTHORIZED handling in the client.
- Conversation ownership verification in the chat stream (cross-workspace write closed).
- Dependency advisories cleared as listed above; no known production vulnerabilities remain.

### Limitations and deliberate omissions

- **Hybrid retrieval still filters candidates by keyword match** (a semantic-only chunk is excluded whenever any chunk matches the query terms). This is the highest-impact retrieval defect and is scheduled for Phase 1 together with reranking, score thresholds, citation validation, and a retrieval inspector.
- **Changing the embedding model still requires re-indexing documents manually.** Per-chunk embedding provenance, a "needs re-index" banner, and bulk re-indexing are Phase 1.
- **The full-text index is created for the English configuration only**, so non-English search falls back to a sequential scan; the per-language index strategy is Phase 1.
- **Mobile layout is not usable yet** (fixed-width columns overflow at phone widths); the responsive layout is part of the Phase 1 UI workstream (B-22).
- **Undo for deletes** was deferred because it needs soft-delete columns and a purge window across workspaces, documents, and conversations; it is scheduled with the storage/retention work in Phase 4.
- **Archive import still decodes the JSON in memory** (bounded by `MAX_IMPORT_MB`); a streaming zip format is Phase 1+.
- The screenshot harness's mid-stream capture can still catch a completed answer because the mock provider streams quickly; the retrieval inspector and slower fixtures will make the streaming state easier to capture.

## [v1.1.0] and earlier

See the GitHub Releases for `v1.1.0`, `v1.0.0`, `v0.3.1`, `v0.3.0`, and `v0.2.0` at https://github.com/Pranesh-Selvaraj/Nexus/releases.
