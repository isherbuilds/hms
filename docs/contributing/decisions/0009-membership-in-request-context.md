# 0009: Resolve membership in the permission factory

- **Status:** accepted; claim transport revised by [0010](./0010-org-id-in-procedure-input.md)
- **Date:** 2026-08-05

## Context

The request context must carry the authenticated session and raw headers for
Better Auth operations. It does not need to model authorization state: the org
claim is typed procedure input, and only the permission guard consumes it.

Keeping a request-local membership resolver on context added a factory and a
cache to every adapter even though the current transport executes one procedure
per request. It also made tests and framework hosts know about authorization
plumbing that belongs to the oRPC procedure factory.

## Decision

Framework adapters construct the shared `ORPCContext` with only `session` and
`headers`. The Hono adapter accepts a Hono context; the TanStack Start client
constructs its SSR context at the in-process router boundary. `requirePermission`
performs the indexed membership lookup directly, checks roles, audits denials
only after scope is verified, and exposes verified `scope`. SQL queries continue
to carry an explicit org predicate.

## Consequences

There is one membership lookup per guarded procedure and no lookup for public
procedures. Foreign claims and removed memberships are `FORBIDDEN`; missing
required input fails validation. Context construction has no audit side effects.
If RPC batching is introduced, repeated membership checks must be measured before
adding request-local memoization back behind the adapter boundary.
