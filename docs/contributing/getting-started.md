# Getting started

## Prerequisites

- [Bun](https://bun.sh) — the version in `package.json` `packageManager`
- Docker, for the local PostgreSQL

## Setup

```sh
bun install
cp packages/env/.env.example packages/env/.env
# Fill it in, then:
bun run dev
```

`bun run dev` starts the local Postgres and SeaweedFS stack (via Docker Compose,
skipping it if already running), applies any pending migrations, then starts
everything through Turborepo. `bun run dev:web` and `bun run dev:server` do the
same setup and run one app.

## Creating accounts

Sign-up is disabled: there is no public registration path. An operator creates
each account directly:

```sh
bun run create-user <email> <name> <password>
```

The password is hashed by Better Auth's own algorithm, so the account signs in
normally at `/login`. To place the account into an organization, invite it from
**Members → Invite** and let the person accept at `/join`, or add the membership directly.
Until `sendInvitationEmail` in `packages/auth/src/index.ts` is wired to a real
provider, the invitation link is logged and also returned by `member.invite`.

### The first organization

Organization creation is closed to everyone except the account identified by
`FOUNDING_EMAIL` (in `packages/env/.env`) — not even an organization owner can
create another. Provision that account once:

```sh
bun run create-founder <name> <password>
```

The founder signs in like any account, creates at `/create`, and becomes the
owner of each organization they create. See
[ADR 0014](./decisions/0014-founding-email-bootstrap.md).

`bun run db:seed` creates development accounts and two organizations the same
way an operator would. See [ADR 0013](./decisions/0013-signup-disabled.md).

## Commands

| Command                  | What it does                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run check-types`    | Typechecks every TypeScript package plus `tests/`. `packages/config` ships no TypeScript; `apps/fumadocs` is checked by its own build; `apps/web/server/` is resolved by Nitro. |
| `bun run check`          | oxlint + oxfmt (writes).                                                                                                                                                        |
| `bun run test`           | Integration tests against real PostgreSQL. Uses and **wipes** the `hms_test` database.                                                                                          |
| `bun run db:generate`    | Generates a drizzle-kit migration into `packages/db/src/migrations/`.                                                                                                           |
| `bun run db:migrate`     | Applies migrations.                                                                                                                                                             |
| `bun run db:up`          | Starts the dev Postgres + SeaweedFS stack (`packages/db/docker-compose.dev.yaml`), waiting for it to be healthy. No-op if already running.                                      |
| `bun run db:seed`        | Development accounts and two organizations, so org switching can be exercised from one login. `-- --reset` wipes first. Prints credentials. Refuses `NODE_ENV=production`.      |
| `bun run create-user`    | `create-user <email> <name> <password>` — creates one account directly (ADR 0013).                                                                                              |
| `bun run create-founder` | `create-founder <name> <password>` — creates the `FOUNDING_EMAIL` account for the first org (ADR 0014). Idempotent.                                                             |
| `bun run db:studio`      | Drizzle Studio.                                                                                                                                                                 |

All TypeScript workspaces use TypeScript 7's native CLI. The Astro docs app is
checked through `astro build` rather than the root `check-types` task.

Run all three of `check-types`, `check`, and `test` before calling a change
done.

## Where things live

| Path               | Holds                                                                    |
| ------------------ | ------------------------------------------------------------------------ |
| `apps/web`         | TanStack Start app. Org-scoped pages live under `routes/$orgSlug/`.      |
| `apps/server`      | Hono host: Better Auth handler, oRPC RPC + OpenAPI handlers, and health. |
| `apps/fumadocs`    | Product documentation site.                                              |
| `packages/api`     | The oRPC router, request context, procedure guards, `audit()`.           |
| `packages/auth`    | Better Auth config and `access.ts`, the permission source of truth.      |
| `packages/db`      | Drizzle schema, migrations, the migrator.                                |
| `packages/storage` | SeaweedFS/S3 presigning.                                                 |
| `packages/env`     | Validated environment schemas (server and web).                          |
| `packages/ui`      | shadcn `base-lyra` components on Base UI.                                |
| `tests/`           | Integration tests plus their support harness.                            |
