# 0025: Root organization URLs reserve public and system slugs

- **Status:** accepted
- **Date:** 2026-08-21
- **Amends:** [0011](./0011-org-slug-as-request-claim.md)

## Context

ADR 0011 put the immutable organization slug in `/org/:orgSlug/...`. The extra
`/org` segment made every daily URL longer and no longer bought a routing or
authorization property. Moving organizations to `/:orgSlug/...` creates a new
constraint: an organization cannot claim a slug used by a public page such as
`login`, `join`, or `create`, or by a public/system root we reasonably expect to
add later.

The old `/onboarding` page also mixed two jobs: choosing or joining an
organization and configuring one. Those jobs now have distinct root and
organization-scoped destinations.

## Decision

Organization pages live at `/:orgSlug/...`; there is no `/org` compatibility
route. The authoritative Better Auth creation hook requires a URL-safe slug of
at least four characters and rejects the shared reserved-root set. The create
form imports the same policy for immediate feedback.

`/join` is the organization entry and invitation destination. Configuration for
an existing organization lives at `/:orgSlug/onboarding`. Neither route guesses
tenant scope.

The slug remains the untrusted request claim and remains immutable exactly as
ADR 0011 decided. Authorization still resolves it to `context.scope.orgId`
before any tenant SQL runs.

## Consequences

Daily URLs are concise and stable per tab. Adding a public root requires adding
its name to the reserved set before release. Because the product is still a
clean-cutover deployment, old `/org/...` and `/onboarding` URLs intentionally
receive no alias or redirect.
