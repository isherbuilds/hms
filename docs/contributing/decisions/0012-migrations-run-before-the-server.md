# 0012: Migrations run before the server

- **Status:** accepted
- **Date:** 2026-08-06

## Context

The server, test harness, and development seed each supplied their own relative
path to `packages/db/src/migrations`. The production path was resolved from the
server bundle's location, coupling deployment to the bundler's output layout,
and every caller used a URL pathname where a decoded filesystem path was
required.

Coolify has no repository-controlled release phase that runs the new image
before it receives traffic. Its pre-deployment command runs in the existing
container, which does not contain the new release's migrations, while its
post-deployment command runs too late. The image start command is therefore the
available version-controlled pre-traffic boundary.

## Decision

The production container runs the `@hms/db` migration command before
starting the server. The command uses the same application migrator as tests
and the development seed, resolves the migrations from the database package,
and retains its PostgreSQL advisory lock. The server bundle neither locates nor
applies migrations.

## Consequences

A migration failure exits the container before the server accepts traffic, and
concurrent starters serialize on the advisory lock. Migration files and their
source runner must remain available in the runtime image; a future slim image
must copy or compile that runner explicitly.

During a rolling deployment, the old server may continue serving after the new
schema is applied. Migrations must therefore remain compatible with the old
application until that release has drained; destructive changes require an
expand-and-contract deployment.
