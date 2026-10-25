# 0001 — Multimodal ingestion and vision architecture

- **Status:** Accepted
- **Date:** 2026-10-21
- **Phase:** 4a (ingestion + vision, release `v0.4.6`)

## Context

Nexus started as a text-document RAG workspace (PDF, DOCX, TXT, MD, CSV, JSON).
Phase 4a makes it ingest "anything a learner has": books, web articles, videos,
audio, slides, spreadsheets, open-document formats, archives, images and
scanned pages, plus vision chat over images. The constraints are a single Node
backend process, a self-hosted deployment with no external services beyond an
OpenAI-compatible provider, and a hard requirement that untrusted files and
URLs cannot exhaust the host or reach the internal network.

## Decisions

### 1. The parser is chosen by magic bytes, not by the file name

`services/ingestion/magic.ts` detects the format from the leading bytes
(and, for zip containers, from the entry names), `validate.ts` admits or
rejects the upload, and `registry.ts` maps the detected format to exactly one
parser. The client-supplied extension is metadata only.

**Why:** an extension allowlist cannot tell a real DOCX from a renamed
executable, and a renamed PDF must not be handed to the wrong parser.
Content-addressing also gives duplicate detection for free (sha256 of the
bytes) and makes "is this file supported?" a single lookup.

**Consequences:** the stored format can differ from the uploaded name (a PNG
named `notes.docx` is stored as `png`), adds/removals of formats happen in two
places (format enum in `@nexus/shared-types`, parser map in the registry), and
every new format needs a fixture built in its test rather than a binary blob.

### 2. Readability is implemented in-repo instead of pulling in jsdom

`services/ingestion/readability.ts` scores candidate blocks, prefers
`article`/`main`, strips chrome and converts structure to Markdown, with no
DOM library.

**Why:** Mozilla's Readability needs jsdom (~5 MB of DOM emulation plus a
transitive dependency tree) for output Nexus only turns into plain text. The
security posture of URL ingestion is "never render source markup", so a full
DOM is unnecessary surface.

**Consequences:** extraction quality is slightly below Readability's on
unusual layouts; the heuristics are covered by focused unit tests and can be
replaced behind the same `extractArticle` interface if that becomes a problem.

### 3. URL fetching uses a custom SSRF-safe transport, not `fetch`

`services/ingestion/url-fetch.ts` resolves the hostname, classifies **every**
resolved address (loopback, RFC1918, CGNAT, link-local, cloud metadata,
benchmarking, documentation, multicast; the IPv4-embedded forms of IPv6), pins
the connection to a validated address through a custom `lookup`, follows
redirects manually with re-validation at each hop, and caps the body and the
wall clock.

**Why:** `fetch`/`undici` hides the resolved address from the caller, so the
check-then-connect window (DNS rebinding) cannot be closed. Ingestion is a
user-triggered server-side request, which is the classic SSRF shape.

**Consequences:** only `http`/`https` GET is supported (no cookies, no auth
headers, no chunked uploads), the guard is exercised by unit tests over the
address classifier plus smoke checks against a strict instance, and
`INGEST_ALLOW_PRIVATE_HOSTS=true` exists as a documented test/self-host
override that must stay off for anything reachable from the internet.

### 4. OCR uses the system `tesseract` binary, not tesseract.js

`services/ingestion/ocr.ts` shells out to `tesseract` (and poppler's
`pdftoppm` to rasterize scanned PDFs), with `TESSERACT_BIN`/`PDF_RASTER_BIN`
overrides, a wall-clock timeout and an output cap.

**Why:** tesseract.js downloads ~15 MB of language data on first use, which
breaks air-gapped self-hosting and adds a network dependency to an ingestion
path. A system binary is also much faster per page.

**Consequences:** OCR is optional — when the binaries are missing, images fall
back to the vision model and scanned PDFs fail with an actionable message
naming the packages to install. Extra OCR languages require the matching
traineddata in the image/host.

### 5. Vision is a provider capability, not a subsystem

`services/ingestion/vision.service.ts` reuses the OpenAI-compatible chat client
with an `image_url` content part, with optional dedicated
base URL / key / model settings (`vision.*`). Images are stored as ordinary
documents; their searchable text is the vision description plus OCR text, so
retrieval, citations and the chat pipeline are unchanged. Chat turns reference
images by document id and the bytes never touch the client or the history.

**Why:** a separate vision pipeline (CLIP/ColPali embeddings, a second index)
would double the storage and retrieval paths for a feature that is mostly
"describe and discuss this image". Description-as-text keeps image sources
citable exactly like text sources.

**Consequences:** vision quality is bounded by the configured model's
description; when no vision provider is configured images index through OCR
only and the UI hides the analysis affordances, and re-analysis is needed if
the model changes (cached per image hash + mode + question + model).

### 6. Ingestion limits are explicit, configurable ceilings

Zip containers are checked for entry count, per-entry and total uncompressed
size, compression ratio and nesting depth; parsers run under a wall-clock
timeout; extracted text is capped; decompression is streamed with a hard byte
ceiling so a lying central directory cannot allocate past its budget.

**Why:** zip bombs, billion-laughs XML and a 900-page scan are all things a
single uploaded file can trigger. Defaults must be safe without tuning, and
operators need a way to raise them for unusual corpora.

**Consequences:** every limit is an environment variable (documented in
`.env.example` and README), defaults favour safety over size (200 MB total,
50 MB per entry, 100:1 ratio), and rejection happens at upload admission with
a 400 and a user-facing message instead of a failed background job.

## Alternatives considered

- **Tika/Unstructured as a single extraction service:** a JVM/Python sidecar
  for formats Nexus already parses natively; rejected for deployment weight.
- **tesseract.js:** rejected (see above) for air-gapped operation and latency.
- **CLIP/ColPali image embeddings:** rejected for this phase — a second
  embedding space and index for marginal retrieval gain on personal corpora;
  the description-as-text approach keeps one index and one model contract.
- **`undici` with a custom dispatcher for SSRF:** viable, but the raw
  `http`/`https` transport made the address pinning and byte capping explicit
  and dependency-free.

## Superseded

Nothing. This record adds the ingestion and vision decisions to the earlier
retrieval/study/voice architecture described in the README.
