# 0001: The organization is a per-request claim, not session state

- **Status:** accepted; lookup placement clarified by [0009](./0009-membership-in-request-context.md), RPC transport superseded by [0010](./0010-org-id-in-procedure-input.md)
- **Date:** 2026-08-05

## Context

Better Auth's organization plugin offers `session.activeOrganizationId`: the
caller sets an active org, and subsequent requests operate in it. That makes the
tenant a property of the _session_ rather than of the _request_.

Two clients make that a poor fit. A browser user working in two customer orgs
wants two tabs, and a session-level active org gives them one. A bot or API
integration should not mutate session state before every call: under
concurrency, the ordering hazard between "switch" and "do the thing" can land a
write in the wrong customer's data. The tenant must instead be carried by each
request.

## Decision

The org is an explicit per-request claim. Its original `/org/:orgId/rpc/*`
transport replaced an earlier `x-org-id` header and is itself superseded by typed
procedure input in [0010](./0010-org-id-in-procedure-input.md).
`session.activeOrganizationId` is never consulted.

The claim remains private inside request context until `requirePermission`
resolves membership against the `member` table on that same request and exposes
the proven value as `context.scope.orgId`. The lookup is deliberately uncached
across requests.

## Consequences

Every org-scoped call names its org explicitly. Browser page links are org-bound
and naturally per-tab; integrations authenticate and provide the same claim as
typed procedure input.

The cost is one indexed `member` lookup per guarded request. That is the price
of immediate revocation: a cache TTL would reopen exactly the window this closes.
Revisit only if that lookup is measured as a bottleneck, and then by making
revocation explicitly invalidate the cache — never by adding a bare TTL.
