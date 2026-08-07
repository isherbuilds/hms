# 0013: Sign-up is disabled; accounts are created by an operator

- **Status:** accepted
- **Date:** 2026-08-07
- **Supersedes:** [0007](./0007-invite-only-signup.md)

## Context

The invite-only gate in ADR 0007 decided "first user" with a check-then-create
against an empty `user` table. Two concurrent requests could both pass the
check, and the "first account" race made a claim (exactly one bootstrap
account) that the database alone could not enforce. Worse, the gate lived in a
database hook that any future operator-created account would also have to
clear.

This repo's deployments are closed systems: the operator is the only person
who ever creates an account. An invitation grants _organization membership_,
not the ability to register.

## Decision

The public sign-up endpoint is disabled (`emailAndPassword.disableSignUp`).
Accounts are created directly in the database with
`createUserWithPassword` (`packages/auth/src/manual-user.ts`), which hashes
the password with Better Auth's own algorithm and writes the same `user` +
`credential` `account` rows the sign-up endpoint would have written — so the
account is indistinguishable from a registered one and `signIn.email` accepts
it unchanged. The operator CLI is `bun run create-user <email>
<name> <password>`.

Accounts get `emailVerified: true` at creation, so a future Google sign-in
with the same address links to the account (Better Auth links OAuth logins to
an existing user by verified email; a manually inserted user without
`emailVerified` fails with `account_not_linked`).

## Consequences

- There is no bootstrap race: nothing checks an empty `user` table anywhere.
- Login is unchanged; only registration is closed. The sign-up UI on
  `/login` is gone.
- Tests mint users through `createUserWithPassword` instead of
  `auth.api.signUpEmail`.
- If Google OAuth is ever configured, set `disableImplicitSignUp: true` on
  the provider so strangers cannot self-register through it while existing
  operator-created accounts still sign in and link.
- Do not re-open sign-up. A public registration path is a different product
  decision requiring a personal-org model.
