# 0011: The organization slug is the request claim

- **Status:** accepted; URL placement and creation validation amended by [0025](./0025-root-org-urls-reserve-system-slugs.md)
- **Date:** 2026-08-06
- **Supersedes:** the identifier choice in [0010](./0010-org-id-in-procedure-input.md)

## Context

[0010](./0010-org-id-in-procedure-input.md) settled that the tenant travels as
typed procedure input rather than a header or session state. It left the
identifier as the organization id, so pages read `/org/:orgId/...` and every
call carried a UUID.

Opaque ids are unreadable in a URL, unusable in support conversations, and
meaningless in a shared link. The obvious fix — slug in the URL, id on the wire
— means the org layout must resolve slug to id before any child can query, so
every org page waterfalls behind the organization list.

Keying authorization on the slug removes that waterfall, and `organization.slug`
already carries a unique index. But uniqueness is the wrong property: it holds
at an instant, not over time. Better Auth's `updateOrganization` accepts a new
slug and never reserves the vacated one, so `acme` could be renamed and then
claimed by a different tenant. Every stale link, bookmark, and in-flight retry
naming `acme` would silently begin operating on another customer — with every
membership check passing, because the claim would be honestly resolved to the
new owner.

## Decision

The slug is the tenant claim. `orgInput` is `{ orgSlug }`, pages are
`/org/:orgSlug/...`, and `authorizeOrg` resolves the slug and proves membership
in one indexed join.

This is conditional on the slug being immutable, so `packages/auth` rejects any
`updateOrganization` call that includes `slug`. The organization `name` stays
editable; it is display text and authorizes nothing.

`Scope` is unchanged. The join returns `organization.id`, and
`context.scope.orgId` remains the only tenant identifier handlers ever see —
every SQL predicate still reads `WHERE org_id = scope.orgId`. The claim is
untrusted input; the id is the proven value.

## Consequences

URLs are legible and the org layout's list fetch no longer gates child queries —
it only prevents a flash of 403s before a redirect, and can be dropped for a
faster first paint.

Resolution and membership in one statement means "no such org" and "not a
member" are indistinguishable to the caller: both are `FORBIDDEN`, so slugs
cannot be probed for existence despite being guessable. The membership lookup
stays one round trip and stays uncached, so revocation is still immediate.

The cost is that slugs are now permanent. A customer who rebrands keeps the old
slug in their URLs. Revisit only by adding a `reserved_slug` table that retains
every slug ever issued, so a rename can never hand an old link to a new tenant —
never by simply reopening `updateOrganization`.
