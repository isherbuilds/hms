# Development

## Start locally

Prerequisites: Bun 1.3.14 (pinned in `package.json`) and Docker.

```sh
bun install
cp packages/env/.env.example packages/env/.env
# Fill in the environment file, then:
bun run dev
```

`dev` starts the local PostgreSQL/SeaweedFS stack, applies migrations, and runs
all apps. `dev:web` and `dev:server` run only the selected Turbo task, so use
`db:up` and `db:migrate` first when invoking either directly. Web defaults to
port 3001 and API to 3000.

Public sign-up is disabled. Create local accounts with:

```sh
bun run create-founder <name> <password>
bun run create-user <email> <name> <password>
bun run db:seed
```

Only `FOUNDING_EMAIL` may create Organizations. Other accounts receive
membership through invitation or an operator-managed membership.

## Repository map

| Path               | Purpose                                               |
| ------------------ | ----------------------------------------------------- |
| `apps/web`         | TanStack Start UI and SSR runtime                     |
| `apps/server`      | Hono host for auth, oRPC/OpenAPI, health, and logging |
| `apps/fumadocs`    | End-user product documentation                        |
| `packages/api`     | Domain routers, guards, transactions, and audit       |
| `packages/auth`    | Better Auth configuration, manual users, access model |
| `packages/db`      | Drizzle schema, migrations, database client           |
| `packages/storage` | Private S3/SeaweedFS presigning                       |
| `packages/env`     | Runtime environment loading and validation            |
| `packages/ui`      | Shared Base UI/shadcn components                      |
| `tests`            | Unit, integration, and isolated resilience tests      |

## Commands

| Command                      | Purpose                                                            |
| ---------------------------- | ------------------------------------------------------------------ |
| `bun run dev`                | Start database/storage, migrate, and run all apps                  |
| `bun run check-types`        | Typecheck TypeScript packages and `tests/`                         |
| `bun run check`              | Run oxlint and oxfmt (writes formatting)                           |
| `bun run test`               | Run real-Postgres integration and isolated tests; wipes `hms_test` |
| `bun run build`              | Build all workspaces                                               |
| `bun run db:up`              | Start local PostgreSQL and SeaweedFS                               |
| `bun run db:generate`        | Generate a Drizzle migration from schema changes                   |
| `bun run db:migrate`         | Apply migrations                                                   |
| `bun run db:seed -- --reset` | Reset and seed development data                                    |
| `bun run db:studio`          | Open Drizzle Studio                                                |

Before handoff, run `bun run check-types`, `bun run check`, and `bun run test`.
Run a production web build and visual inspection for SSR/UI changes.

## Code rules

- Prefer the simplest happy path. Extract a helper at the second real call site;
  delete unused exports.
- Fail loudly on config, auth, money, and data-integrity errors. Avoid silent
  defaults and broad catches.
- Use named function declarations for reusable functions and arrows for
  callbacks. Prefer named exports, `type` aliases, and `satisfies` for contracts.
- Use `null` for explicit absence in state/API results and `undefined` for
  omitted optional fields; do not mix them in one contract.
- Comment why the obvious approach is wrong, not what the next line does.
- Use `@hms/ui` primitives for shared controls. Feature layout stays near the
  route; shared visual contracts stay in `packages/ui`.
- Use keyset pagination and tenant-leading indexes. Scope writes with one
  `UPDATE/DELETE ... RETURNING` where possible.
- Never hand-edit generated migrations or `apps/web/src/routeTree.gen.ts`.
- No secret or server-only value import may reach client assets.

UI implementation follows [Design](./design.md): `text-xs` body, compact
controls, token colors/radii, stable focus visibility, and rationed motion.

## Tests

Pure no-I/O logic belongs in `tests/unit`. Anything touching a router, auth, or
the database belongs in `tests/integration` and uses real PostgreSQL through
`clientFor`.

- Prefer one end-to-end workflow test with meaningful assertions over many
  micro-tests.
- Keep top-level `test(...)`; avoid nested `describe` and shared mutable setup.
- Use factories that return ready-to-use users/Organizations; tests mint unique
  identities because the database is shared within a file.
- Assert oRPC codes, invariants, and state—not message copy or properties already
  guaranteed by types.
- Use `eventually`/`drainAuditWrites()` for fire-and-forget audit behavior; do
  not sleep.

Every org-scoped domain extends `GUARDED_CALLS` in
`tests/integration/tenancy.test.ts`, whose sweeps prove missing claim, foreign
claim, and immediate revocation. The domain test must additionally prove its
own rows are invisible across tenants.

## Documentation and decisions

The [documentation index](./README.md) defines ownership. Current behavior stays
in living docs; expensive decisions go into a compact entry in
[decisions](./decisions.md); evidence goes into the
[research ledger](./research/README.md). Do not add a Markdown file when a
section in an existing owner is enough.

When a repeated mistake appears, promote guidance from doc → test → type → lint
or structure → script. `AGENTS.md` remains short: map plus rules that must be
seen before any change.
