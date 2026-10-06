# Agent guidance

Hospital management system on a multi-tenant spine. Bun + Turborepo; TanStack Start (`apps/web`) + Hono/oRPC (`apps/server`); Drizzle + PostgreSQL; Better Auth with the organization plugin.

This file is the map plus the rules you must not break. Read the linked owner for
the behavior being changed; use the [documentation index](./docs/README.md) when
ownership is unclear. Update that owner when the change makes its guidance stale.

- [Product](./docs/product.md) — scope, canonical language, finance flows, roadmap gates
- [Architecture](./docs/architecture.md) — tenancy, auth, requests, data, audit, files, accounting
- [Development](./docs/development.md) — setup, commands, check policy; [Operations](./docs/operations.md)
- [Decision log](./docs/decisions.md) — **check before revisiting an architectural choice**
- [Design](./docs/design.md) — **the UI source of truth**
- [Current work registry](./docs/README.md#work-lifecycle) — the only list of unfinished work
- Project skills: [`lean-code`](./.agents/skills/lean-code/SKILL.md) for router/component structure, data flow, or simplification work; [`org-scoped-feature`](./.agents/skills/org-scoped-feature/SKILL.md) to add an org-scoped domain; [`tenancy-review`](./.agents/skills/tenancy-review/SKILL.md) to audit a diff for cross-tenant leaks

## Commands

Use the command table in [Development](./docs/development.md#commands). Two commands
mutate local state: `bun run check` writes formatting and `bun run test` wipes
`hms_test`. A read-only review uses non-mutating checks appropriate to the change:
`bunx oxlint`, `bunx oxfmt --check`, type checks, or tests verified not to change
source files or shared data. Do not run writing formatters or database-wiping tests
as part of a read-only review.
One session at a time owns a database-wiping test run.

## Stage

Pre-production code: no backward compatibility, deprecated aliases, or shims (see
`lean-code`). Migrations follow hard rule 4.

## Runtime check

Run this before reporting UI, route, or API work.

1. `docker info` fails → `open -ga Docker`, then retry until it answers.
2. `bun run dev:status`. Web or API down → start `bun run dev` once as a background
   process owned by the main session (it runs `db:up` and `db:migrate` first). Portless
   needs `bunx portless proxy start` once per machine.
3. "Migrations unverified" means the local database follows another branch or
   worktree. Report it and ask before `bun run db:seed -- --reset`, which drops the
   dev schema.
4. Empty database → `bun run db:seed`. Sign in at `https://hms.localhost/login` as
   `owner@example.com` / `password123` (also `admin@` and `staff@`; local seed only).
5. Drive the changed path with populated data at a phone and a desktop width, and in
   dark theme where the screen has one. A redirect to `/login` after step 4 is a
   blocker to report, not a pass.
6. Teardown: stop only what you started. Killing the `bun run dev` wrapper leaves the
   portless children holding the URLs, so stop the listeners on ports 56443–56445
   (`lsof -nP -iTCP:56443-56445 -sTCP:LISTEN`) if you started them.

## Hard rules

1. **Every domain row belongs to exactly one org (`orgId NOT NULL`), and every query carries the tenant predicate `eq(orgId, scope.orgId)`.** This includes infrastructure tables (`audit_log`, `file`). `userId` columns are attribution, never scope.
2. **Org context is explicit procedure input, proven by the permission guard.** Org pages pass their `/:orgSlug` route param as `input.orgSlug` through the single `/rpc` client. `orgProcedure(permission, input)` resolves membership in its internal guard and turns the claim into verified `context.scope`; the permission is a required constructor argument and the raw builder is not exported. Handlers use only scope for authorization and SQL. Membership resolves once per request and never across requests; there is no fallback to `session.activeOrganizationId`.
   - Org pages live under `apps/web/src/routes/$orgSlug/` and import the singleton `orpc`. Every org query, mutation, and invalidation includes `orgSlug`, so query keys cannot reuse another tenant's data. Slugs are validated by `@hms/auth/organization-slug`. The layout server-renders; its loader fetches `member.me` through the request-local server client. Base UI popups stay behind `ClientOnly` (D008).
   - Public sign-up is closed. An account is created only by native sign-up carrying a live invitation id for that email, or by an operator via `scripts/create-user.ts`. The invitation id is the recipient's proof until an email provider exists (D006), so it reaches only members with the invite grant. Only the `FOUNDING_EMAIL` account creates organizations (D006, `scripts/create-founder.ts`).
   - Roles are stored comma-joined and authorize as a **union**. Use `parseRoles`/`authorize` from `@hms/auth/access`; never read `role.split(",")[0]`.
3. **Audit sensitive actions, not everything.** `audit()` is fire-and-forget and can never slow a response or turn one into a 500. Role denials are audited centrally in `orgProcedure`; routers call `audit()` only for sensitive or destructive mutations. Do not move audit writes into domain transactions without an approved decision.
4. **Never hand-edit generated migrations.** New schema → `bun run db:generate`; hand-authored SQL gets its own migration file. Migrations are append-only once data is retained.
5. **Permissions live in `packages/auth/src/access.ts` only.** Dependency-free, shared by client and server. Each role states its grants explicitly.
6. **No secrets or server-only modules in client assets.**
7. **Stored objects are always private.** `@hms/storage` issues only short-lived presigned URLs; the bucket is never anonymously readable.

## Enforced rules

When an agent repeats a corrected mistake, move its rule up this table: architecture, type, lint, test, prose.

| Rule                                                                         | Enforced by                             |
| ---------------------------------------------------------------------------- | --------------------------------------- |
| One page size: cursor procedures take `pageLimit`; list queries omit `limit` | lint `accly/no-local-page-size`         |
| No bigint literals in `.tsx` (React Compiler rewrites them)                  | lint `accly/no-bigint-in-components`    |
| `apps/web` Effects only sync an external system, with a reason               | lint `accly/no-use-effect`              |
| Migrations on `origin/main` ran in production: never edit, delete or squash  | `scripts/check-migrations.ts`           |
| Static choices use `NativeSelect`                                            | architecture (no `Select` in `@hms/ui`) |
| No compatibility code, backfills or legacy paths (pre-production)            | prose (Stage)                           |
| Say it once: no subtitle or heading that repeats the body                    | prose (`docs/design.md`)                |
| A review or "check" request produces findings, not an implementation         | prose (personal guidance)               |

## How to work

Personal guidance covers ownership, reviews, git, testing, and verification; this
file adds the project rules.

- Fail loud on config, auth, money, and data-integrity errors: no defaults, no broad catches.
- Irreversible operations need confirmation right before execution. Git revert, branch switch, running tests, and read-only analysis are not irreversible.
- Missing runtime evidence is Verification, not completion: record the blocker and next action in the [work registry](./docs/README.md#work-lifecycle).

## UI

- `packages/ui` is `shadcn` `base-lyra` on Base UI: `text-xs` body, compact controls, radius scale in `docs/design.md` §4. Match it.
- Base UI primitives emit `data-pressed`, `data-checked`, `data-disabled`, never Radix's `data-state="on"`. A `data-[state=…]:` variant styles nothing; use `data-pressed:` / `data-checked:`.
- All-day console, so motion is rationed: none on frequent or keyboard-driven actions; `ease-out` enter/exit under 200ms only where it carries spatial continuity. `prefers-reduced-motion` is honoured globally.
- The desk is run by receptionists, not technical staff: each fact appears once per screen (no identity repeated between `PageHeader` and body), main actions visible with their amounts, rare or destructive ones in a `⋯` menu, readable controls (default height for money actions), and plain labels ("Bill this sitting", not ledger terms). See `docs/design.md` "Say it once".
- Keyboard focus comes from an unlayered `:focus-visible` rule in `globals.css`; do not remove it. Hover effects are gated to `(hover: hover) and (pointer: fine)`.
