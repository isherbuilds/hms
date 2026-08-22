# 0021: Org-scoped pages are server-rendered

- **Status:** accepted; supersedes [0003](./0003-client-rendered-org-pages.md)
- **Date:** 2026-08-17

## Context

The organization slug is part of every org URL, so the server can prove the
same tenant claim as the browser. The client-rendered layout in 0003 still made
the browser wait for session, organization, and page-data requests after
hydration.

## Decision

Org routes use full SSR. The `/$orgSlug` loader fetches `member.me`
through the request-local oRPC client. That request proves the session and
membership, returns the shell data plus organization timezone and currency, and redirects
signed-out or removed members before the page renders. A server render always
reaches the server, because its query cache is request-local. A client-side
navigation may instead reuse a cached result up to the 60 s app-default
`staleTime`. The timezone read bypasses the process-local settings cache so a
change is visible across split web and API processes. Child loaders prefetch
independent page queries in parallel with TanStack Query.

Base UI popups stay behind TanStack Router's `ClientOnly`. The installed Base UI
popup store resolves a second React instance during SSR and otherwise makes
React abandon that server-rendered subtree. The sidebar uses a width-reserving
plain-element fallback.

The router keeps the current route visible for the first 800 ms of a pending
navigation. Past that it shows a neutral pending layout for at least 400 ms, so
a slow load gives feedback without flicker. Hover-preloaded navigations rarely
reach the threshold.

The web process runs the same server-only auth and database modules as the API
process. It receives the complete server environment at runtime. Split web and
API hosts also set Better Auth's shared cookie domain so the web request carries
the session cookie used by SSR.

## Consequences

Prefetched data ships with the initial document instead of waiting for browser
RPC calls. Server-side query caches stay request-local. In the browser, the
shell's membership proof can persist for up to 60 s, so a removed member may
keep seeing the shell and its role-derived navigation for that long. Data stays
protected: every procedure call proves membership server-side on every request,
so the same member gets `FORBIDDEN` on every query and mutation immediately.

Server-rendered dates use the organization's timezone and an explicit locale so
server and browser output match. `/create` and `/join` remain client-rendered
because their creation, invitation, and session flows use the Better Auth
client. `/$orgSlug/onboarding` is an ordinary server-rendered org child.

A missing required web variable fails startup. A wrong database or cookie domain
can look like a signed-out session, so deployment verification must refresh a
signed-in org URL on the deployed web host.

No automated check covers the render itself. Release verification is manual:
build and serve the web app, load representative org routes signed in, and
reject any `<!--$!-->` marker in their HTML, because that marker means a server
render threw. The same pass confirms that server secrets and database code are
absent from the built client assets. See
[deployment](../deployment.md#release-verification).
