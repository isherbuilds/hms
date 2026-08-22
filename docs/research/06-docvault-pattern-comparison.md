# Docvault's auth and loading pattern, measured against ours

> **Status:** describes docvault as it stood on 2026-08-18, before the patterns below were applied to
> it. The migration and its measurements are in [07](./07-docvault-pattern-migration.md); read that for
> the current state. The findings here still stand as of that date.

## Question

`/Users/docbook/accly-ai/docvault` is the multi-tenant base this repository shares a lineage with. Does
it use the same authentication and membership pattern, and is it faster or slower than ours?

## Answer

**Docvault is this repository's own earlier state.** Its guard resolves membership once per procedure
call, exactly as ours did before the per-request memo, and it still carries two decisions we have since
superseded: the organization layout is `ssr: false` and gates in the component (our
[ADR 0003](../contributing/decisions/0003-client-rendered-org-pages.md), superseded by
[0021](../contributing/decisions/0021-server-rendered-org-pages.md)), and `publicProcedure` is exported
with an opt-in `.use(requirePermission(...))` guard (our
[ADR 0015](../contributing/decisions/0015-org-procedure-only.md) removed that shape).

Faster or slower depends on the axis, and the axes disagree:

| axis                                | docvault   | this repo  | verdict                                           |
| ----------------------------------- | ---------- | ---------- | ------------------------------------------------- |
| time until the user sees their data | **633 ms** | **126 ms** | we are ~5× faster                                 |
| document time to first byte         | 8.6 ms     | 25.7 ms    | docvault 3× faster — its document carries no data |
| API round trips before data paints  | 6          | **0**      | ours ships data in the document                   |
| `member` joins per page visit       | **4**      | **1**      | ours does a quarter of the work                   |
| visits/s at concurrency 30          | 352        | 203.8      | docvault higher, but see the caveat               |
| `members.me` req/s at concurrency 1 | 582        | 269.9      | docvault higher, but see the caveat               |

The caveat matters more than the numbers: **the two throughput rows are not a comparison of the
pattern.** Docvault's dashboard renders three scalar counts and its `members.me` returns `{ roles }`
and nothing else, while ours renders a queue, a collections timeseries and per-department aggregates,
and its `members.me` additionally calls Better Auth's `listOrganizations` and reads organization
settings. Docvault wins those rows by doing less work per request, not by having a cheaper guard.

On the one axis where the pattern is isolated — membership joins per rendered page — docvault pays 4
and we pay 1.

## Evidence

### The pattern, from docvault's source

Paths are relative to `/Users/docbook/accly-ai/docvault`.

- The organization layout is client-only and gates in the component, not in `beforeLoad` or a loader:
  `ssr: false` at `apps/web/src/routes/$orgSlug/route.tsx:8`, then
  `authClient.useSession()` and `authClient.useListOrganizations()` at `:15-16` with `<Navigate>`
  redirects at `:25-31`. Its own comment concedes the gate is cosmetic: "The gate only spares a user
  who is about to be redirected a flash of 403s, so it can be dropped for a faster paint" (`:18-20`).
  Its `AGENTS.md:32` states the rule directly: "The layout keeps `ssr: false` because its session and
  organization-list checks are client-side today."
- There is **no** `apps/web/src/start.ts`, so no Start global request middleware — the same absence we
  have. No `WeakMap`, `getRequest`, `requestMiddleware`, or `functionMiddleware` appears anywhere under
  `apps/web/src`.
- The SSR oRPC client builds its context inline on every call —
  `context: async () => { const headers = new Headers(getRequestHeaders()); const session = await auth.api.getSession({ headers }); return { headers, session }; }`
  at `apps/web/src/lib/orpc.ts:15-20`. This is our pre-change shape.
- `packages/api/src/lib/context.ts:14-17` resolves the session per context construction; there is no
  `createRequestContext` equivalent and no membership map on the context.
- The raw builder is exported: `export const publicProcedure = o;` at
  `packages/api/src/lib/procedures/factory.ts:24`. The guard is opt-in middleware,
  `requirePermission(permission)` at `:97-101`, applied per router as
  `publicProcedure.input(orgInput).use(requirePermission({ member: ["read"] }))`
  (`packages/api/src/routers/members.ts`). Omitting the `.use(...)` still compiles.
- Membership is joined fresh on every call at `factory.ts:63-68`, under a comment identical to the one
  we replaced: "Looked up fresh on every request so revocation takes effect immediately" (`:59`).
  A search for `Map|WeakMap|memo|cache` in `packages/api/src/lib/` finds no membership cache.
- Handlers do scope on the verified value (`context.scope.orgId`) — `members.ts:62`, `files.ts:89`,
  `bills.ts:115`, `dashboard.ts:20`, `audit.ts:24`. Tenancy discipline is intact; only the guard's
  shape and its per-call cost differ.
- `packages/auth/src/index.ts:37-41` enables `session.cookieCache` with `maxAge` commented out —
  the same five-minute session staleness recorded for this repo in
  [05](./05-tanstack-auth-loader-ordering.md). Docvault inherits that gap too.

### The measurements

Method. Both repositories were seeded with their own `db:seed -- --reset`, which produce the same
fixture (Mercy General Hospital + Ridgeview Academy, 3 users, 2 organizations, 4 `member` rows).
Production builds of both, `NODE_ENV=production`; this repo on API `:3100` / web `:3101` against
Postgres `:55442`, docvault on API `:3200` / web `:3201` against Postgres `:55432`. Statements counted
with `log_statement='all'`, bracketed between marker queries around one cold visit; reset afterwards.
Browser numbers from headless Chromium at 1440×900, signed in as `owner@example.com`, median of 5 cold
loads of `/mercy-general/dashboard`. "Data visible" waits for a stat tile to hold a digit rather
than its pending placeholder — the same predicate on both sides.

| cold authenticated dashboard visit | docvault             | this repo            |
| ---------------------------------- | -------------------- | -------------------- |
| document TTFB                      | 8.6 ms               | 25.7 ms              |
| document transferred               | 6 786 B              | 22 451 B             |
| first contentful paint             | 104 ms               | 116 ms               |
| **data visible**                   | **633 ms** (614–734) | **126 ms** (114–209) |
| API requests before data           | 6                    | 0                    |
| total statements                   | 5                    | 8                    |
| `member` joins                     | **4**                | **1**                |

Docvault's six pre-paint requests are `/api/auth/get-session`,
`/api/auth/organization/list`, `/rpc/dashboard/summary`, `/rpc/bills/exceptions`, `/rpc/members/me`,
and `/rpc/operator/capabilities`. Four of those are org procedures, and each ran its own membership
join. Neither app resolved a session from the database: `cookieCache` answered from the signed cookie
on both.

Throughput, 200 visits per point, best of the honest framings:

| concurrency | docvault visits/s | ours visits/s | docvault p50 | our p50  |
| ----------- | ----------------- | ------------- | ------------ | -------- |
| 1           | 84.7              | 66.7          | 10.1 ms      | 13.7 ms  |
| 10          | 232.6             | 113.4         | 37.5 ms      | 70.5 ms  |
| 30          | 352.0             | 203.8         | 82.8 ms      | 146.7 ms |

Same endpoint on both, `POST /rpc/members/me`, 400 calls: docvault 582.1 req/s and p50 1.58 ms at
concurrency 1, ours 269.9 req/s and p50 3.29 ms. Both perform exactly one membership join per call, so
the gap is handler work: docvault's handler is
`.handler(({ context }) => ({ roles: context.scope.roles }))`, while ours also awaits
`auth.api.listOrganizations` and an `organization_settings` read to feed the app shell.

## What this proves / does not prove

Proved: docvault's guard performs one membership join per org procedure call, so a page that calls four
of them pays four joins, and its client-rendered layout defers all data fetching until after the
JavaScript boots — six API round trips before the first number appears. Both are direct observations,
with source lines and statement counts.

Not proved: that docvault is "slower" as an application. Two of the three throughput measurements
favour it, and both are explained by lighter pages and a leaner handler rather than by the guard. A
throughput comparison between two different applications measures the applications, not the pattern.
The only pattern-isolating number here is joins per rendered page.

Also not measured: docvault under its own `db:seed:bills` fixture, which is far larger than the plain
seed and would change absolute latencies on both sides; and any concurrency above 30.

One side effect to disclose: running `db:seed -- --reset` in docvault dropped and re-migrated its dev
schema, so whatever was in that database — including anything from `db:seed:bills` — is gone. Re-run
`bun run db:seed:bills` there to restore a bills dataset.

## What this means for us

Nothing to change here; this repository is already the later state of both decisions. The comparison is
useful in one direction only — as the argument for a change **in docvault**, if its owner wants it:

1. The cheap, self-contained win is the per-request membership memo: add a `createRequestContext` with
   a `memberships` map, key it by caller and slug, and have `authorizeOrg` read through it. That takes
   its dashboard from four joins to one without touching a single route. Our diff is the template.
2. The larger win is its `ssr: false` layout. Moving the membership proof into a parent `loader` and
   letting the server render with data is what takes 633 ms down to 126 ms. That is the change our
   ADR 0021 records, and it is a bigger migration than the memo.
3. The security-shaped item is unrelated to speed: `publicProcedure` is exported and the guard is
   opt-in, so an unguarded org endpoint compiles. Our ADR 0015 closed that by making the permission a
   constructor argument and not exporting the raw builder.

Do not import docvault's `members.me` shape as a "faster" pattern. Ours is heavier because it feeds the
app shell in the same round trip that proves membership, which is what lets the first paint carry data.

## Next falsification

Apply the per-request memo to docvault alone, keep everything else fixed, and re-measure joins per cold
dashboard visit — the prediction is 4 → 1 with data-visible unchanged near 633 ms, because the memo
cannot fix a client-render waterfall. Then, separately, flip its org layout to SSR with a parent loader
and re-measure data-visible — the prediction is a drop toward our 126 ms. Measuring the two changes
separately is what distinguishes the guard's cost from the render strategy's cost.

## Sources

- Docvault source, read-only, at `/Users/docbook/accly-ai/docvault` — `AGENTS.md:32`,
  `apps/web/src/routes/$orgSlug/route.tsx:7-31`, `apps/web/src/lib/orpc.ts:12-33`,
  `apps/web/src/router.tsx:19-27`, `packages/api/src/lib/context.ts:14-17`,
  `packages/api/src/lib/procedures/factory.ts:24,50-101`, `packages/api/src/routers/members.ts`,
  `packages/auth/src/index.ts:37-41`
- Our pattern and its own measurements: [05](./05-tanstack-auth-loader-ordering.md)
- Superseded-here decisions that docvault still runs:
  [ADR 0003](../contributing/decisions/0003-client-rendered-org-pages.md),
  and the shape replaced by [ADR 0015](../contributing/decisions/0015-org-procedure-only.md)
- Our current decisions: [ADR 0021](../contributing/decisions/0021-server-rendered-org-pages.md),
  [ADR 0015](../contributing/decisions/0015-org-procedure-only.md)
