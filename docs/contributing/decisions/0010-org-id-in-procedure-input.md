# 0010: Organization ID is procedure input

- **Status:** accepted; the identifier is superseded by [0011](./0011-org-slug-as-request-claim.md) — the claim travels as typed input as decided here, but names the org by slug rather than id
- **Date:** 2026-08-05
- **Supersedes:** RPC-path transport in [0001](./0001-org-as-request-claim.md)

## Context

The first URL-scoped implementation duplicated organization identity in page and
RPC paths. A fixed oRPC `RPCLink` then required separate org-less and org-bound
clients, route-context client injection, and a manual tenant prefix for TanStack
Query keys.

A custom header can keep one endpoint, but it hides request scope and oRPC client
context is excluded from generated query keys. A session active organization is
also unsuitable because selection must remain stable per tab.

## Decision

Browser pages keep `/org/:orgId/...`, but all procedures use one `/rpc` endpoint
and one oRPC client. Every org-scoped procedure includes `orgId` in parsed input,
then applies `requirePermission`. The guard treats it as an unverified claim,
checks fresh membership and roles, and adds verified `context.scope`.

Handlers use `context.scope.orgId` for authorization and SQL predicates. Query
and mutation inputs include the route org ID, which makes it part of generated
TanStack Query keys and tenant-specific invalidation keys.

## Consequences

Public, authenticated, and org-scoped procedures share one transport. There is
no org header, org-client factory, route-context RPC injection, or manual query
key prefix. Call sites repeat `orgId`, but that repetition keeps the boundary
visible, typed, testable, and cache-safe.

Missing required input fails validation. A foreign claim is `FORBIDDEN`; a
foreign row ID under a valid claim remains `NOT_FOUND` because every query also
carries the verified tenant predicate. Future API keys and OAuth grants should
bind to one org at issuance rather than accepting browser-style mutable scope.
