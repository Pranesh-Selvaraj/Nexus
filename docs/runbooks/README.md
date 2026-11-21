# Runbooks

Operational procedures for a self-hosted Nexus. Each runbook assumes access to the host, the repository checkout and `docker compose` (or the equivalent deployment), and that Postgres and Redis are reachable.

## 1. Restore a backup

Nexus stores three kinds of state: the Postgres database (documents, chunks, cards, conversations, settings), the uploaded bytes (`UPLOAD_DIR` or the S3 bucket) and Redis (queues only — nothing here is authoritative).

1. **Take the database dump** (the maintenance job can do it nightly with `BACKUP_ENABLED=true`, writing to `BACKUP_DIR` and keeping `BACKUP_RETENTION_DAYS`):

   ```bash
   pnpm --filter @nexus/backend backup        # pg_dump into BACKUP_DIR
   ```

2. **Stop the API and worker** so nothing writes during the restore.
3. **Restore the database** into an empty database, then point `DATABASE_URL` at it:

   ```bash
   createdb -U nexus nexus_restore
   pg_restore --clean --no-owner -d postgres://nexus:nexus@localhost:5432/nexus_restore backup.dump
   ```

4. **Restore the bytes** to the same layout: copy `UPLOAD_DIR` back, or re-sync the S3 bucket (keys are `<workspaceId>/<uuid>`, immutable).
5. **Start the API/worker** and verify:

   ```bash
   curl -s localhost:3000/healthz          # {"status":"ok","db":"up","redis":"up"}
   ```

6. **Reindex anything that failed mid-restore**: documents whose `status` is `processing` or `failed` can be retried from **Settings → Jobs** (or `document.retry` over tRPC); the worker re-parses from the stored bytes.
7. **Check storage** with **Settings → Storage → self-test** (writes and deletes one `selftest/` object) when `STORAGE_DRIVER=s3`.

## 2. Rotate secrets

| Secret             | How to rotate                                                                                    | Effect                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `AUTH_PASSWORD`    | Change the env var and restart the API                                                           | The boot routine re-hashes it onto the local account and **deletes every session**, so old cookies stop working     |
| `SETTINGS_SECRET`  | Change, restart, re-enter provider keys in Settings                                              | Existing encrypted settings (provider keys, webhook signing secrets) become unreadable; the app asks for them again |
| API keys (`ndx_…`) | Settings → API keys → revoke, create a new one                                                   | Revocation is immediate (`401` on the next request); the plaintext is only shown once at creation                   |
| Share links        | Topic → Share → revoke                                                                           | The capability URL becomes indistinguishable from an unknown one (`404`)                                            |
| `METRICS_TOKEN`    | Change, restart                                                                                  | `/metrics` requires the new bearer token                                                                            |
| S3 credentials     | Rotate in the provider, update `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`, restart API and worker | Objects are unchanged; the self-test confirms access                                                                |

After rotating `AUTH_PASSWORD`, sign in again in every browser.

## 3. Stuck queue or documents that never become ready

Symptoms: documents stay `processing`, chat answers arrive without new sources, job counts in **Settings → Jobs** keep growing, `/metrics` shows queue depth without completions.

1. **Check the worker** is running and sees the same Redis URL as the API:

   ```bash
   docker compose ps worker
   docker compose logs --tail=100 worker
   ```

2. **Look at the job** for the document in **Settings → Jobs**. `retry` re-enqueues it; `drop` removes it. A document with a non-null `errorMessage` shows the parse failure on its library card.
3. **Check Redis** and the queue namespace — a mismatched `REDIS_URL` (for example the API on db 0 and the worker on db 9) means jobs are enqueued where nothing consumes them:

   ```bash
   redis-cli -u "$REDIS_URL" ping
   redis-cli -u "$REDIS_URL" keys 'bull:*' | head
   ```

4. **Rebuild a single document**: `document.retry` (or delete and re-upload). For an import that failed at fetch time, the error is on the document (`SSRF`, `HTTP 404`, timeouts).
5. **Trash and retention** are maintenance jobs: expired trash is purged after `STORAGE_TRASH_DAYS`, retained audio after `AUDIO_RETENTION_DAYS`. If those stop, the queue itself is stuck — restart the worker, then confirm with **Settings → Jobs**.
6. **Storage errors** (`ENOENT`, `NoSuchKey`) mean the database and the bytes disagree: restore the missing object or remove the document; run the storage self-test afterwards.

## 4. Health and observability

- `GET /healthz` returns `200` only when both Postgres and Redis answer; `503` otherwise.
- `GET /metrics` exposes request counts, durations and queue gauges (Prometheus). Protect it with `METRICS_TOKEN` when the API is reachable from outside.
- Structured logs are JSON with a request id echoed as `X-Request-Id`; correlate a user report with that id.
- The settings panel's **Jobs** and **Storage** cards cover the common operations without shell access.
