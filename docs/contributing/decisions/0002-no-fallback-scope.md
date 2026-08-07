# 0002: No fallback tenant scope

- **Status:** accepted
- **Date:** 2026-08-05

## Context

When a request arrives with no org in the URL, or with an org the caller does
not belong to, there is an obvious convenience available: fall back to the
user's only org, or their most recently used one. Single-org customers are the
common case, and the fallback would make integrations work without explicit
URL scope.

The failure mode is asymmetric. A refused request is an error someone fixes in
minutes. A defaulted request is a write that silently lands in the wrong
customer's data, and it is discovered by that customer.

## Decision

There is no fallback scope. A request with no claim never reaches the
permission guard — `orgInput` requires `orgSlug`, so it fails schema validation
as `BAD_REQUEST`. A claim naming an org the caller has no `member` row in is
`FORBIDDEN`, and is deliberately _not_ written to that tenant's audit trail: an
outsider must not be able to inject rows into an org they do not belong to. Role
denials, which happen only after membership is proven, are audited. A single-org
user is treated exactly like a multi-org one.

This rule governs the oRPC surface. Better Auth's own organization endpoints are
mounted whole at `/api/auth/*` and _do_ fall back to
`session.activeOrganizationId` when no `organizationId` is passed. They enforce
the same permissions, so this is not a privilege bypass — but a membership
changed through them writes no audit row, unlike the equivalent `members.*`
procedure. Prefer `members.*`; if the direct surface ever needs to be part of a
supported flow, it needs `organizationHooks` audit writes first.

## Consequences

Every caller states its tenant, including one-org deployments and simple
scripts. That is a small, one-time cost paid at integration time.

The rule is testable in a way a fallback is not:
`tests/integration/tenancy.test.ts` asserts that an unclaimed request is
`BAD_REQUEST`, that _every_ procedure in the router is `FORBIDDEN` for a
foreign claim, and that nothing an outsider does lands in the tenant's audit
trail — much stronger than "the default was right this time".

Onboarding absorbs the ergonomic cost in the UI: a tab with no org selected is
redirected to `/onboarding` rather than being guessed for.

Nothing about this decision is worth revisiting for convenience. It would be
revisited only if the product stopped being multi-tenant.
