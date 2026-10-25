# 0003 — Document storage abstraction (local disk + S3)

- **Status:** Accepted
- **Date:** 2026-10-25
- **Phase:** 6 (operations)

## Context

Document bytes were always written under `UPLOAD_DIR` with a path built from
`<workspaceId>/<uuid>`, and every reader (parsers, OCR, image previews, chat
attachments, exports, deletion) resolved that path against the directory. That
is fine for a single host with a mounted volume, but it ties the product to one
machine's filesystem: no multi-instance API, no object-storage backups, and a
lost volume means a lost library even though the database is fine.

The constraint is that the ingestion parsers are local-file tools (`pdf-parse`,
`mammoth`, `tesseract`, `pdftoppm`), not streaming consumers, and the existing
database already stores the relative path that identifies each object.

## Decisions

### 1. A narrow `StorageDriver` interface with `materialize`

`put`, `get`, `materialize`, `delete` and `deletePrefix`, selected by
`STORAGE_DRIVER`. Keys are the existing database paths, validated to reject
absolute paths, `..`, backslashes and empty segments.

`materialize(key)` returns a local absolute path: the local driver returns the
file path directly, the S3 driver downloads the object into `S3_CACHE_DIR` on
first use (and reuses it afterwards). This keeps every parser unchanged instead
of rewriting them around streams or temp files.

**Why:** the smallest interface that lets both backends serve every existing
call site, without leaking backend details into the ingestion code.

**Consequences:** the cache is a second copy of recently parsed objects on the
API/worker host; keys are immutable (server-generated UUIDs), so a cache entry
is never stale, but a key reused for new content would need explicit
invalidation. `delete` removes the cache entry, `deletePrefix` removes the
whole cached subtree.

### 2. S3 via the AWS SDK, path-style by default

The S3 driver uses `@aws-sdk/client-s3` with `S3_ENDPOINT` for MinIO/R2 and
`S3_FORCE_PATH_STYLE` defaulting to true when an endpoint is configured.
Credentials come from `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` or the SDK's
default chain. An optional `S3_KEY_PREFIX` lets deployments share a bucket.

**Why:** one client covers AWS and the self-hosted options; path-style avoids
the virtual-host DNS requirements that break MinIO on a LAN.

**Consequences:** the API proxies image bytes rather than handing out presigned
URLs (bucket stays private); `deletePrefix` lists and deletes in batches of up
to 1000 (S3 limit); a bucket must exist and be writable — the app does not
create buckets.

### 3. Local disk remains the default

`STORAGE_DRIVER` defaults to `local`, so existing installs upgrade without any
configuration change or data migration.

**Why:** the single-user self-hosted case is still the primary deployment, and
forcing object storage would add an operational dependency for no benefit.

**Consequences:** switching to S3 requires copying existing objects into the
bucket under the same keys; there is no dual-write or migration command yet.
`storage:selftest` validates credentials before the switch.

## Alternatives considered

- **Always S3** — removes the local path but forces every self-hoster to run
  MinIO; rejected.
- **Presigned URLs for previews** — less API load, but makes bucket policy and
  URL expiry part of the security model; proxying keeps one authorization path.
- **Streaming parsers** — avoids the cache copy, but every parser (and OCR's
  temp files) would need rework for little gain at personal-corpus sizes.
- **A separate media service** — another deployment unit and consistency
  boundary for a feature that is a thin adapter.

## Verification

- `LocalStorage` unit tests cover round-trips, materialization, single/prefix
  deletion and traversal rejection.
- The S3 driver was exercised end-to-end against an S3-compatible mock: upload
  through the API, the worker materialized and parsed the object, the document
  reached `ready`, image previews were served through the API with the original
  bytes, and deleting the workspace removed every object under its prefix.
- `pnpm --filter @nexus/backend storage:selftest` is the repeatable check for
  any deployment's configuration.
