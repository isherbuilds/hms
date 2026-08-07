FROM node:24-slim AS base
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
ENV SKIP_ENV_VALIDATION=1

COPY . .
RUN --mount=type=cache,target=/root/.bun/install/cache bun install

ENV NODE_ENV=production
RUN cd apps/server && bun run build
ENV SKIP_ENV_VALIDATION=

EXPOSE 3000

WORKDIR /app/apps/server
# A failed migration prevents the server from accepting traffic. `exec` then
# makes the server the container process so it receives termination signals.
# The migrator is invoked directly rather than through the package script, which
# points at a dev-only `--env-file` that does not exist in the image.
CMD ["sh", "-c", "bun /app/packages/db/src/migrate-command.ts && exec bun dist/index.mjs"]
