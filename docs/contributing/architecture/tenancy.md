# Tenancy

Every domain row belongs to one organization. `orgId` is `NOT NULL`; `userId`
records attribution, not scope.

## Request flow

```text
/org/:orgSlug/... page
        ↓ route parameter
procedure input { orgSlug, ...domainInput }
        ↓ parsed untrusted claim
requirePermission
        ↓ indexed slug + member join, role check
{ scope: { orgId, userId } }
        ↓ handler query
WHERE table.org_id = scope.orgId
```

The tenant is named by **slug** on the way in and by **id** everywhere after.
The slug is the unverified claim; `context.scope.orgId` is the proven value and
the only identifier handlers ever see. Slugs are immutable — `packages/auth`
rejects `updateOrganization` calls that include one — which is what makes them
safe to authorize against ([0011](../decisions/0011-org-slug-as-request-claim.md)).

The page URL makes organization selection visible, legible, and per-tab. RPC
uses one `/rpc` endpoint and one client. Organization procedures include
`orgSlug` in typed input, so generated TanStack Query keys naturally differ by
tenant. The session's `activeOrganizationId` is not used.

Framework adapters build the small oRPC context from request headers and the
resolved session. `requirePermission` resolves the slug and proves membership in
a single indexed join. Public procedures do no membership work, and membership
is uncached so removal takes effect on the next guarded request.

`requirePermission` receives parsed input, treats `orgSlug` as an unverified
claim, checks membership and roles, and exposes verified `context.scope`.
Handlers may receive the input claim but never use it for authorization or SQL
scope. A foreign membership, a missing permission, and an org that does not
exist are all `FORBIDDEN` — resolving and proving in one statement is what keeps
them indistinguishable, so slugs cannot be probed. A missing session is
`UNAUTHORIZED`. Missing required input fails schema validation. There is no
fallback organization.

## Query isolation

Every read and write carries the verified tenant predicate, including primary-key
lookups:

```ts
.where(and(eq(file.id, input.id), eq(file.orgId, context.scope.orgId)))
```

That turns a foreign ID into `NOT_FOUND`. Infrastructure rows such as files and
audit entries follow the same rule. Mutations use one scoped
`UPDATE`/`DELETE ... RETURNING`, not select-then-write.

## Web client

Org pages live under `apps/web/src/routes/org/$orgSlug/` and import the
singleton `orpc` utilities from `@/lib/orpc`. Every org call passes the route
`orgSlug` as procedure input. The input becomes part of the generated query key,
so the shared QueryClient cannot reuse another tenant's data.

The layout remains client-rendered (`ssr: false`) because session and
organization-list checks are client-side today. RPC transport does not depend on
that choice: SSR uses the same router through an in-process client with
request-local context.

Child routes do not depend on the organization list — they scope by the URL
slug, and the server proves membership on every call. The layout's wait on that
list only prevents a flash of 403s before a redirect, so it can be dropped for a
faster first paint.

## Adding a domain

1. Add `orgId NOT NULL` and a tenant-leading index.
2. Generate the migration with `bun run db:generate`.
3. Add grants in `packages/auth/src/access.ts`.
4. Extend `orgInput`, then apply `requirePermission` after `.input(...)`.
5. Predicate every query with `context.scope.orgId`.
6. Put the page under `routes/org/$orgSlug/`, import `orpc`, and include
   `orgSlug` in every query, mutation, direct call, and tenant-specific
   invalidation key.
7. Extend `tests/integration/tenancy.test.ts` for foreign membership, cross-org
   IDs, same-client concurrent orgs, and immediate revocation.
