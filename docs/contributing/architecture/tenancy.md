# Tenancy

Every domain row belongs to one organization. `orgId` is `NOT NULL`; `userId`
records attribution, not scope.

## Request flow

```text
/:orgSlug/... page
        ↓ route parameter
procedure input { orgSlug, ...domainInput }
        ↓ parsed untrusted claim
orgProcedure(permission, orgInput...)
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
resolved session, and give the request one membership map. `orgProcedure(permission, input)`
parses the explicit slug claim, then its internal guard proves membership in a
single indexed join. The guard resolves each (caller, slug) pair once per
request and shares it with the other calls in that request; nothing is kept
after the request, so removal takes effect on the next one. The permission is a
required constructor argument and the raw builder is not exported, so an org
procedure cannot omit the guard.

The internal guard treats `orgSlug` as an unverified claim, checks membership
and roles, and exposes verified `context.scope`.
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

Writes that reference other rows (`patientId`, `catalogItemId`, …) verify each
id under the same predicate before writing — a foreign-key constraint alone
proves existence, not tenancy, and the browser's pickers prove nothing at all.
These checks stay server-side no matter what the UI sent; the sanctioned ways
to remove their _cost_ (folding the check into the write, composite
`(org_id, id)` FKs) are recorded in
[0019](../decisions/0019-server-verified-references-and-prices.md).

## Web client

Org pages live under `apps/web/src/routes/$orgSlug/` and import the
singleton `orpc` utilities from `@/lib/orpc`. Every org call passes the route
`orgSlug` as procedure input. The input becomes part of the generated query key,
so the shared QueryClient cannot reuse another tenant's data.

The layout server-renders (`ssr: true`, [ADR 0021](../decisions/0021-server-rendered-org-pages.md)).
Its loader fetches `member.me` through the in-process client with
request-local context. The procedure proves the session and membership, so
`UNAUTHORIZED` redirects to `/login`; callers without organization access choose
or join one at `/join`. The same
response supplies the roles, identity, organization list, and timezone used by
the shell and child routes.

A server render always reaches the server, because its query cache lives for one
request. A client-side navigation may reuse a membership result up to the 60 s
app-default `staleTime`, so the shell and its role-derived navigation can lag a
removed member by that much. This does not extend to data: every procedure call
proves membership server-side on every request, so a removed member gets
`FORBIDDEN` on the first query or mutation.

Child routes do not depend on the organization list — they scope by the URL
slug, and the server proves membership for every request.

## Adding a domain

1. Add `orgId NOT NULL` and a tenant-leading index.
2. Generate the migration with `bun run db:generate`.
3. Add grants in `packages/auth/src/access.ts`.
4. Declare the procedure with `orgProcedure(permission, orgInput.extend(...))`.
5. Predicate every query with `context.scope.orgId`.
6. Put the page under `routes/$orgSlug/`, import `orpc`, and include
   `orgSlug` in every query, mutation, direct call, and tenant-specific
   invalidation key.
7. Add every new procedure to `GUARDED_CALLS` in
   `tests/integration/tenancy.test.ts` — that table is compared against
   `appRouter`, and three sweeps reuse it to prove a missing claim, a foreign
   claim, and a revoked membership. Then write the one case the sweeps cannot:
   that the domain's own rows are invisible from another org. Do not restate the
   swept questions per domain; see
   [testing principles](../testing-principles.md).
