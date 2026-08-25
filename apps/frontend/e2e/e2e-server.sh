#!/usr/bin/env bash
# Starts the full Nexus stack for Playwright e2e:
#   mock OpenAI stub (3310) -> API (3000) -> embedding worker -> Vite dev (5173)
# Playwright waits on port 5173; on teardown the TERM trap kills the stack.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
export DATABASE_URL="${DATABASE_URL:-postgres://nexus:nexus@localhost:5432/nexus}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
export OPENAI_BASE_URL="${OPENAI_BASE_URL:-http://localhost:3310/v1}"
# Force keyless mode even if a .env provides a key - the stub must be used.
export OPENAI_API_KEY=""
export UPLOAD_DIR="${UPLOAD_DIR:-/tmp/nexus-e2e-uploads}"

(cd "$ROOT/apps/backend" && pnpm exec tsx scripts/mock-openai.ts >/tmp/nexus-e2e-mock.log 2>&1) &
MOCK_PID=$!
(cd "$ROOT/apps/backend" && pnpm exec tsx src/index.ts >/tmp/nexus-e2e-api.log 2>&1) &
API_PID=$!
(cd "$ROOT/apps/backend" && pnpm exec tsx src/workers/embedding.worker.ts >/tmp/nexus-e2e-worker.log 2>&1) &
WORKER_PID=$!

cleanup() {
  kill "$VITE_PID" "$MOCK_PID" "$API_PID" "$WORKER_PID" 2>/dev/null || true
}
trap cleanup EXIT TERM INT

for _ in $(seq 1 120); do
  if curl -sf http://localhost:3310/v1/models >/dev/null 2>&1 &&
    curl -sf http://localhost:3000/healthz >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

pnpm exec vite --port 5173 --strictPort &
VITE_PID=$!
wait "$VITE_PID"
