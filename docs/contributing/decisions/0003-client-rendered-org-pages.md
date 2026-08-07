# 0003: Org-scoped pages are client-rendered

- **Status:** accepted; the claim below is named `orgId` because
  [0011](./0011-org-slug-as-request-claim.md) had not yet replaced it with the
  slug. Read every `:orgId` / `$orgId` path here as `:orgSlug` / `$orgSlug` —
  the rendering decision is unchanged.
- **Date:** 2026-08-05

## Context

[0001](./0001-org-as-request-claim.md) originally carried the browser claim in
an `x-org-id` header sourced from per-tab `sessionStorage`. That transport made
the org invisible during SSR and forced every org-scoped page to render on the
client.

The replacement puts the org in `/org/:orgId/...`. The URL is per-tab,
shareable, visible to the server, and sufficient to make SSR possible.

## Decision

Org-scoped pages remain client-rendered by choice. `ssr: false` is set on
`apps/web/src/routes/org/$orgId/route.tsx`, which verifies the session and
creates the org-bound client on the client today.

## Consequences

Public and auth pages (`/`, `/login`, `/onboarding`) keep SSR. The signed-in app
is an all-day internal console whose first paint does not currently justify a
second server-side client path.

SSR is no longer blocked by tenant transport. Enabling it would require
per-request in-process context derived from the route match so the server-side
session check and org client receive the same `orgId`; revisit when an
org-scoped page has a concrete SSR need.
