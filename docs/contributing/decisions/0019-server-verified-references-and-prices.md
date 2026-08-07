# 0019: Client input is a claim — references and prices are server-verified

- **Status:** accepted
- **Date:** 2026-08-07

## Context

Every mutation that accepts referenced ids (`patientId`, `practitionerId`,
`catalogItemId`, …) re-verifies each id under the tenant predicate before
writing, and money fields are never accepted from the client at all — charges
snapshot price and tax from the server-read catalog row. The question was
whether trusting the browser for these could drop queries and improve latency,
since the UI only ever offers ids from its own org-scoped pickers.

But "the client" is any holder of a valid session cookie, not our UI. A member
of one org can send another org's ids from curl; a tampered price would flow
into an immutable invoice. A single-column foreign key proves existence, not
tenancy. And the checks being skipped are indexed `(org_id, id)` lookups —
`visit.create` resolves patient, practitioner, and department in one parallel
round trip — while request latency is dominated by network, the membership
guard, and transactions. The trade on offer was a sub-millisecond saving
against a cross-tenant write or a zero-rupee consultation.

## Decision

Client-supplied references and amounts are never trusted. Referenced ids are
verified against `context.scope.orgId` on every write; prices and tax rates
always come from rows the server reads itself. Performance work targets the
**cost** of verification, never its existence.

## Consequences

Handlers stay uniform and the tenancy tests keep meaning something. When a
profiled hotspot appears, the sanctioned moves, in order:

1. **Fold the check into the write.** `INSERT … SELECT` carrying the tenant
   predicates: zero extra statements, empty result → `NOT_FOUND`. The
   insert-shaped sibling of the existing scoped-`UPDATE` rule.
2. **Constraint-level tenancy proof.** `UNIQUE (org_id, id)` on parents plus
   composite FKs `(org_id, ref_id)` make a cross-tenant reference impossible in
   the database, letting handlers drop pre-checks and map the violation.
   Adopting this needs its own record: it revises "FKs never prove tenancy",
   which is true only of single-column FKs.
3. **Cache our own server, not the client's claims.** In-process TTL caches for
   reference data per [0016](./0016-settings-ttl-cache.md) — except price
   reads, which stay fresh: a stale price frozen into a charge snapshot is a
   money bug, not a latency win.
4. **Perceived speed belongs to the web client.** Optimistic updates, query
   cache, prefetch — not removed server checks.

Revisit when profiling a real front-desk day after Slice 6 billing shows
verification queries as a measurable share of request time.
