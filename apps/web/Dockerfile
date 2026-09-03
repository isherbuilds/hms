FROM node:24-slim AS builder
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

COPY . .
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile

ARG VITE_SERVER_URL
ENV VITE_SERVER_URL=${VITE_SERVER_URL}
ENV SKIP_ENV_VALIDATION=1
WORKDIR /app/apps/web
RUN bun run build

FROM node:24-slim AS runtime
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
RUN --mount=type=bind,from=oven/bun:1,source=/usr/local/bin/bun,target=/usr/local/bin/bun \
    --mount=type=cache,target=/root/.bun/install/cache \
    bun install --production --frozen-lockfile --filter web

COPY --from=builder /app/apps/web/.output ./apps/web/.output

RUN chown -R node:node /app
USER node

ENV HOST=0.0.0.0
ENV PORT=3001
EXPOSE 3001

# SSR chunks require() externals at runtime; must run from the workspace
WORKDIR /app/apps/web
CMD ["node", ".output/server/index.mjs"]
