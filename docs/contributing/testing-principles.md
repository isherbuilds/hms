# Testing principles

`bun run test` runs `tests/` with `bun:test` against a **real** PostgreSQL
(`packages/db/docker-compose.dev.yaml`). There is no mocked database: the things
worth testing here — tenant isolation, membership revocation, permission
denial — are exactly the things a fake would get wrong.

## Flavours

| Flavour               | Use when                                                                           |
| --------------------- | ---------------------------------------------------------------------------------- |
| `tests/unit/*`        | Pure logic with no I/O — `parseRoles`, `authorize`, key sanitizing.                |
| `tests/integration/*` | Anything touching the router, auth, or the database. The default for feature work. |

Integration tests call the router in-process via `clientFor` (`createRouterClient`),
so they exercise the real context, `orgProcedure`'s real internal guard, and the
real queries without an HTTP hop.

## Rules

- **Fewer, longer tests.** One test follows one workflow end to end, with as
  many assertions as the workflow needs. Do not split a flow into micro-tests to
  satisfy "one assertion per test".
- **Flat files.** Top-level `test(...)`; no `describe` nesting.
- **Inline setup.** The only shared hook is `beforeAll(resetTestDatabase)`, once
  per file. Tests within a file share the database and therefore mint their own
  users and orgs — never reach for `beforeEach` to hand them a shared one.
- **Factories, not globals.** `createTestUser`, `createOrganization`,
  `joinOrganization`, `setMemberRoles` return ready-to-use objects.
- **Do not test what the types guarantee.** No test should assert that a
  permission string is valid — `AppPermission` already fails the build.
- **Do not pin copy.** Assert the oRPC code (`expectORPCCode(..., "FORBIDDEN")`),
  not the message text.
- **Fire-and-forget needs `eventually`.** `audit()` is deliberately not awaited,
  so poll for the row rather than sleeping a fixed interval.
- **Keep the bar high.** Integration tests are slow. Add one when it can falsify
  a real invariant, not to raise a coverage number.

## The tenancy suite is a guardrail, not a feature test

`tests/integration/tenancy.test.ts` is where an isolation regression gets
caught. Every new org-scoped domain owes it the same four questions the existing
cases ask:

1. Is the data invisible from another org?
2. Is a request with **no** org claim BAD_REQUEST? (`orgInput` rejects it before
   the guard runs — it is a validation failure, not an authorization one.)
3. Is a request naming a **foreign** org FORBIDDEN?
4. Is a **removed** member FORBIDDEN on the very next request?

A new domain that only proves (1) has proven the easy half.

(2), (3) and (4) are enforced for you: `GUARDED_CALLS` in that file lists every
procedure with the tenant claim left as a parameter, and three sweeps reuse it —
missing claim, foreign claim, and revoked membership. The table is compared
against `appRouter`, so a new procedure that is not listed there fails the suite
rather than going silently uncovered. Adding your procedure to that one table is
all (2)–(4) cost you; (1) is still yours to write.
