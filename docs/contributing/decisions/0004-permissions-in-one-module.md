# 0004: Permissions live in one dependency-free module

- **Status:** accepted
- **Date:** 2026-08-05

## Context

Permission definitions are needed in three places: Better Auth's organization
plugin configuration, the oRPC guard that enforces them, and the client that
hides controls a member cannot use. The natural drift is a server-side
definition plus a client-side copy that answers "can this user see the delete
button" — two sources of truth for one question.

Roles also invite inheritance: `admin` is `member` plus more, `owner` is `admin`
plus more. Expressed as inheritance, reading a role's actual surface means
walking a chain.

## Decision

`packages/auth/src/access.ts` is the only place permissions are defined. It
stays **dependency-free** — no database, no environment — so the server and the
client import the same module.

Each role spreads the Better Auth defaults and then states this app's grants
**explicitly**, rather than inheriting from a lesser role.

## Consequences

The client can import the module without pulling Node-only code into the bundle,
which is what keeps a second definition from ever being needed. `AppPermission`
is derived from the statement set, so a typo in a guard is a compile error.

`owner` and `admin` are nearly identical blocks. That duplication is deliberate:
a reader sees a role's full surface in one place, and adding a grant to one role
cannot silently widen another.

The constraint to protect is the dependency-free property. A permission decision
that needs a database read (per-resource ACLs, ownership checks) does not belong
in this module — it belongs in the handler, after the guard has established
scope.
