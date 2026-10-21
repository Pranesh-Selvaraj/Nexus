# Changelog

All notable changes to Nexus are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versioning follows [Semantic Versioning](https://semver.org/).

Releases are listed newest first. Every release uses the same layout: a `## [X.Y.Z] - YYYY-MM-DD` heading, an emoji on each section, and one emoji-prefixed, single-line entry per change. The release workflow extracts the section matching the pushed tag and publishes it verbatim as the GitHub Release body. Each roadmap phase ships as a normal minor release (`1.2.0` = Phase 0, `1.3.0` = Phase 1, ...), in order.

## [Unreleased]

## [1.5.0] - 2026-10-21

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
- 🔉 **Read-aloud prefers the server voice and falls back to the browser.** The browser `SpeechSynthesis` path is used automatically when no TTS provider is configured or synthesis fails, so the feature works offline-ish and without a key.

### 🐛 Fixed

- 🎤 **The microphone could stay active when recording was stopped before the permission prompt resolved.** The recorder awaited `getUserMedia` and only afterwards created the `MediaRecorder`, so a stop or unmount during the await was a no-op and the audio track leaked. A cancellation flag is now checked after the await and the stream is disposed immediately.
- 📝 **Browser dictation could silently discard the final transcript.** The accumulated text was published before recognition flushed its last result, and a recognition session that ended on its own never published at all. Publishing now happens once from the recognition `end` event, with a timeout fallback.
- ⏩ **Changing read-aloud speed re-synthesized at the previous speed.** The restart was scheduled through a closure that still held the old state value; the speech request and browser utterance now read the speed from a ref updated synchronously with the control.
- 🎭 **The stored content type of an uploaded recording was client-controlled.** The audio filter accepted a file when either the extension or the declared MIME looked valid, and the declared MIME was stored and echoed back on playback. The type is now derived from the allowlisted extension, and the streaming endpoint sends `nosniff` and an inline disposition.
- 🗂️ **`voice.audio.list` ignored its `workspaceId` parameter**, listing every asset for the user; it now scopes to the workspace as well.
- ⚖️ **Audio quota eviction was nondeterministic on equal timestamps**, so the evicted asset could vary between runs; ties now break on id.
- 🔇 **The browser voice-list helper leaked its global `onvoiceschanged` handler**, accumulating listeners page-long; it is now cleared on resolve.

### 🔒 Security

- 🛡️ **Audio uploads are hardened (S-2).** Transcription clips are capped by `MAX_AUDIO_MB`, filtered by an extension **and** MIME allowlist, buffered in memory and written only to a server-generated path, and nothing is persisted unless the user opts in to keeping recordings.
- 🔐 **Cached speech is owner-scoped and served defensively.** Audio assets are looked up by owner, streamed with `X-Content-Type-Options: nosniff`, an inline disposition and Range support, and the stored MIME is derived from the extension rather than trusted from the upload.
- 📦 **Vite 8.2.1 → 8.3.5 (GHSA-587h-7wmj-h5pm, GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw).** A high-severity `launch-editor` file-existence issue and two moderate argument-handling issues, all build/dev-time through the Vite toolchain; `pnpm audit` is back to 0 vulnerabilities on both the full and production graphs.
- 🧹 **Retention defaults stay conservative.** Cached speech is kept for 7 days by default and capped at 200 MB per user; recordings are not stored unless explicitly requested.

### 📝 Notes

- 🧪 **Verification for this release:** 157 backend unit tests across 18 files (plus 6 shared), 94/94 smoke checks against real Postgres and Redis with the deterministic mock provider, two Playwright suites (happy path plus a full voice/language flow that records through a fake media device), and 35 visual-QA captures; `typecheck`, `lint`, `format:check`, `build` and `pnpm audit` are clean.
- ⏳ **Deliberately deferred:** audio overviews (V-5, two-host podcast generation and listen-to-my-cards playlists), graded readers, grammar explanation and drills, exam presets, roleplay scenarios, fluency metrics (rate/pauses/fillers), parallel text, and PWA offline/sleep-timer playback.
- 🎙️ **Voice chat is turn-based push-to-talk.** Full-duplex barge-in and streaming partial transcripts over WebSocket are not implemented; pronunciation scoring is local alignment, not a cloud phoneme assessment API, and is presented as feedback rather than a grade.
- 🔊 **Server speech has no word timestamps**, so sentence highlighting is proportional to sentence length over the real clip duration; the local STT fallback expects an externally run faster-whisper server (no bundled sidecar or container).
- 🗄️ **Migrations 0011 and 0012** add `audio_assets`, `vocabulary_items`, `cefr_estimates` and `pronunciation_attempts`, plus the unique vocabulary/CEFR indexes; the e2e voice suite forces `voice.sttMode=server` for determinism (the per-run database is disposable).

## [1.4.0] - 2026-10-01

Phase 2 adds the complete study loop to each workspace: highlights and notes, flashcards generated from your own documents and scheduled with FSRS, review sessions with interval previews, quiz generation with grading and a mistake notebook, tutor personas, Mermaid-capable studio artifacts, and a dashboard that reports what is due and how retention is trending. This is the release where Nexus stops being only a place to ask questions and becomes a place to remember, practise and be examined.

### Added

- **Study mode per workspace.** A Chat / Study switch sits above each workspace; Study contains Dashboard, Review, Decks and Notes tabs. The chat view stays mounted while Study is open, so the conversation and any in-flight answer survive tab switches.
- **AI-generated flashcards.** A document (via the cards button on a ready document, or the Decks tab) or any selected passage is sent to the chat model with a strict JSON contract; the response is parsed tolerantly (code fences stripped, malformed entries dropped) and creates QA cards in the workspace's default deck. Generation reports how many cards were created and surfaces a friendly error when the material yields none.
- **FSRS spaced repetition.** Cards are scheduled with ts-fsrs: the full scheduler state (due date, stability, difficulty, elapsed/scheduled days, learning steps, reps, lapses, state) is stored per card, so scheduling is deterministic across restarts and instances. New cards are due immediately; every rating produces a real next interval.
- **Review sessions.** The queue shows the card front, reveals the answer on Space, and offers Again / Hard / Good / Easy buttons with the interval each rating would schedule plus number-key shortcuts (1-4). The session ends with a reviewed count and returns to the dashboard.
- **Deck management and Anki export.** Create, review and delete decks; each deck reports total, due and new counts. Cards export as a quoted `front,back` CSV that Anki imports directly.
- **Highlights and notes.** Selecting text in a chat answer opens a toolbar with **Ask** (prefills the composer with the passage), **Highlight** (stores the passage with an optional note) and **Cards** (generates flashcards from the passage). The Notes tab lists highlights and Markdown notes with tags, both editable in place.
- **Progress dashboard.** Due now, new cards, reviews today, streak (consecutive UTC review days), 30-day retention and cards added in the last seven days, aggregated from the review and progress-event tables.
- **Per-document card generation.** Every ready document row has a cards button that generates a starter deck in one click.
- **Tutor personas.** Eight built-in modes - default, Socratic tutor, patient explainer, exam coach, writing coach, debate partner, language partner and code mentor - each layer a mode-specific instruction on top of the configured system prompt, so grounding and citation rules always apply. The default is stored in settings and the composer overrides it per chat; the active description is shown next to the picker.
- **Quizzes with grading.** Quizzes are generated from a document (or any selected passage) as multiple choice, true/false and short-answer questions. Multiple choice and true/false are graded exactly; short answers are graded by meaning with one model call and fall back to keyword overlap when the provider is unavailable. Every attempt is scored and stored.
- **The mistake notebook.** Wrong answers can be turned into flashcards in the default deck in the same submission, so a failed quiz immediately feeds the spaced-repetition queue. The result screen explains each question and shows the cards created.
- **Studio artifacts.** A per-workspace studio generates summaries, study guides, glossaries (Markdown tables) and Mermaid mind maps from any indexed document, renders them with the same Markdown/KaTeX renderer used by chat, and supports copy and delete.

### Fixed

- **Security: five dependency advisories cleared, including a critical production issue.** `proxy-addr` 2.0.7 → 2.0.8 (GHSA-jqcg-44mw-7w3h, critical, IP spoofing via IPv4-mapped addresses, reachable through express and express-rate-limit in the production graph), `shell-quote` 1.9.0 → 1.12.0 (GHSA-pqg4-j6r4-53mv, critical command injection, concurrently dev tooling), `source-map-js` 1.2.1 → 1.2.2 (GHSA-68fv-2mgg-jv7q, high, vite/tailwind), `katex` 0.16.47 → 0.18.9 (GHSA-238p-pmpm-9mq7, low, pulled by rehype-katex), and `sprintf-js` removed from the tree entirely by overriding mammoth's CLI-only `argparse` 1.x to 2.x (GHSA-hp3w-g68c-fv3c, moderate; the library entry point Nexus uses never imports argparse). `pnpm audit` is clean for both the full and production dependency graphs again.
- **Cards never graduated from the FSRS learning state.** The scheduler's `learning_steps` counter was not persisted with the rest of the card state, so every review restarted the learning steps and cards never reached the review state. The column is now stored (migration 0009) with a regression test that asserts graduation after two successful steps.
- **The selection toolbar missed keyboard and programmatic selections** because it only listened to `mouseup`; it now reacts to `selectionchange` scoped to the message log.

### Improved

- The smoke suite grew from 59 to 78 checks (card generation, due previews, review scheduling, progress aggregation, CSV export, note and highlight storage, persona listing, quiz generation/get/submit/mistake cards, artifact generation/list/delete), backend unit tests from 75 to 103 (FSRS scheduling, streak computation, tolerant card and quiz parsing, heuristic grading, persona registry), and the Playwright happy path now covers the whole study flow: generate cards from a document, review one with the keyboard, save a highlight from the selection toolbar, switch persona, generate a quiz, answer it to 100%, and generate and open a studio artifact.

### Limitations and deliberate omissions

- **Quiz questions are generated, not curated.** There is no manual question editor yet, and quizzes are single-document (or selection) rather than workspace-wide.
- **Anki export is CSV, not `.apkg`.** Anki imports the CSV directly; packaged decks with media are deferred.
- **Only QA cards are generated and there is no manual card editor in the UI yet.** Cloze deletion and image occlusion are not implemented. Mistakes become plain QA cards.
- **FSRS runs with its default parameters.** There is no per-user retention/parameter optimization yet, and no per-day new-card limit beyond the due queue size.
- **Notes and highlights are not indexed into retrieval yet.** They are stored and shown, but chat answers do not search them until the notes-as-sources opt-in ships.
- **Personas are a global default plus a per-chat override.** Per-workspace persona defaults and learner-context injection from progress are not implemented.
- **Streaks are computed in UTC** and retention is a simple share of Hard/Good/Easy ratings over 30 days, not a stability-based metric.

## [1.3.0] - 2026-10-01

Phase 1 makes retrieval trustworthy and the workspace usable on a phone. The headline fix is that semantic-only matches are no longer silently dropped by a keyword filter (B-2); around it, answers now use a token budget, cite verifiable sources, and can be inspected, while changing the embedding model surfaces a re-index banner instead of a pgvector error.

### Added

- **Hybrid retrieval with Reciprocal Rank Fusion.** Retrieval now fetches two independent candidate arms - the 50 nearest vectors and the 50 best keyword matches (`websearch_to_tsquery` on a populated `chunks.content_fts` column) - and fuses them by rank rather than filtering one arm by the other. A chunk that matches only semantically is therefore retrieved even when other chunks contain the query words, which was the single largest quality defect in the product (B-2). Chunks carry heading context when embedded, and the fused result is diversified (at most three chunks per document, content-hash dedupe) before selection.
- **Retrieval profiles: Fast, Balanced, Thorough.** Fast is union fusion only; Balanced also rewrites follow-up questions and enforces the context budget; Thorough additionally reranks candidates with the text model. The profile is a setting, so cost and latency are predictable.
- **Follow-up question rewriting.** When a conversation has history, the cheapest configured model rewrites the latest message into a standalone search query before retrieval (cached for 10 minutes); the query actually used is shown during streaming and in the inspector. `job.queryRewrite.model` can point this at a cheap model.
- **LLM listwise reranking.** Thorough (or an explicit toggle) asks the text model to reorder the top 20 candidates by relevance, tolerant of any parse failure. Reranked positions are visible in the inspector. `job.rerank.model` overrides the model used.
- **Retrieval inspector.** Every assistant answer stores a debug payload (profile, original vs rewritten query, candidate counts, vector/keyword/fused score per candidate, selection and rerank positions, token budget). "Why these sources?" opens a modal showing exactly how the answer's context was chosen - the tool that makes every later retrieval change measurable.
- **Answer feedback.** Thumbs up/down are stored per assistant message (`messages.feedback`, `chat.feedback` endpoint) and survive reloads, giving the evaluation work a real signal to build on.
- **Embedding provenance and bulk re-index.** Chunks store `embedding_model`, `embedding_dims`, `embedding_version` and `content_hash`; a workspace banner reports how many documents were indexed with a different setup and re-indexes them in one click (`document.retrievalStatus`, `document.reindexAll`), with a REINDEX badge per document.
- **Heading-aware chunk metadata.** Markdown headings split documents into sections; every chunk stores `heading_path`, page range, token estimate and content hash. Heading context is prepended before embedding (so sections are searchable by name) but not stored in the chunk text.
- **New settings:** `rag.profile`, `rag.queryRewrite`, `rag.rerank`, `rag.minScore`, `rag.maxContextTokens`, `job.queryRewrite.model`, `job.rerank.model`, plus a checkbox rendering for boolean settings.

### Fixed

- **Hybrid search silently excluded semantic-only candidates (B-2).** The old query required a full-text match before ranking, so a paraphrased question retrieved only chunks that shared its words. The keyword arm is now an addition, never a filter; covered by the smoke check "hybrid retrieval keeps semantic-only matches (B-2)" and `fuseRrf` unit tests.
- **Switching embedding models could break chat with a pgvector dimension error (B-3).** Vector comparisons are now scoped to the active model, with pre-Phase-1 rows matched by `vector_dims()` instead of being mixed into the same comparison. The re-index banner and bulk action replace the old "delete and re-upload every document" advice.
- **Non-English keyword search bypassed its index (B-10).** The English-only expression index (never declared in the schema) is replaced by a GIN index on a `tsvector` column populated at ingestion with the configured language, and migration 0007 backfills existing chunks so keyword search keeps working immediately after upgrade.
- **Source relevance was vector-only and never thresholded (B-15).** Sources now expose vector, keyword and fused scores; `rag.minScore` drops weak vector matches while always keeping keyword hits; citation numbers are validated against the actual source list and cited sources are marked with ✓ (so hallucinated `[9]` references cannot masquerade as sources).
- **The workspace was unusable on a phone (B-22).** The sidebar is an off-canvas drawer below `md`, the document panel stacks under the chat below `xl`, the conversation history becomes a header picker below `lg`, and the header/composer wrap without overlap. The visual harness can now complete the mobile chat flow, which it previously could not reach.
- **Prompt injection through documents had no guardrail.** Retrieved chunks are wrapped in `<source>` delimiters and the system prompt states that source text is reference material whose instructions must be ignored.
- **The context window could overflow silently.** `rag.maxContextTokens` budgets the retrieved sources (always keeping the best hit), and the inspector reports used vs allowed tokens.
- **Source rows overlapped on narrow screens** because the relevance percentage floated over wrapped titles; the summary is now a flex row with a truncated title.
- **Dev-dependency advisories:** vitest 4.1.10 → 4.1.11 (GHSA-82fw-gwwq-j7x9, path traversal / arbitrary file read via @vitest/mocker) and `brace-expansion` forced to ≥ 5.0.12 (GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p, GHSA-q2hr-2g5m-vwhr, reachable through minimatch/eslint tooling), so the full `pnpm audit` - not only the production graph - is clean and the fail-closed CI audit gate stays green.

### Improved

- Assistant answers now return their persisted message id in the `done` stream event, so client-side ids are replaced immediately and per-message actions (feedback) always target the stored row.
- The smoke suite grew from 55 to 59 checks (fusion with a semantic-only match, vector-arm fallback without keyword matches, retrieval status, bulk re-index, feedback persistence); backend unit tests grew from 60 to 75 with the pure retrieval helpers; the Playwright happy path now also asserts the sidebar document count, the cited-source marker, the retrieval inspector, and feedback surviving a reload.
- Chat history is still built server-side from persisted non-error messages, and source text expands fully in the list.

### Limitations and deliberate omissions

- **Golden-set evaluation (Recall@k, MRR, nDCG, LLM-judge faithfulness) is not in this release.** The inspector and feedback endpoint are the foundation; the metric harness and a fixture corpus for CI are the next retrieval work item.
- **Neighbor expansion and parent-child retrieval are not implemented.** Chunks still stand alone; adjacent-chunk expansion needs the section metadata that this release starts storing.
- **Reranking is listwise-LLM only** (no cross-encoder or provider rerank API); the hook is isolated so a dedicated reranker can be added without touching callers.
- **The full-text column is built with the language configured at ingestion.** Changing `retrieval.language` later requires re-indexing for keyword matching to use the new configuration; vector search is unaffected.
- **Query rewriting and reranking each add one model call per answer.** Balanced (the default) disables reranking and skips rewriting when there is no history; Thorough enables both.
- **Pre-Phase-1 documents show the re-index banner** because the embedding input now includes heading context (`embedding_version` changed). Retrieval keeps working meanwhile through the legacy dimension match; re-indexing is recommended, not required.
- **Mobile is usable but not fully redesigned** - the reader-mode, typography, and offline study work remain in later phases.

## [1.2.0] - 2026-10-01

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

## [1.1.0] and earlier

See the GitHub Releases for `v1.1.0`, `v1.0.0`, `v0.3.1`, `v0.3.0`, and `v0.2.0` at https://github.com/Pranesh-Selvaraj/Nexus/releases.
