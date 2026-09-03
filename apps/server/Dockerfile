FROM node:24-slim AS builder
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

COPY . .
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile

WORKDIR /app/apps/server
ENV SKIP_ENV_VALIDATION=1
RUN bun run build

FROM node:24-slim AS runtime
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
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
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --production --frozen-lockfile --filter server

COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/packages/db/src ./packages/db/src
COPY --from=builder /app/packages/env/src ./packages/env/src

RUN chown -R node:node /app
USER node

EXPOSE 3000

WORKDIR /app/apps/server
# A failed migration prevents the server from accepting traffic. `exec` then
# makes the server the container process so it receives termination signals.
# The migrator is invoked directly rather than through the package script so the
# image does not need turbo on the runtime path. No .env ships in the image
# (see .dockerignore); every value comes from the platform's environment.
CMD ["sh", "-c", "bun /app/packages/db/src/migrate-command.ts && exec bun dist/index.mjs"]
