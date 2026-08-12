# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Nexus backend - production image
# Build context must be the repository root.
#
# The runtime stage copies the workspace tree (apps, packages) plus the
# pruned node_modules store wholesale: pnpm's workspace symlinks
# (node_modules/@nexus/shared-types -> ../../packages/shared-types) are only
# valid when the whole layout travels together. The shared-types package is
# pure, erasable TypeScript, which Node 22.18+ strips natively at runtime.
# ---------------------------------------------------------------------------

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true
RUN corepack enable

# --- Build stage: install + compile + prune -------------------------------
FROM base AS build
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
RUN pnpm install --frozen-lockfile

COPY apps apps
COPY packages packages

# Compile backend to dist (test files excluded via tsconfig.build.json)
RUN pnpm --filter @nexus/backend build

# NOTE: no pnpm prune/deploy here - pnpm 11's prod-pruning removes the
# workspace top-level symlinks (node_modules/@nexus/shared-types), which
# breaks resolution at runtime. The runtime stage ships the full store
# instead; image size is a fair trade for correctness in a self-hosted app.

# --- Runtime stage ---------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app/apps/backend

COPY --from=build /app/apps /app/apps
COPY --from=build /app/packages /app/packages
COPY --from=build /app/node_modules /app/node_modules

# pnpm (isolated linker) puts each workspace package's dependency symlinks in
# the package-local node_modules dir; the shared .pnpm store lives at the
# root. Both must travel together for resolution to work.

# Uploads dir must be writable by the node user (uid 1000). When an empty
# named volume is mounted here, Docker seeds it with these permissions.
RUN mkdir -p /app/apps/backend/uploads && chown -R node:node /app/apps/backend

# Drizzle migrations are resolved relative to the compiled output
# (new URL('../drizzle', import.meta.url) inside dist/apps/backend/src)
COPY --from=build /app/apps/backend/drizzle /app/apps/backend/dist/apps/backend/drizzle

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# The worker runs the same image with a different command:
#   node dist/apps/backend/src/workers/embedding.worker.js
CMD ["node", "dist/apps/backend/src/index.js"]
