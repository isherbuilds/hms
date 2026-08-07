# 0005: Audit is fire-and-forget by default

- **Status:** accepted
- **Date:** 2026-08-05

## Context

An audit write can be awaited inside the mutation's transaction, awaited outside
it, or not awaited at all. Awaiting inside gives atomicity — the entry exists if
and only if the action committed — at the cost of putting the audit table in the
critical path of every audited mutation, where a slow or failing insert turns a
successful action into a 500.

For an operational trail of "who deleted this file", that trade is wrong: losing
one entry to a transient database error is a much smaller harm than failing the
deletion. For a regulated trail — patient records, student data — it is exactly
right, and a missing entry is the compliance failure.

## Decision

`audit()` is fire-and-forget: one insert, never awaited, errors logged to the
console. It can never slow a response or turn one into a 500.

Compliance-critical domains opt out per domain by inserting into `auditLog`
inside the mutation's own transaction instead of calling `audit()`.

Coverage is deliberate rather than exhaustive: denials (centrally, in
`requirePermission`) and sensitive or destructive successes. Not reads, not
lists, not ordinary creates.

## Consequences

Audited mutations pay no latency. An entry can be lost to a transient failure;
that is accepted for the default trail and is why the escape hatch exists rather
than being a global setting.

Tests cannot assert the row immediately after the call — `eventually` in
`tests/support/client.ts` exists for this.

An audit log that recorded everything would cost a write per request and would
not be read. If the volume of audited actions ever makes the un-awaited insert
itself a load problem, the answer is batching, not awaiting.
