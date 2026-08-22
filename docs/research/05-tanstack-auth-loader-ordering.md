# TanStack auth and loader ordering

## Question

Should authentication and organization-membership checks finish in a parent route's `beforeLoad`
before any child data starts, or should the parent membership loader and child data loaders run in
parallel?

## Answer

Keep the current split. **Every private server operation must authenticate the session, prove current
organization membership, and check its permission before its handler reads data. The browser or router
does not need one global membership request to finish before it starts child loaders.** TanStack calls
that server handler/API boundary the security boundary; it calls `beforeLoad` a route and UI gate
([TanStack Start, “Protect Data First”](https://tanstack.com/start/latest/docs/framework/react/guide/authentication-server-primitives#protect-data-first),
[TanStack Router, “Authenticated Routes”](https://tanstack.com/router/latest/docs/framework/react/guide/authenticated-routes)).

For this repository, keep the remote `member.me` check in the `/$orgSlug` parent `loader`. Let it
run in parallel with child loaders. Each child oRPC call independently runs the authoritative server
guard before its own tenant-scoped query. Moving the same remote check to parent `beforeLoad` would add
a serial network/database step to every valid navigation, but it could not replace any endpoint guard
([ADR 0021](../contributing/decisions/0021-server-rendered-org-pages.md#L13-L21),
[`orgProcedure`](../../packages/api/src/lib/procedures/factory.ts#L80-L93)).

Use parent `beforeLoad` only for a route-level UX decision that is already cheap or locally known, such
as redirecting from an already-resolved signed-out state. Use it for a remote membership call only if
measurement shows that avoiding unauthorized descendant requests is worth a waterfall for authorized
users. It must never become the only membership or permission check
([TanStack Router, `beforeLoad`](https://tanstack.com/router/latest/docs/framework/react/guide/authenticated-routes#the-routebeforeload-option)).

**On middleware ordering.** TanStack Start's global request middleware does run before route loaders
for a server-rendered request: it wraps every request Start handles, SSR included
([TanStack Start, “Global Request Middleware”](https://tanstack.com/start/latest/docs/framework/react/guide/middleware#global-request-middleware)).
That does not make it the place for this app's membership check, for three reasons: client-side
navigation issues no SSR document request, so request middleware never runs for it; this app's data
boundary is a separate Hono host at `/rpc`, which Start middleware cannot wrap; and `apps/web` has no
`src/start.ts`, so no global request middleware exists today. The per-request equivalent that does
exist is the oRPC context factory (session) plus `orgProcedure` (membership and permission).

## Evidence

### TanStack Router and Start

- The repository resolves `@tanstack/react-router` 1.170.29, whose installed dependency is
  `@tanstack/router-core` 1.171.24, and `@tanstack/react-start` 1.168.46
  ([`bun.lock`](../../bun.lock#L951-L957)).
- The current Router v1 data-loading guide defines a serial route pre-load phase containing
  `beforeLoad`, followed by a parallel phase containing route component preloads and route loaders.
  It also states that per-route async requirements should start as early as possible in parallel
  ([TanStack Router, “The route loading lifecycle”](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading#the-route-loading-lifecycle)).
- Parent `beforeLoad` hooks run before child `beforeLoad` hooks. A thrown error stops all descendants
  from loading. TanStack describes this as middleware for the route and its children
  ([TanStack Router, “The route.beforeLoad Option”](https://tanstack.com/router/latest/docs/framework/react/guide/authenticated-routes#the-routebeforeload-option)).
- The same Router guide explicitly says that a route guard is not a data-authorization boundary.
  A server function, server route, or API endpoint must authorize itself because callers can reach it
  without the route
  ([TanStack Router, “Authenticated Routes”](https://tanstack.com/router/latest/docs/framework/react/guide/authenticated-routes)).
- TanStack also says `beforeLoad` is useful when the product wants to avoid starting requests that
  will fail. That is a route-UX and wasted-work tradeoff, not permission to weaken endpoint checks
  ([TanStack Start, “Authentication”](https://tanstack.com/start/latest/docs/framework/react/guide/authentication)).
- The Start server-authentication guide says to protect data first. It requires every private server
  operation to authorize before it returns data or mutates state. Its middleware example centralizes
  session lookup, but every protected server function still attaches that middleware
  ([TanStack Start, “Protect Data First” and “Session Lookup as Middleware”](https://tanstack.com/start/latest/docs/framework/react/guide/authentication-server-primitives#protect-data-first)).

### HMS architecture and implementation

- The accepted SSR decision deliberately makes the parent loader force-fetch `member.me` while child
  loaders prefetch independent page queries in parallel. It identifies the parent call as the shell
  membership proof and redirect source, not as authorization inherited by child endpoints
  ([ADR 0021](../contributing/decisions/0021-server-rendered-org-pages.md#L13-L21)).
- The parent route implements that decision with `loader`, `fetchQuery`, and explicit `UNAUTHORIZED`
  and `FORBIDDEN` redirects. Its comment states that loader placement keeps the membership call
  parallel with child loaders
  ([`apps/web/src/routes/$orgSlug/route.tsx`](../../apps/web/src/routes/$orgSlug/route.tsx#L7-L27)).
- Existing `beforeLoad` prior art is the standalone `/create` and `/join` routes. They perform session
  redirects for entry-flow UX; neither authorizes org data nor replaces `orgProcedure`
  ([create](../../apps/web/src/routes/create.tsx), [join](../../apps/web/src/routes/join.tsx)).
- Child routes do start their independent data prefetches in loaders. The dashboard starts three page
  queries together with `Promise.all`
  ([`dashboard.tsx`](../../apps/web/src/routes/$orgSlug/dashboard.tsx#L19-L30)).
- Both RPC transports resolve the Better Auth session before a procedure runs, and both build that
  context once per request. The Hono adapter delegates to `createRequestContext`
  ([`packages/api/src/lib/context.ts`](../../packages/api/src/lib/context.ts)); the SSR in-process
  client calls the same factory with the current request headers
  ([`apps/web/src/lib/orpc.ts`](../../apps/web/src/lib/orpc.ts)). The architecture keeps framework
  context limited to request dependencies and derives authorization state inside the procedure guard
  ([request lifecycle](../contributing/architecture/request-lifecycle.md)).
- `authorizeOrg` rejects a missing session, resolves membership from the organization slug and user
  ID, checks the required role grant, and only then returns verified scope
  ([`factory.ts`](../../packages/api/src/lib/procedures/factory.ts)). It reads that membership row
  through the request's memo, so the join happens once per request per claimed org rather than once
  per call; the permission check runs on every call. `orgProcedure` runs the function before `next`,
  so the handler cannot execute first.
- The raw procedure builder is not exported. Every supported oRPC procedure must declare its
  permission and org-bearing input through `orgProcedure`; an unguarded org endpoint is therefore not
  representable through the supported API
  ([ADR 0015](../contributing/decisions/0015-org-procedure-only.md#L14-L34)).
- The project architecture says client-side access checks are cosmetic. Every server mutation is
  checked again by `orgProcedure`
  ([authorization architecture](../contributing/architecture/authorization.md#L101-L105)).

### Where middleware fits, and where it does not

- Start's global request middleware runs for “every request, including server routes, SSR and server
  functions”, and TanStack lists authentication and authorization as its use cases
  ([TanStack Start, Middleware](https://tanstack.com/start/latest/docs/framework/react/guide/middleware#global-middleware)).
  Its own auth guidance still puts the authorization decision on the endpoint that touches private
  data ([Protect Data First](https://tanstack.com/start/latest/docs/framework/react/guide/authentication-server-primitives#protect-data-first)).
- `apps/web` has no `src/start.ts` and registers no `requestMiddleware`, so Start global middleware is
  not part of this app's request path (verified by absence: only `apps/web/vite.config.ts`,
  `src/router.tsx`, and `server/plugins/evlog-drain.ts` exist for host wiring).
- The browser calls `${VITE_SERVER_URL}/rpc` on the Hono host
  ([`orpc.ts`](../../apps/web/src/lib/orpc.ts#L23-L30)), and that host resolves the session per HTTP
  request before handing off to oRPC
  ([`apps/server/src/index.ts`](../../apps/server/src/index.ts#L90-L102)). Start middleware in the web
  process cannot see those requests, so it could gate SSR only — half the traffic.
- Measured oRPC semantics: the `createRouterClient` context factory runs once **per procedure call**,
  not once per request. A three-call script invoked the factory three times
  (`bun -e` against `apps/web/node_modules/@orpc/server` 1.14.14). **Before** the per-request
  context, one SSR document that fans out to a parent membership call plus three dashboard prefetches
  ([`dashboard.tsx`](../../apps/web/src/routes/$orgSlug/dashboard.tsx#L19-L30)) resolved the
  session four times and ran the membership join four times. Session resolution is cheap because
  Better Auth `cookieCache` is enabled
  ([`packages/auth/src/index.ts`](../../packages/auth/src/index.ts#L35-L40)); those four membership
  joins were real queries.
- **After**: oRPC still calls the factory per procedure call, so the fix sits above it. The SSR
  client builds one `createRequestContext` per document request and passes the same object to every
  call ([`orpc.ts`](../../apps/web/src/lib/orpc.ts)), and the guard memoizes each membership row in
  that context's map keyed by caller and claimed slug
  ([`context.ts`](../../packages/api/src/lib/context.ts)). The same fan-out now costs one session
  resolution and one join per claimed org per request. Membership is still never cached across
  requests: the map is created per request and never outlives it, so a revoked member is rejected on
  the next request.

### Measured: what the per-request context actually buys

Method. `bun run db:seed -- --reset` supplies the baseline dataset (3 users, 2 organizations, 4
`member` rows, 1 invitation, 1 settings row — no patients, OPD encounters, or invoices). Production builds
of both hosts, API on `:3100` and web on `:3101`, `NODE_ENV=production`, Postgres 18.4 in Docker on
`localhost:55442`. Statements were counted with `log_statement='all'` on the database, bracketed
between two marker queries so the window covers exactly one HTTP request; the setting was reset
afterwards. Signed in as `owner@example.com`. The A/B toggles only the memo lookup in
`resolveMembership`; everything else is byte-identical.

**Statements per authenticated SSR document, `/mercy-general/dashboard`:**

|          | membership joins | total statements |
| -------- | ---------------- | ---------------- |
| memo off | 4                | 11               |
| memo on  | **1**            | **8**            |

`/mercy-general/settings/members`: 2 joins → 1, 6 statements → 5. The membership join count is
exact — the joins are identified by their SQL text. Zero session lookups reach the database in either
state: Better Auth's `cookieCache` answers from the signed cookie.

**Cost of one membership join** (2 000 executions through the app's own pool, warm): mean 0.431 ms,
p50 0.396 ms, p95 0.624 ms, p99 1.014 ms.

**Sequential latency, TTFB, n = 40 per state.** Dashboard p50 13.3 ms / p95 19.4 ms with the memo,
12.6 / 17.6 without. `settings/members` 10.0 / 14.1 with, 9.6 / 12.2 without. **No improvement is
visible at concurrency 1**, and that is the expected result: three saved joins are ~1.2 ms against a
local socket, inside the run-to-run noise of a ~13 ms render.

**Under concurrency the saving does appear.** Three interleaved rounds per state, 300 requests each,
medians of the three rounds:

| concurrency | requests/s off → on      | p50 ms off → on          | p95 ms off → on          | rounds where on wins |
| ----------- | ------------------------ | ------------------------ | ------------------------ | -------------------- |
| 1           | 77.1 → 88.0              | 12.4 → 11.3              | 19.3 → 17.3              | 1 of 3               |
| 30          | 152.0 → **211.3** (+39%) | 189.5 → **136.3** (−28%) | 229.1 → **177.0** (−23%) | 3 of 3               |

**Browser metrics, production build, headless Chromium, 1440×900, median of 3–6 loads** (memo on).
These measurements predate the 2026-08-21 clean cutover; the historical `/front-desk/queue` label
below is now `/$orgSlug/opd`, and the historical `visit.queue` procedure is now `opd.queue`:

| page                | TTFB    | FCP    | DOMContentLoaded | load     | document | resources    | post-hydration RPC calls |
| ------------------- | ------- | ------ | ---------------- | -------- | -------- | ------------ | ------------------------ |
| `/dashboard`        | 35.5 ms | 128 ms | 61.4 ms          | 97.7 ms  | 22.5 kB  | 41 (48.5 kB) | **0**                    |
| `/settings/members` | 32.3 ms | 124 ms | 67.3 ms          | 101.7 ms | 24.6 kB  | 47 (57.3 kB) | **0**                    |
| `/front-desk/queue` | 21.2 ms | 104 ms | 46.3 ms          | 76.2 ms  | —        | —            | **0**                    |

FCP with the memo off measured 116 ms on the same page — unchanged within noise, as expected: the memo
removes server work, and TTFB is only ~30 ms of a ~120 ms FCP.

Zero post-hydration RPC calls confirms ADR 0021 empirically: the SSR document carries its data, and
the browser issues no follow-up procedure call to render the first screen.

**Client-side navigation from a loaded dashboard** (median of 4): route commits in 36–43 ms.
`/front-desk/queue` issues 2 procedure calls (`staff.listDepartments`, `staff.listPractitioners`),
`/billing` issues 1 (`visit.queue`), `/reports` issues none — the rest is served from the QueryClient
cache seeded during SSR.

What this does and does not establish. The statement counts are exact and data-independent: they are
a property of the guard, not of the dataset. The latency numbers are a floor, not a forecast — a
local Docker socket makes a query round trip ~0.4 ms, where a managed Postgres in the same region is
typically several times that. [INFERENCE] On a 2 ms round trip the same three saved joins are worth
~6 ms per SSR document, and the effect scales with the number of org procedures a page fans out to.
The seed carries no clinical rows, so absolute render times will grow with real data while the saved
query count stays the same. The concurrency-30 result is the honest headline: fewer queries per
request means each request holds its pooled connection for less time, which is where throughput comes
from.

### Reference: openstory-so/openstory

A public TanStack Start app (146 stars, `main` observed 2026-08-18) that splits the layers the same
way:

- Its `src/start.ts` registers only logging in `functionMiddleware`. Authentication is **not** global
  middleware
  ([src/start.ts](https://github.com/openstory-so/openstory/blob/main/src/start.ts)).
- Authorization is per-endpoint middleware: `authMiddleware` (session), `authWithTeamMiddleware`
  (session + resolved team + compliance state), and resource guards such as
  `sequenceAccessMiddleware`, which loads the row through the tenant-scoped client and 404s when it is
  not in scope
  ([src/functions/middleware.ts](https://github.com/openstory-so/openstory/blob/main/src/functions/middleware.ts)).
- Public HTTP endpoints attach the request-scoped variant explicitly and read only through
  `context.scopedDb`
  ([src/routes/api/v1/sequences.ts](https://github.com/openstory-so/openstory/blob/main/src/routes/api/v1/sequences.ts)).
- Tenancy is structural: `createScopedDb(teamId, userId)` auto-injects the predicate, and the module
  states that only it and the auth config may import `getDb`
  ([src/lib/db/scoped.ts](https://github.com/openstory-so/openstory/blob/main/src/lib/db/scoped.ts)).
  A code search for `getDb` finds it outside that module only in db clients, auth config, cron jobs,
  pricing refresh, and tests — no user-request path bypasses the scoped client.
- Route `beforeLoad` is UX only: `_app/route.tsx` seeds the session into the QueryClient and admits
  anonymous visitors; account-bound routes call `requireSessionOrRedirect` in their own `beforeLoad`
  ([_app/route.tsx](https://github.com/openstory-so/openstory/blob/main/src/routes/_app/route.tsx),
  [route-guards.ts](https://github.com/openstory-so/openstory/blob/main/src/lib/auth/route-guards.ts)).
  The guard is cheap because the session query has a five-minute `staleTime`
  ([session-query.ts](https://github.com/openstory-so/openstory/blob/main/src/lib/auth/session-query.ts)).

## What this proves / does not prove

This proves the required ordering at the security boundary: for each private oRPC call, session,
membership, and permission checks finish before that call's handler can read tenant data. It also proves
that TanStack intentionally serializes `beforeLoad` ahead of parallel loaders, so a remote parent guard
creates a waterfall.

It does not prove that the current parallel path is always faster in this deployment. An unauthorized
navigation can start several child requests before the parent loader redirects. Those requests remain
safe because each one rejects before its handler, but they can consume session and membership lookup
work. The cited docs do not measure this application's database latency, query count, or invalid-session
traffic.
No inspected TanStack Router or Start guide requires all protected route data to await one parent
membership request. No inspected guide allows a successful parent guard to replace authorization at
each private endpoint.

It also does not authorize removing the parent `member.me` loader. That call supplies shell data and
the organization timezone, and child components consume its loader result
([parent loader](../../apps/web/src/routes/$orgSlug/route.tsx#L10-L27),
[`files.tsx`](../../apps/web/src/routes/$orgSlug/files.tsx#L33-L45)).

### Residual risk found while rechecking the docs

Membership is now proven once per request, and never across requests. **The session is a different
story, and this predates the change.** `packages/auth/src/index.ts` enables Better Auth's
`cookieCache` with no `maxAge`, and the installed better-auth 1.6.28 defaults that cookie to 300
seconds (`session_data` in `better-auth/dist/cookies/index.mjs`). Better Auth's own documentation
says the cookie cache is an optimization, not an authority: with a server-side session store a
revoked session can stay active until the cookie's `maxAge` expires, and the remedies it names are
disabling `cookieCache`, setting a shorter `maxAge`, or passing `disableCookieCache: true` for
sensitive operations
([Session management, “Cookie Cache”](https://www.better-auth.com/docs/concepts/session-management#cookie-cache),
source `docs/content/docs/concepts/session-management.mdx`).

So `authorizeOrg` step 1 can accept a signed-out or revoked session for up to five minutes, while
steps 2 and 3 are always current. Deciding whether that window is acceptable — or whether to set a
short `cookieCache.maxAge`, or bypass the cache on sensitive mutations — is a separate security
decision that deserves its own ADR. It was not changed here.

## What this means for us

Use this order:

1. The parent membership loader and matched child route loaders may start in parallel, as ADR 0021
   requires ([ADR 0021](../contributing/decisions/0021-server-rendered-org-pages.md#L13-L21)).
2. The browser/Hono or SSR in-process transport builds one request context, resolving the session
   once ([`createRequestContext`](../../packages/api/src/lib/context.ts),
   [SSR client context](../../apps/web/src/lib/orpc.ts)).
3. `orgProcedure` then resolves membership — once per request per claimed org, through the request's
   memo — and checks the endpoint-specific permission on every call
   ([factory](../../packages/api/src/lib/procedures/factory.ts)).
4. Only the handler receives verified `context.scope`; every SQL query must also include its tenant
   predicate ([request lifecycle](../contributing/architecture/request-lifecycle.md#L42-L57)).
5. The parent loader converts its own `401` or `403` into the route redirect and supplies shell/timezone
   data ([org route](../../apps/web/src/routes/$orgSlug/route.tsx#L10-L27)).

Keep session extraction in request context or request middleware. Keep organization membership and
permission checks in `orgProcedure`, where the validated `orgSlug` and required endpoint permission are
available. Do not move authoritative authorization into React route code. Do not add a second remote
membership convention in `beforeLoad` beside the accepted loader convention.

If a future child loader truly depends on the parent loader's result, await its `parentMatchPromise`.
Do not serialize independent loaders through `beforeLoad`
([TanStack Router, loader parameters](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading#loader-parameters)).

## Next falsification

Benchmark one SSR load and one client navigation to a representative deep org page under three states:
valid member, signed-out user, and recently removed member. Record time to first byte/navigation commit,
Better Auth session lookups, membership queries, and protected handlers entered. Compare the current
parallel loader with a branch that moves only the parent `member.me` call to `beforeLoad`; keep all
`orgProcedure` guards in both branches. Change ADR 0021 only if the measured unauthorized-work reduction
outweighs the valid-user waterfall.

The natural next step is no implementation change. If measurements reopen the decision, write a narrow
performance spec before changing route order.

## Sources

- TanStack Router, Data Loading:
  <https://tanstack.com/router/latest/docs/framework/react/guide/data-loading>
- TanStack Start, Authentication:
  <https://tanstack.com/start/latest/docs/framework/react/guide/authentication>
- TanStack Router, Authenticated Routes:
  <https://tanstack.com/router/latest/docs/framework/react/guide/authenticated-routes>
- TanStack Start, Authentication Server Primitives:
  <https://tanstack.com/start/latest/docs/framework/react/guide/authentication-server-primitives>
- TanStack Start, Middleware (global request middleware):
  <https://tanstack.com/start/latest/docs/framework/react/guide/middleware#global-middleware>
- Reference architecture, openstory-so/openstory (`main`, observed 2026-08-18):
  <https://github.com/openstory-so/openstory>
- Resolved framework versions: [`bun.lock`](../../bun.lock#L951-L957)
- Accepted SSR decision: [ADR 0021](../contributing/decisions/0021-server-rendered-org-pages.md)
- Mandatory org guard decision: [ADR 0015](../contributing/decisions/0015-org-procedure-only.md)
- Parent org route: [`apps/web/src/routes/$orgSlug/route.tsx`](../../apps/web/src/routes/$orgSlug/route.tsx)
- Server procedure guard: [`packages/api/src/lib/procedures/factory.ts`](../../packages/api/src/lib/procedures/factory.ts)
- Request context: [`packages/api/src/lib/context.ts`](../../packages/api/src/lib/context.ts)
- Request lifecycle: [`docs/contributing/architecture/request-lifecycle.md`](../contributing/architecture/request-lifecycle.md)
- Authorization architecture: [`docs/contributing/architecture/authorization.md`](../contributing/architecture/authorization.md)
