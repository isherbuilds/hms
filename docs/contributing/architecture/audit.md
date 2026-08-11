# Audit

`audit()` in `packages/api/src/audit.ts` writes one row to `audit_log` and
**does not await it**. It can never slow a response down or turn a successful
mutation into a 500; a failed write is logged to the console.

```ts
audit({
  action: "file.delete",
  actorId: context.scope.userId,
  orgId: context.scope.orgId,
  target: `file:${input.key}`,
});
```

| Field     | Meaning                                                   |
| --------- | --------------------------------------------------------- |
| `action`  | Dotted verb — `file.delete`, `rbac.permission`.           |
| `denied`  | `true` when recording a refusal rather than an action.    |
| `actorId` | Who. Attribution only; never a scope.                     |
| `orgId`   | The tenant the action happened in.                        |
| `target`  | Typed reference — `file:<key>`, `member:<id>`.            |
| `meta`    | JSON detail. Never a secret, a token, or a presigned URL. |

## Audit sensitive actions, not everything

An audit log that records every read is an audit log nobody reads, and it costs
a write on every request. Record:

- **Permission denials after membership is verified** — audited centrally in
  `orgProcedure`'s internal guard. Routers never repeat this. A foreign
  membership claim is rejected but cannot write into the claimed tenant's audit
  trail; record it in request/security logs instead.
- **Domain-specific denials the guard cannot see** — `assertKeyInScope` records
  a probe for another tenant's object key, because a request that is correctly
  authorized _and_ reaching for a foreign key is exactly what the trail is for.
- **Sensitive or destructive successes** — deletions, membership and role
  changes, invitations.

Do not audit reads, list calls, or ordinary creates and updates.

## When fire-and-forget is not enough

Compliance-critical domains — patient records, student data — may one day need
the entry to exist if and only if the mutation committed, by inserting into
`auditLog` **inside the mutation's transaction** instead of calling `audit()`.
That trades the latency guarantee for atomicity. **This trade is deliberately
not taken in v0** (user decision 2026-08-07, restated in the spec's Explicitly
Deferred list): every domain, including patients, uses fire-and-forget
`audit()` until a compliance requirement demands commit-atomic entries.

## Reading the log

`audit.list` is declared with
`orgProcedure({ audit: ["read"] }, orgInput.extend({ ... }))` — `admin` and
`owner` only — and is keyset-paginated on the insertion-ordered `id`.

## Testing it

Because the write is not awaited, an assertion immediately after the call races
it. Use `eventually` from `tests/support/client.ts` to assert an entry exists,
and `drainAuditWrites()` from `@hms/api/audit` before asserting one
does not — polling cannot prove an absence.
