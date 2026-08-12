# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Nexus frontend - production image
# Build context must be the repository root.
# Serves the static bundle from nginx and reverse-proxies the API, uploads
# and WebSocket transport to the backend service (same-origin, no CORS).
# ---------------------------------------------------------------------------

FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
RUN pnpm install --frozen-lockfile

COPY apps apps
COPY packages packages

RUN pnpm --filter @nexus/frontend build

# --- Runtime stage ---------------------------------------------------------
FROM nginx:1.27-alpine AS runtime
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html

EXPOSE 80
