# 0007: Sign-up is invite-only with a first-account bootstrap

- **Status:** superseded by [0013](./0013-signup-disabled.md)
- **Date:** 2026-08-05

## Context

A B2B product's accounts belong to customer organizations. Open sign-up creates
accounts that belong to no org, which then need a home: either an implicit
personal org (a second tenancy model to maintain) or a limbo state every
org-scoped route has to handle.

A closed system still has to start somewhere. Seeding the first admin by SQL or
an environment variable means an extra deployment step and a credential that
exists outside the auth system.

## Decision

Accounts exist only by invitation, enforced in Better Auth's
`user.create.before` hook. The single exemption is the **first** account of a
fresh deployment, decided by an empty `user` table. That account bootstraps the
system and invites everyone else through **Members → Invite**.

## Consequences

There is exactly one privileged moment in a deployment's life, and it closes as
soon as the first account exists. No seed script, no bootstrap credential.

Every subsequent account arrives with a pending invitation, so a new user always
has an org to land in, and `/onboarding` has a real job.

Invitation delivery is on the critical path: `sendInvitationEmail` in
`packages/auth/src/index.ts` must be wired to a real provider before shipping.
Until then the link is logged **and** returned by `members.invite`, so the flow
is degraded but never silently broken.

Tests must mint users through an inviter — `tests/support/auth.ts` signs up a
bootstrap admin once and invites every subsequent test user into a holding org.

Do not add a second exemption. Self-serve sign-up would be a different product
decision requiring a personal-org model, and it would supersede this record.
