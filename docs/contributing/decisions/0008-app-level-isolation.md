# 0008: Tenant isolation is enforced in application code, not row-level security

- **Status:** accepted
- **Date:** 2026-08-05

## Context

PostgreSQL row-level security can enforce tenant isolation in the database, so a
query missing its `WHERE org_id = ...` returns nothing rather than another
tenant's rows. That is a genuinely stronger backstop than a convention.

It also requires every connection to carry the tenant as a session variable set
before each query and reset after — awkward with a pooled Drizzle client and the
in-process router used by SSR and tests. It requires a policy per table, kept in
step with the schema by hand. And it moves the decision away from the one place
that already makes it: `requirePermission`, which must run regardless because it
proves membership and checks the grant.

## Decision

Isolation is enforced in application code. Every org-scoped query carries
`eq(table.orgId, scope.orgId)`, and `scope` comes only from
`requirePermission`. RLS is not used.

## Consequences

One enforcement point that every entry point shares — HTTP, SSR, and tests all
build the same context and pass through the same guard — so what the tests
exercise is what production runs.

The cost is that the tenant predicate is a discipline rather than a mechanism. A
handler that forgets it leaks. That is why:

- `requirePermission` hands over `scope` and handlers never re-derive an org;
- `tests/integration/tenancy.test.ts` is a standing guardrail every new domain
  extends;
- object keys are org-prefixed so storage has an independent check
  (`assertKeyInScope`) that does not depend on a query predicate.

Revisit if the domain becomes regulated enough to need defence in depth at the
database, or if a leak ever ships. RLS would then be added **beneath** the
application check, not instead of it — the guard still has to run to prove
membership.
