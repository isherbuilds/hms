# HMS

A multi-tenant hospital management system for OPD front-office and billing
workflows. The live product covers patients, OPD appointments and the daily queue,
catalog and staff setup, invoices and payments, credit notes and refunds,
reports, private files, audit history, and organization-scoped access.

The application uses Bun and Turborepo, TanStack Start, Hono/oRPC, Drizzle and
PostgreSQL, Better Auth, and SeaweedFS-compatible private object storage.

## Start locally

Prerequisites are Bun (the version pinned in `package.json`) and Docker.

```sh
bun install
cp packages/env/.env.example packages/env/.env
# Fill in the environment file, then:
bun run dev
```

The development command starts PostgreSQL and SeaweedFS, applies migrations,
and starts the web and API applications. The web app is served on port 3001 and
the API on port 3000 by default.

Public sign-up is disabled. Use `bun run create-founder`, `bun run create-user`,
or `bun run db:seed` to create local accounts.

## Repository map

- `apps/web` — TanStack Start application.
- `apps/server` — Hono host for auth, oRPC/OpenAPI, and health.
- `apps/fumadocs` — end-user documentation.
- `packages/api` — domain routers and authorization guards.
- `packages/auth` — Better Auth and the permission model.
- `packages/db` — schema, migrations, and database access.
- `packages/storage` — private object-storage operations.
- `packages/ui` — shared Base UI/shadcn components.
- `docs` — product, architecture, decisions, setup, operations, and active specs.

Start at the [documentation index](docs/README.md). The compact sources of truth
are [Product](docs/product.md), [Architecture](docs/architecture.md),
[Development](docs/development.md), [Operations](docs/operations.md), and the
[Decision log](docs/decisions.md).

Before handing off a change, run:

```sh
bun run check-types
bun run check
bun run test
```
