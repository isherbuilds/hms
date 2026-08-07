# 0014: Only the founding email can create organizations

- **Status:** accepted
- **Date:** 2026-08-07

## Context

ADR 0013 closed account creation, but organization creation was still open:
Better Auth's `allowUserToCreateOrganization` defaults to `true` for any
signed-in user, so every operator-created account could create an organization
and become its owner without anyone's approval — and the onboarding UI offers
exactly that. A deployment's organizations should be exactly the ones the
operator made, not a byproduct of any account that can log in.

## Decision

Organization creation is restricted to a single operator account, identified
by `FOUNDING_EMAIL` (a required server env var): the gate
`allowUserToCreateOrganization` (`packages/auth/src/index.ts`) returns true
only when the signed-in user's email matches. No role grants it — `access.ts`
deliberately has no `organization: ["create"]` statement — so not even an
organization owner can create another.

`bun run create-founder <name> <password>` provisions the founding account
(`scripts/create-founder.ts`, idempotent). The seed script and the test
harness create organizations through Better Auth's **system path** (`userId`
with no session), which bypasses the gate by design; there is no other way an
org comes into existence.

## Consequences

- A signed-in non-founder gets `FORBIDDEN` +
  `YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION` from `/api/auth/*`; the
  onboarding form surfaces that.
- The gate is a single email comparison — no org-count query, no role lookup,
  no permission statement, so nothing to get wrong under load or race.
- `FOUNDING_EMAIL` is required at boot, so a deployment that cannot bootstrap
  fails loudly instead of silently granting org creation to every account.
- The founding account is privileged for the deployment's lifetime, not just
  until the first org exists. If org creation later needs to open up (for
  example to owners, or a managed provisioning flow), the change is confined
  to this gate and the ADR that governs it.
