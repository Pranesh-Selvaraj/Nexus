# Changelog

All notable changes to Nexus are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versioning follows [Semantic Versioning](https://semver.org/).

Releases are listed newest first. Every release uses the same layout: a `## [X.Y.Z] - YYYY-MM-DD` heading, an emoji on each section, and one emoji-prefixed, single-line entry per change. The release workflow extracts the section matching the pushed tag and publishes it verbatim as the GitHub Release body. Nexus is pre-1.0: the line continues in small, contained steps (`0.3.1 → 0.4.0 → … → 0.4.5`), and a feature-heavy release gets a patch bump rather than a new major.

## [Unreleased]

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
