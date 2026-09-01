---
name: tenancy-review
description: >-
  Audit a diff, branch, or file for cross-tenant leaks and authorization regressions in this
  repo — missing org predicates, re-derived scope, cached membership, role parsing, presigned
  URL handling and org-route context. Use before merging anything touching packages/api,
  packages/auth, packages/db/src/schema, packages/storage, or
  apps/web/src/routes/$orgSlug/.
---

# Tenancy review

One tenant seeing another's row is a different class of bug from everything else
in this repository. This is the checklist for catching it before it ships.
Invariants: [tenancy and authorization](../../../docs/architecture.md#tenancy-and-authorization)
and decisions D001, D002, D005, and D008 in the
[decision log](../../../docs/decisions.md).

Review the diff, not the whole codebase. Report findings ranked by blast radius:
a leak first, a denial-path gap second, a convention slip last.

## 1. The tenant predicate

For every query added or changed:

- Does the `where` contain `eq(table.orgId, context.scope.orgId)`?
- **Including** queries that already filter by primary key. `eq(t.id, input.id)`
  alone is the leak — it returns another tenant's row instead of `NOT_FOUND`.
- Infrastructure tables count. `audit_log` and `file` are org-scoped too.
- Is a `userId` filter being used _as_ scope? `userId` is attribution. A query
  scoped only by `userId` is unscoped.

## 2. The source of scope

- Handlers must read `context.scope.orgId` for authorization and SQL scope.
- `input.orgSlug` is only a claim; no handler should authorize or predicate a query
  from the URL, session, or input.
- The claim is a slug, the proven value is an id. A handler predicating on a slug
  — or a `Scope` carrying one — is a defect.
- Is every org procedure declared with
  `orgProcedure(permission, orgInput.extend(...))`?

## 3. Context and guard

Changes to `packages/api/src/lib/context.ts` or
`packages/api/src/lib/procedures/factory.ts` deserve the most scrutiny:

- Does `orgProcedure`'s internal guard use parsed `input.orgSlug` only to query
  membership, then expose the matched row's org as verified `context.scope`?
- Does slug resolution still happen _inside_ the membership join? Splitting it
  into a separate lookup reintroduces an oracle for which orgs exist.
- Is `beforeUpdateOrganization` in `packages/auth` still rejecting slug changes?
  A mutable slug would let a rename re-point existing links at another tenant
  (D001 in the [decision log](../../../docs/decisions.md)).
- Is membership resolved for every org procedure and uncached across requests?
- Is the permission a required `orgProcedure` constructor argument, with the raw
  builder unavailable to routers?
- Is foreign membership still `FORBIDDEN`, with no fallback to the user's only
  org, last org, or `session.activeOrganizationId`?
- Are role denials audited only after membership is verified?
- Does a foreign membership claim avoid writing into the claimed tenant's audit
  trail, with no audit side effect during context construction?

## 4. Roles and permissions

- Permissions defined anywhere other than `packages/auth/src/access.ts`?
- Did `access.ts` gain a database or environment import? It must stay
  dependency-free — the client imports it.
- Any `role.split(",")` outside `parseRoles`? Roles are a **union**; reading the
  first entry silently drops privileges.
- Does a role inherit from another instead of stating its grants explicitly?
- Is a client-side permission check being treated as enforcement? Hiding a
  button is cosmetic; the server must re-check.

## 5. Storage

- Any new path that serves file bytes through the app server? Bytes go browser
  ↔ SeaweedFS directly.
- Any unsigned read path, `visibility` flag, or bucket-policy change? Every
  object is private; presigned URLs only.
- Do new key operations call `assertKeyInScope` before touching the database?
- Is a presigned URL being logged, or put in an audit `meta` payload? It is a
  bearer credential.
- Are user-supplied names still sanitized into the key?

## 6. Web routes

- Do org pages live under `apps/web/src/routes/$orgSlug/`?
- Do they import the singleton `orpc` and include the route `orgSlug` in every org
  query, mutation, direct call, and tenant-specific invalidation key?
- Does the layout keep `ssr: true`, fetch `member.me` in its loader, and isolate
  every Base UI popup behind `ClientOnly`? The client may reuse a ≤60 s-fresh
  membership result for the shell; that is accepted by D008 in the
  [decision log](../../../docs/decisions.md). What is never
  acceptable is a procedure trusting cached membership instead of proving it.

## 7. Auth surface

- A re-opened sign-up path, or any public path that creates an account?
- Cookie attributes still `httpOnly` / `secure` / `sameSite: "lax"`?
- Is the OpenAPI reference still gated off in production?

## 8. Tests

- Does a new org-scoped domain extend `tests/integration/tenancy.test.ts` with
  all four questions (invisible cross-org, same-client concurrent orgs, foreign
  org, removed member)? A domain that proves only the first has proven the easy half.
- Are assertions on oRPC codes rather than message text?

## Reporting

For each finding give the file and line, the concrete failure ("a member of org
B calling `thing.get` with an org A id receives the row"), and the fix. If a
finding is a convention slip with no reachable failure, say so rather than
inflating it.
