# Data fetching

How a page gets its data, on the server and in the browser. This is the
pattern every org page follows; [request lifecycle](./request-lifecycle.md)
covers what happens inside a single procedure call.

## Shape

```
URL ──▶ route loaders (SSR: in-process client / browser: HTTP)
              │  prime the TanStack Query cache, in parallel
              ▼
        Query cache ──dehydrate──▶ streamed into the document ──▶ hydrated
              ▲                                                     │
              │  invalidations                                      ▼
        mutations ◀───────────────────────────── components (useQuery)
```

One request, one context, one membership proof. The SSR render calls the oRPC
router in-process; the context is cached per `Request` (a `WeakMap` in
`apps/web/src/lib/orpc.ts`), so a page that fans out into several procedure
calls resolves the session once and proves membership once. Nothing survives
the request.

## Who owns what

**TanStack Query owns caching.** The router's own preload cache is off
(`defaultPreloadStaleTime: 0` in `apps/web/src/router.tsx`). Two caches with
two ideas of staleness is one cache too many.

**Loaders prime the cache; components subscribe to it.** A loader is not a
data pipe. It starts fetches early — on hover, thanks to
`defaultPreload: "intent"` — and the component picks up the same cache entry
with `useQuery`. Loader and component must use identical `queryOptions` calls,
or the component fetches a second time. Do not read query data through
`useLoaderData`: without a query observer the entry never refetches on focus,
ignores invalidation, and gets garbage-collected underneath you. The one
exception is the org layout returning `{ timeZone, today }` — two scalars that
change only with navigation.

**The layout proves membership; children fan out.** The `/$orgSlug`
loader fetches `member.me` — roles, identity, org list, timezone, and currency in one round
trip — and redirects signed-out callers to `/login`; organization selection and
invitation acceptance live at `/join`. Child loaders run in parallel with it. A child that needs roles,
timezone, or currency awaits `ensureQueryData(member.me)` and shares the in-flight
request; the cost is deduplication, not a second round trip.

## Loader rules

- **Await what the server HTML needs.** Loaders await their queries, so the
  SSR document ships complete markup and the browser paints it without a
  second round trip. `setupRouterSsrQueryIntegration` dehydrates the
  request-local cache into the stream and seeds the browser cache — data is
  never fetched twice.
- **Independent queries run in parallel.** `Promise.all` of prefetches, never
  a chain of awaits. Only a real data dependency (roles gate which prefetches
  fire) may serialize.
- **Speculative work never blocks.** Warming a page the user has not asked
  for (the queue's first-row detail) is `void`-fired, not awaited.
- **`prefetchQuery` swallows errors; that is a feature with a limit.** Use it
  for secondary data, where the component's inline error state is enough. Data
  the page cannot render without goes through `loadRouteQuery`
  (`apps/web/src/lib/orpc-error.ts`), which maps `NOT_FOUND` to the route's
  not-found boundary and lets other failures hit the error boundary.
- **Search params that identify data go through `loaderDeps`.** The reports
  pages declare `from`/`to`/`asOf` as `loaderDeps`, so the loader prefetches
  exactly what the component will ask for and shared URLs arrive warm.
  Ephemeral filter state (a debounced search box) stays in component state;
  the loader warms the unfiltered page.
- **Growing operational lists use keyset pages.** The cursor contains every stable ordering column;
  the matching tenant-leading index selects `limit + 1` base rows before display joins. The browser
  uses `useInfiniteQuery` and an explicit Load more action, never a silent hard limit or `OFFSET`.
  Automatic polling stops after staff load a second page because TanStack would refetch every loaded
  page; deeper browsing exposes an explicit refresh instead of multiplying background requests.

## Cache policy

| Setting                  | Value                                                                                         | Where                                   |
| ------------------------ | --------------------------------------------------------------------------------------------- | --------------------------------------- |
| Default `staleTime`      | 60 s                                                                                          | `apps/web/src/lib/query-client.ts`      |
| Operational screens      | 10 s poll, 5 s stale; never bridge placeholder data across resource or org keys               | `apps/web/src/lib/operational-query.ts` |
| Membership (`member.me`) | 60 s default; `staleTime: 0` only where a decision needs a fresh proof (`settings/index.tsx`) | per call site                           |
| Retry                    | none on server, none on 401/403, twice otherwise                                              | `query-client.ts`                       |

The 60-second shell cache on `member.me` is an accepted trade (ADR 0021): a
removed member can keep the shell for at most a minute, but every procedure
call re-proves membership server-side, so data access dies immediately.

## Failure and staleness

- **Expired session**: any query or mutation that returns 401 triggers one
  shared handler (`QueryCache` and `MutationCache` in `query-client.ts`) that
  hard-redirects to `/login?redirect=…`. The login route validates the
  redirect target against an allowlist.
- **A pending screen is never empty.** Navigations slower than 800 ms get the
  router's neutral pending layout for at least 400 ms; detail pages render a
  static placeholder body, not `null`, while their queries settle.
- **Polling screens name their staleness.** `StaleDataNotice`
  (`apps/web/src/components/stale-data-notice.tsx`) stays invisible while
  refetches succeed and warns once data is older than three poll intervals. A
  front desk acting on a dead queue is worse than one that knows the
  connection dropped.

## Mutations

Return (or await) the invalidation promise from `onSuccess`. The button stays
pending until the list shows the new state, instead of flashing the old row
first. Cross-terminal races surface as `CONFLICT`, and `toastOpdConflict`
refetches everything the loser is looking at, then toasts the cause.

Cross-screen effects go through the domain helpers in
`apps/web/src/lib/domain-invalidation.ts`. OPD appointment changes refresh the queue,
OPD appointment detail, dashboard aggregates, and billing worklist; billing changes refresh the OPD
billing view, organization-wide worklist, and collections aggregate. The helpers require `orgSlug`,
keeping every generated query key tenant-scoped.

## Formatting

`useOrgDateTime()` (`apps/web/src/lib/org-datetime.ts`) is the single owner of
date/time presentation: `en-IN` plus the organization's timezone, memoized.
Every formatter an org page renders with comes from it, so server and browser
output match (no hydration mismatches) and a locale decision is a one-file
change. Money formatters follow the same rule: explicit `en-IN`, never the
runtime default locale.

## What we deliberately did not adopt

- **Fire-and-forget loaders with Suspense streaming.** The alternative SSR
  shape — never await in loaders, let `useSuspenseQuery` stream markup
  progressively — trades a complete first document for a faster shell. On a
  cloud-hosted console reached over variable links, one complete document
  wins, provided server→DB latency stays low (keep Postgres co-located; see
  [deployment](../deployment.md)). Revisit per-page if a measured TTFB says
  otherwise.
- **Route-context `queryOptions` sharing.** Building query options once in a
  route `context` function ends loader/component divergence structurally, but
  it rides an undocumented router option. Today `loaderDeps` plus one
  `queryOptions` call per site covers us. Adopt it if search-param-keyed
  queries multiply and drift bites.

## Adding a page — checklist

1. Loader prefetches every query the page mounts with, in parallel;
   `loaderDeps` for any search param that keys a query.
2. Required data through `loadRouteQuery`; secondary data through
   `prefetchQuery`; roles/timezone/currency through `ensureQueryData(member.me)`.
3. Component subscribes with the byte-identical `queryOptions` call.
4. Shared multi-terminal data adds `OPERATIONAL_REFETCH` and a
   `StaleDataNotice`.
5. Dates and money format through `useOrgDateTime()` / the explicit-locale
   helpers. No `Intl.*Format(undefined, …)` in server-rendered output.
6. Mutations return their invalidations.
