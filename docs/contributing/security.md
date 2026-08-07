# Security

The overarching invariant is that **every read and write path is scoped to
exactly one organization, proven per request**. One tenant seeing another's row
is a bug of a different class from every other bug in this repository.

## Invariants (do not regress)

Read this list before touching auth, the procedure guards, routers, or storage.

1. **Every org-scoped query carries the tenant predicate.** `eq(table.orgId,
context.scope.orgId)` belongs in the `where` even when the query also filters
   by primary key — that is what turns a cross-tenant probe into a `NOT_FOUND`
   instead of a leak. This covers infrastructure tables (`audit_log`, `file`),
   not only domain tables.
2. **`userId` is attribution, never scope.** A `userId` column records who did
   something. It never authorizes anything, and a query filtered by `userId`
   alone is not scoped.
3. **The org is explicit procedure input and is proven per guarded request.**
   The `/org/:orgSlug` page parameter is passed as `input.orgSlug`. It is an
   unverified claim until `orgProcedure`'s internal guard resolves it to verified
   `context.scope`. Handlers never use the claim for authorization or SQL scope.
   There is no fallback to `session.activeOrganizationId`.
4. **Membership is resolved directly by every org procedure and is not cached
   across requests.** `orgProcedure` requires the permission and input schema as
   constructor arguments, and the raw builder is not exported. Removal is
   effective on the next request; a TTL would reopen the revocation window.
5. **Roles authorize as a union.** Use `parseRoles` / `authorize` from
   `@better-stack/auth/access`. Never `role.split(",")[0]`, and never silently
   downgrade an unrecognized role — `parseRoles` throws on purpose.
6. **Permissions live in `packages/auth/src/access.ts` only.** That module stays
   dependency-free (no db, no env) so the client and server share one definition.
   A second place that decides what a role may do is a second place to get it
   wrong.
7. **Client-side permission checks are cosmetic.** Hiding a button is a UX
   affordance. Every mutation is re-checked server-side by `orgProcedure`'s
   internal guard.
8. **Sign-up is disabled; accounts are created by an operator.** The public
   sign-up endpoint is closed (`emailAndPassword.disableSignUp`). Accounts are
   inserted directly through `createUserWithPassword`
   (`packages/auth/src/manual-user.ts`), which hashes with Better Auth's own
   algorithm. There is no bootstrap exemption, so there is nothing to race. Do
   not re-open sign-up; see [ADR 0013](./decisions/0013-signup-disabled.md).
9. **Stored objects are always private.** `@better-stack/storage` issues only
   short-lived presigned URLs. There is no unsigned read path and the bucket
   must never be anonymously readable. A "visibility" flag in the database with
   no storage-side counterpart is decoration: any bucket policy broad enough to
   serve public files also exposes every tenant's private ones.
10. **Object keys are org-prefixed and validated.** Keys are
    `<orgId>/<uuid>/<name>`, and `assertKeyInScope` rejects a foreign prefix
    _and audits the attempt_ before any database work. The audit record stores
    only a digest of the rejected key — the key is caller-controlled and could
    be a presigned URL, i.e. a live bearer credential. User-supplied names are
    sanitized to `[A-Za-z0-9._-]` so a key can never nest, traverse, or break
    URL building.
11. **The OpenAPI reference never mounts in production.** It publishes the whole
    API surface unauthenticated; it is a development affordance, gated on
    `NODE_ENV`.
12. **Org AI requests are authenticated and scoped before model execution.**
    The browser sends credentials plus `orgSlug`; `/ai` uses the same fresh
    membership and permission resolver as oRPC before incurring provider cost.
13. **No secrets or server-only modules in client assets.** See
    [environment variables](./environment-variables.md).

## Cookies and CORS

Session cookies are `httpOnly`, `secure`, `sameSite: "lax"`. CORS reflects
exactly `CORS_ORIGIN` with `credentials: true`. Browser org scope is typed RPC
input, so it requires no custom header.

## Threat notes

**Cross-tenant read via a guessed id.** Closed by invariant 1: the scoped
`where` turns a foreign id into `NOT_FOUND`, and the caller learns nothing about
whether the row exists.

**Cross-tenant reference in a write.** A member of one org submits another
org's `practitionerId` or `catalogItemId` in a mutation. Closed by invariant 1
applied to referenced rows: every write re-verifies each referenced id under
the tenant predicate (foreign id → `NOT_FOUND`), and money fields are never
client input — charges snapshot price and tax from the server-read catalog row
([0019](./decisions/0019-server-verified-references-and-prices.md)).

**Privilege retention after removal.** Closed by invariant 4: the next guarded
request re-reads `member` and finds nothing.

**Wrong-tenant writes from an integration.** An integration authenticates and
names its org in procedure input. Missing input fails validation; an org without
a matching membership is `FORBIDDEN`, never defaulted elsewhere. The permission
guard proves membership on every guarded request.

**Presigned-URL leakage.** Presigned URLs are short-lived (15 minutes) and
issued only after an authorization check. Treat the URL itself as a bearer
credential: never log one, never put one in an audit `meta` payload.
