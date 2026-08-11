# Contributing to HMS

Documentation for people and agents **developing this repository**: setup, code
style, tests, and runtime architecture.

`bun run check-types && bun run check && bun run test` is the local gate.

## Setup and workflow

- [Project intent](./project-intent.md) — what this repo is and is not
- [Getting started](./getting-started.md)
- [Decision records](./decisions/index.md) — check before proposing something
  already decided
- [Environment variables](./environment-variables.md)
- [Deployment](./deployment.md) — two independent Dockerfiles, no production
  compose
- [Harness engineering](./harness-engineering.md) — how a change becomes a
  durable improvement instead of a one-off fix

## Code and tooling

- [Code style](./code-style.md)
- [Documentation principles](./documentation.md)

## Testing

- [Testing principles](./testing-principles.md)

## Security

- [Security](./security.md) — invariants future changes must not regress

## Architecture

- [Architecture overview](./architecture/index.md)
  - [Tenancy](./architecture/tenancy.md) — the org claim and the tenant predicate
  - [Authorization](./architecture/authorization.md) — roles, permissions, guards
  - [Request lifecycle](./architecture/request-lifecycle.md)
  - [Data storage](./architecture/data-storage.md)
  - [Audit](./architecture/audit.md)
  - [File storage](./architecture/file-storage.md)
  - [HMS domain layer](./architecture/domain-layer.md) — live relationships and
    front-desk boundary
  - [Accounting ledger](./architecture/accounting.md) — double-entry posting and
    statutory handover boundary

## Research

- [Research](../research/) — evidence and external reference analysis; not a
  statement of current behavior or an accepted decision

End-user product documentation lives in `apps/fumadocs`, not here.
