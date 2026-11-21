# REST API v1

A scoped HTTP API for scripts, agents and integrations. It is the same retrieval and permission model as the UI, but **API-key authenticated only** — session cookies are ignored, so a cross-site browser request cannot reach it.

Base URL: `http://localhost:3000/api/v1` (or your deployment's origin).

## Authentication

Create a key in **Settings → API keys**, choose its scopes, and copy it once — only a sha256 hash is stored.

```bash
curl -H "Authorization: Bearer ndx_…" http://localhost:3000/api/v1/me
# or
curl -H "X-API-Key: ndx_…" http://localhost:3000/api/v1/me
```

Every route checks a specific scope; a key without it gets `403`. Keys are revoked immediately in the same panel. Error bodies are always `{ "error": "message" }`.

## Scopes

| Scope             | Grants                          |
| ----------------- | ------------------------------- |
| `documents:read`  | list topics and their documents |
| `documents:write` | upload files, import URLs       |
| `notes:write`     | create notes                    |
| `reviews:read`    | list cards due now              |
| `reviews:write`   | submit card reviews             |
| `search`          | hybrid search                   |
| `ask`             | grounded answers with citations |

## Endpoints

| Method & path                    | Scope             | Purpose                                                |
| -------------------------------- | ----------------- | ------------------------------------------------------ |
| `GET /me`                        | any valid key     | key identity and scopes                                |
| `GET /workspaces`                | `documents:read`  | topics the key can see, with document counts           |
| `GET /documents?workspaceId=…`   | `documents:read`  | sources with status, format and metadata               |
| `POST /documents`                | `documents:write` | multipart upload (`file` + `workspaceId`) into a topic |
| `POST /urls`                     | `documents:write` | import an article or YouTube transcript                |
| `POST /notes`                    | `notes:write`     | create a note in a topic                               |
| `GET /reviews/due?workspaceId=…` | `reviews:read`    | cards due now (`deckId`, `limit` optional)             |
| `POST /reviews`                  | `reviews:write`   | grade a card (`again`/`hard`/`good`/`easy`)            |
| `GET /search?q=…&workspaceId=…`  | `search`          | ranked sources with scores                             |
| `POST /ask`                      | `ask`             | grounded answer with citations and timings             |

`workspaceId` is the same id the UI calls a _topic_.

## Examples

```bash
# list topics the key can reach
curl -s -H "Authorization: Bearer $NEXUS_KEY" http://localhost:3000/api/v1/workspaces

# ask a grounded question in a topic
curl -s -X POST http://localhost:3000/api/v1/ask \
  -H "Authorization: Bearer $NEXUS_KEY" \
  -H 'content-type: application/json' \
  -d '{"workspaceId":"…","question":"What does the paper say about recall?"}'

# import a web article
curl -s -X POST http://localhost:3000/api/v1/urls \
  -H "Authorization: Bearer $NEXUS_KEY" \
  -H 'content-type: application/json' \
  -d '{"workspaceId":"…","url":"https://example.com/article"}'
```

## Limits and behaviour

- Rate limits apply per route (uploads, URL imports, ask); a `429` carries the retry expectation.
- Uploads are capped by `MAX_UPLOAD_MB` (default 25 MB) and imports by `MAX_IMPORT_MB`.
- Answers stream in the UI over WebSocket; this API returns the completed answer with sources and timings.
- A missing resource and a forbidden one are both `404` for cross-tenant lookups, by design.
- OpenAPI generation from the contract schemas is not published yet; this page is the canonical route list until it is.
