# Code style

Apply these to new or edited code. When in doubt, match the surrounding file
first, then run `bun run check`.

## Scope discipline

- **YAGNI / KISS.** Extract a helper at the _second_ real call site, not the
  first anticipated one. Delete unused exports.
- **Fail loud** on config, auth, money, and data-integrity errors. No silent
  defaults, no broad `catch`. `parseRoles` throwing on an unknown role rather
  than downgrading to `member` is the pattern.

## Functions and types

- Function declarations for named reusable functions; arrows for callbacks.
- Named exports. Default exports only where a framework contract demands one.
- `type` aliases for object shapes and unions; `interface` only for declaration
  merging or public extension points.
- Prefer inline parameter types over named ones unless the type is shared.
- Use `satisfies` when an object must match a contract but should keep its
  narrow inferred type — `{ userId, orgId } satisfies Scope`.

## Absence

- `null` for an explicit "no value" in state or an API response —
  `const orgId = orgMatch?.[1] ?? null`.
- `undefined` for optional or omitted fields. Do not mix the two in one API.

## Comments

Comment the **decision**, not the mechanics. The valuable comments in this
codebase all answer "why is this not the obvious thing?" — why membership is
uncached, why a tenant switch is a full document load, why checksums are
opt-in when presigning. A comment restating the code below it is noise.

## Database access

- Every org-scoped query carries `eq(table.orgId, context.scope.orgId)` in its
  `where`, including the ones that also filter by a primary key.
- Prefer a single scoped `UPDATE ... RETURNING` / `DELETE ... RETURNING` over
  select-then-write: one round trip, and no window between the check and the
  write.
- Index for the query you actually run. Tenant predicate first, then the sort
  and keyset columns in order, so a page is an index range scan.
- Paginate with keysets, not `OFFSET`.

## UI primitives

Use the components in `@hms/ui` for controls with a shared visual contract.
For example, use `NativeSelect` instead of copying a page-local Tailwind class
string onto `<select>`. Keep feature-specific layout and behavior in the route.

## Never hand-edit generated files

`packages/db/src/migrations/**` and `apps/web/src/routeTree.gen.ts` are
generated. New schema → `bun run db:generate`. Hand-authored SQL gets its own
migration file.
