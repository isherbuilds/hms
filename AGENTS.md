# Agent guidance

Hospital management system built on a multi-tenant application spine. Bun + Turborepo; TanStack Start (`apps/web`) + Hono/oRPC (`apps/server`); Drizzle + PostgreSQL; Better Auth with the organization plugin.

This file is a map plus the rules you must not break. Detail lives in [`docs/contributing/`](./docs/contributing/index.md) — update the closest doc in the same change as the code.

- [Project intent](./docs/contributing/project-intent.md) — what this repo is and is not
- [Product blueprint](./docs/product-blueprint.md) — canonical staff language, domain boundaries, finance flows, and delivery map
- [Decision records](./docs/contributing/decisions/index.md) — **check before proposing something already decided against**
- [Getting started](./docs/contributing/getting-started.md), [environment variables](./docs/contributing/environment-variables.md), [deployment](./docs/contributing/deployment.md)
- [Design](./docs/design.md) — **the UI source of truth**: surfaces, spacing, type, motion
- [Code style](./docs/contributing/code-style.md), [documentation principles](./docs/contributing/documentation.md), [testing principles](./docs/contributing/testing-principles.md)
- [Security invariants](./docs/contributing/security.md)
- Architecture: [overview](./docs/contributing/architecture/index.md) — [tenancy](./docs/contributing/architecture/tenancy.md), [authorization](./docs/contributing/architecture/authorization.md), [request lifecycle](./docs/contributing/architecture/request-lifecycle.md), [data fetching](./docs/contributing/architecture/data-fetching.md), [data storage](./docs/contributing/architecture/data-storage.md), [HMS domain layer](./docs/contributing/architecture/domain-layer.md), [accounting ledger](./docs/contributing/architecture/accounting.md), [audit](./docs/contributing/architecture/audit.md), [file storage](./docs/contributing/architecture/file-storage.md)
- [Research](./docs/research/) — evidence and external reference analysis, not accepted decisions
- [Harness engineering](./docs/contributing/harness-engineering.md) — how a repeated mistake becomes a guardrail
- Skills: [`org-scoped-feature`](./.agents/skills/org-scoped-feature/SKILL.md) to add an org-scoped domain, [`tenancy-review`](./.agents/skills/tenancy-review/SKILL.md) to audit a diff for cross-tenant leaks

## Commands

- `bun run check-types` — typechecks every TypeScript package, plus `tests/`. Two deliberate exceptions: `packages/config` ships no TypeScript, and `apps/fumadocs` is an Astro docs site checked by its own build. `apps/web/server/` is excluded because Nitro's auto-imports are resolved by its builder, not `tsc`.
- `bun run test` — integration tests against real Postgres (`packages/db/docker-compose.dev.yaml`; uses and wipes the `hms_test` database).
- `bun run check` — oxlint + oxfmt.
- `bun run db:generate` / `db:migrate` — drizzle-kit migrations in `packages/db/src/migrations/`.
- `bun run db:up` — starts the dev Postgres + SeaweedFS stack, waiting for health; no-op if already running.
- `bun run db:seed` — development accounts and two organizations; `-- --reset` wipes first. Prints the credentials. Refuses to run against `NODE_ENV=production`.

`bun run dev`, `dev:web`, and `dev:server` all run `db:up` then `db:migrate` before starting, so a fresh checkout is `bun install` + `.env` + one dev command.

## Hard rules

1. **Every domain row belongs to exactly one org (`orgId NOT NULL`), and every query carries the tenant predicate `eq(orgId, scope.orgId)`.** This includes infrastructure tables (`audit_log`, `file`), not just domain tables. `userId` columns are attribution, never scope.
2. **Org context is explicit procedure input, proven by the permission guard.** Org pages pass their `/:orgSlug` route param as `input.orgSlug` through the single `/rpc` client. Framework adapters supply only request dependencies (`session`, `headers`, and the request's own membership map); `orgProcedure(permission, input)` resolves membership directly in its internal guard and turns the claim into verified `context.scope`. The permission is a required constructor argument and the raw builder is not exported, so an org procedure cannot omit the guard. Handlers use only scope for authorization and SQL. Membership resolves once per request and is shared only within that request, never across requests — the permission check and its denial audit still run on every call — and there is no fallback to `session.activeOrganizationId`.
   - Org pages live under `apps/web/src/routes/$orgSlug/` and import the singleton `orpc`. Organization choices use normal route links. Every org query, mutation, direct call, and tenant-specific invalidation includes `orgSlug`, so generated query keys cannot reuse another tenant's data. Organization slugs are validated by `@hms/auth/organization-slug`: at least four characters, URL-safe, and outside the public/system root namespace. URLs make selection per-tab. The layout server-renders; its loader fetches `member.me` (always on the server, where the cache is request-local; a client navigation may reuse a ≤60 s-fresh result for the shell only), and Base UI popups stay behind `ClientOnly` (ADR 0021).
   - Sign-up is disabled: accounts are created by an operator via `createUserWithPassword` / `scripts/create-user.ts`, never through a public endpoint. Organization creation is restricted to the `FOUNDING_EMAIL` account alone — no role grants it, not even owners (see ADR 0014 and `scripts/create-founder.ts`).
   - A member's roles are stored comma-joined and authorize as a **union** (Better Auth's own semantics). Use `parseRoles`/`authorize` from `@hms/auth/access`; never read `role.split(",")[0]`.
3. **Audit sensitive actions, not everything.** `audit()` is fire-and-forget — it can never slow a response or turn one into a 500. Role denials are audited centrally in `orgProcedure`'s internal guard; routers call `audit()` only for sensitive/destructive mutations (e.g. `file.delete`). Patient mutations also keep this fire-and-forget behavior; do not move audit writes into domain transactions without a separately approved decision.
4. **Never hand-edit generated migrations.** New schema → `bun run db:generate`; hand-authored SQL gets its own migration file.
5. **Permissions live in `packages/auth/src/access.ts` only.** It stays dependency-free (no db, no env) so client and server share it. Each role states its grants explicitly rather than inheriting from another role.
6. **No secrets or server-only modules in client assets.**
7. **Stored objects are always private.** `@hms/storage` only ever issues short-lived presigned URLs; there is no unsigned read path and the bucket must never be anonymously readable. A visibility flag in the database with no storage-side counterpart is decoration — any bucket policy broad enough to serve "public" files also exposes every tenant's private ones.

## Conventions

- YAGNI/KISS: extract a helper only at the second real call site; delete unused exports.
- Fail loud on config, auth, money, and data-integrity errors — no defaults or broad catches.

## UI

- `packages/ui` is `shadcn` `base-lyra` on Base UI: `text-xs` body, compact controls, and the radius scale in `docs/design.md` §4 (`--radius` lives in `packages/ui/src/styles/globals.css`). Match it — don't introduce rounded, roomy components alongside it.
- This is an all-day console, so motion is rationed: none on frequent or keyboard-driven actions, `ease-out` enter/exit under 200ms where it carries spatial continuity (dialogs). `prefers-reduced-motion` is honoured globally in `globals.css`.
- Keyboard focus is guaranteed by an unlayered `:focus-visible` rule in `globals.css`, because component-level `focus-visible:ring-*` silently fails to paint on some primitives. Don't remove it. Hover effects are gated to `(hover: hover) and (pointer: fine)`.
