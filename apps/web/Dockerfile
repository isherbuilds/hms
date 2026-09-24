FROM oven/bun:1.4.2-slim AS builder
WORKDIR /app

# Manifests first, so a source-only change reuses the installed dependencies.
COPY package.json bun.lock ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/fumadocs/package.json ./apps/fumadocs/package.json
COPY packages/api/package.json ./packages/api/package.json
COPY packages/auth/package.json ./packages/auth/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/env/package.json ./packages/env/package.json
COPY packages/storage/package.json ./packages/storage/package.json
COPY packages/ui/package.json ./packages/ui/package.json
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile
COPY . .

ARG VITE_SERVER_URL
ARG VITE_WEB_URL
ARG VITE_WHATSAPP_NUMBER
ARG VITE_CONTACT_EMAIL
ENV VITE_SERVER_URL=${VITE_SERVER_URL}
ENV VITE_WEB_URL=${VITE_WEB_URL}
ENV VITE_WHATSAPP_NUMBER=${VITE_WHATSAPP_NUMBER}
ENV VITE_CONTACT_EMAIL=${VITE_CONTACT_EMAIL}
ENV SKIP_ENV_VALIDATION=1
WORKDIR /app/apps/web
RUN bun run build

FROM oven/bun:1.4.2-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Every workspace manifest, or the frozen lockfile refuses to resolve the graph.
COPY package.json bun.lock ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/fumadocs/package.json ./apps/fumadocs/package.json
COPY packages/api/package.json ./packages/api/package.json
COPY packages/auth/package.json ./packages/auth/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/env/package.json ./packages/env/package.json
COPY packages/storage/package.json ./packages/storage/package.json
COPY packages/ui/package.json ./packages/ui/package.json
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --production --frozen-lockfile --filter web

COPY --from=builder /app/apps/web/.output ./apps/web/.output

# Root-owned files stay world-readable; a recursive chown would copy every
# dependency into a second layer.
USER bun

HEALTHCHECK --interval=5s --timeout=5s --start-period=10s --retries=10 \
    CMD ["bun", "-e", "fetch('http://127.0.0.1:3001/').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

ENV HOST=0.0.0.0
ENV PORT=3001
EXPOSE 3001

# SSR chunks require() externals at runtime; must run from the workspace
WORKDIR /app/apps/web
CMD ["bun", ".output/server/index.mjs"]
