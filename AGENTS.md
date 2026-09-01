# Agent guidance

Hospital management system built on a multi-tenant application spine. Bun + Turborepo; TanStack Start (`apps/web`) + Hono/oRPC (`apps/server`); Drizzle + PostgreSQL; Better Auth with the organization plugin.

This file is a map plus the rules you must not break. Start at the
[documentation index](./docs/README.md) and update the closest owner in the same
change as code.

- [Product](./docs/product.md) — scope, canonical language, finance flows, roadmap gates
- [Architecture](./docs/architecture.md) — tenancy, auth, requests, data, audit, files, accounting
- [Development](./docs/development.md) and [Operations](./docs/operations.md)
- [Decision log](./docs/decisions.md) — **check before revisiting an architectural choice**
- [Design](./docs/design.md) — **the UI source of truth**
- [Current work registry](./docs/README.md#work-lifecycle) — the only list of unfinished documentation-backed work
- [Research ledger](./docs/research/README.md) — evidence, not product authority
- Skills: [`org-scoped-feature`](./.agents/skills/org-scoped-feature/SKILL.md) to add an org-scoped domain, [`tenancy-review`](./.agents/skills/tenancy-review/SKILL.md) to audit a diff for cross-tenant leaks

## Commands

Use the canonical setup and command table in [Development](./docs/development.md#commands).
Two commands mutate local state by design: `bun run check` writes formatting,
and `bun run test` wipes the `hms_test` database.

## Hard rules

1. **Every domain row belongs to exactly one org (`orgId NOT NULL`), and every query carries the tenant predicate `eq(orgId, scope.orgId)`.** This includes infrastructure tables (`audit_log`, `file`), not just domain tables. `userId` columns are attribution, never scope.
2. **Org context is explicit procedure input, proven by the permission guard.** Org pages pass their `/:orgSlug` route param as `input.orgSlug` through the single `/rpc` client. Framework adapters supply only request dependencies (`session`, `headers`, and the request's own membership map); `orgProcedure(permission, input)` resolves membership directly in its internal guard and turns the claim into verified `context.scope`. The permission is a required constructor argument and the raw builder is not exported, so an org procedure cannot omit the guard. Handlers use only scope for authorization and SQL. Membership resolves once per request and is shared only within that request, never across requests — the permission check and its denial audit still run on every call — and there is no fallback to `session.activeOrganizationId`.
   - Org pages live under `apps/web/src/routes/$orgSlug/` and import the singleton `orpc`. Organization choices use normal route links. Every org query, mutation, direct call, and tenant-specific invalidation includes `orgSlug`, so generated query keys cannot reuse another tenant's data. Organization slugs are validated by `@hms/auth/organization-slug`: at least four characters, URL-safe, and outside the public/system root namespace. URLs make selection per-tab. The layout server-renders; its initial loader fetches `member.me` through the request-local server client, while client navigation may reuse a ≤60 s-fresh result or refetch through `/rpc`. Base UI popups stay behind `ClientOnly` (decision D008).
   - Sign-up is disabled: accounts are created by an operator via `createUserWithPassword` / `scripts/create-user.ts`, never through a public endpoint. Organization creation is restricted to the `FOUNDING_EMAIL` account alone — no role grants it, not even owners (decision D006 and `scripts/create-founder.ts`).
   - A member's roles are stored comma-joined and authorize as a **union** (Better Auth's own semantics). Use `parseRoles`/`authorize` from `@hms/auth/access`; never read `role.split(",")[0]`.
3. **Audit sensitive actions, not everything.** `audit()` is fire-and-forget — it can never slow a response or turn one into a 500. Role denials are audited centrally in `orgProcedure`'s internal guard; routers call `audit()` only for sensitive/destructive mutations (e.g. `file.delete`). Patient mutations also keep this fire-and-forget behavior; do not move audit writes into domain transactions without a separately approved decision.
4. **Never hand-edit generated migrations.** New schema → `bun run db:generate`; hand-authored SQL gets its own migration file.
5. **Permissions live in `packages/auth/src/access.ts` only.** It stays dependency-free (no db, no env) so client and server share it. Each role states its grants explicitly rather than inheriting from another role.
6. **No secrets or server-only modules in client assets.**
7. **Stored objects are always private.** `@hms/storage` only ever issues short-lived presigned URLs; there is no unsigned read path and the bucket must never be anonymously readable. A visibility flag in the database with no storage-side counterpart is decoration — any bucket policy broad enough to serve "public" files also exposes every tenant's private ones.

## Conventions

- YAGNI/KISS: extract a helper only at the second real call site; delete unused exports.
- Fail loud on config, auth, money, and data-integrity errors — no defaults or broad catches.

## How to work

Ship the minimal sufficient change. Plan aggressively, execute lightly. Anything
you cannot prove is needed is not built by default — abstractions, config layers,
compatibility shims, and tests included.

- Before touching code, restate in a few lines: what the user wants, the scope of
  this change, what you will explicitly not do, and what counts as done.
- Read the code that owns the behaviour. Don't assemble a conclusion out of grep hits.
- Fix the root cause once. No stacked patches, dual code paths, or a second
  implementation kept alongside the old one.
- Stop and shrink the plan the moment you catch yourself adding an abstraction the
  requirement doesn't need, designing for a future caller, adding constraints to
  satisfy earlier constraints, or editing many unrelated files.
- One thread per task. Split work across parallel agents only after a single pass
  shows it is too big. Load only the skills the task needs.
- Reserve deep reasoning for planning; drop to a lighter model for the edit-and-test
  loop. If the executing model starts growing architecture or scope, stop and rewrite
  the minimal plan.
- Irreversible operations require the user's explicit confirmation immediately
  before execution. Git revert, rollback, and branch switch, moves into the
  repo's backup directory, running tests, and read-only analysis are not irreversible.
- Before calling it done: intent and acceptance restated, minimal file set touched,
  related existing tests run, diff small, no debug leftovers, nothing built only to
  look complete.

## Testing

Tests prove this change. They do not fill historical coverage gaps or build a future
test system.

- Run the existing tests that cover the change first. If they prove it correct, add nothing.
- Add a test only when this change alters behaviour nothing covers, or the user asks for
  one. At most one happy path, plus one key failure path if it earns its place.
- No new test frameworks, dependencies, directories, large snapshots, parameter matrices,
  or end-to-end suites.
- Never reshape product behaviour to satisfy a test you wrote first, and never treat a
  green suite as licence for more abstraction.
- If the test is longer or trickier than the implementation, it is over-engineered — cut
  the test or shrink the implementation.

## UI

- `packages/ui` is `shadcn` `base-lyra` on Base UI: `text-xs` body, compact controls, and the radius scale in `docs/design.md` §4 (`--radius` lives in `packages/ui/src/styles/globals.css`). Match it — don't introduce rounded, roomy components alongside it.
- Base UI primitives emit their own state attributes (`data-pressed`, `data-checked`, `data-disabled`) — never Radix's `data-state="on"`. A `data-[state=…]:` Tailwind variant on a Base UI component silently styles nothing; use `data-pressed:` / `data-checked:`.
- This is an all-day console, so motion is rationed: none on frequent or keyboard-driven actions, `ease-out` enter/exit under 200ms where it carries spatial continuity (dialogs). `prefers-reduced-motion` is honoured globally in `globals.css`.
- Keyboard focus is guaranteed by an unlayered `:focus-visible` rule in `globals.css`, because component-level `focus-visible:ring-*` silently fails to paint on some primitives. Don't remove it. Hover effects are gated to `(hover: hover) and (pointer: fine)`.
