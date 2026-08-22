# Applying our patterns to docvault, and what it measured

## Question

[06](./06-docvault-pattern-comparison.md) found docvault running this repository's earlier state: one
membership join per procedure call, `ssr: false` org pages gated in the component, and an exported raw
oRPC builder with an opt-in guard. All three were ported into docvault. Measured on one machine in one
session, what did each change actually buy, and what did it cost?

## Answer

**For the user, yes, in proportion to network latency. For the server, it costs about 1.7× capacity at
no concurrency and roughly nothing under load. The memo halves database work and is invisible in
latency. And a query-key mismatch was silently cancelling server rendering on one page entirely.**

Server rendering removes **4–6 serialized round trips** from the critical path: the slope of
time-to-data against RTT is 6–7 round trips client-rendered and 2–3 server-rendered on the dashboard,
8–9 against 2–3 on members. That is the latency-independent result. The millisecond win is
`RTT × round trips saved`, which is why it is nothing on localhost and 2–3× over a real network.

Time until the seeded rows are in the DOM, median of 5 cold loads, HTTP cache disabled:

| state                         | dash @0ms | dash @50ms | dash @150ms | members @0ms | members @50ms | members @150ms |
| ----------------------------- | --------- | ---------- | ----------- | ------------ | ------------- | -------------- |
| before (`ssr:false`, no memo) | 77 ms     | 385 ms     | 1097 ms     | 79 ms        | 490 ms        | 1407 ms        |
| after (SSR + memo)            | 83 ms     | **162 ms** | **466 ms**  | 93 ms        | 495 ms        | 1413 ms        |
| + awaited child loaders       | 91 ms     | 160 ms     | 459 ms      | 89 ms        | 495 ms        | 1419 ms        |
| + matched query key           | 79 ms     | 162 ms     | 468 ms      | 85 ms        | **165 ms**    | **469 ms**     |

Three things fall out of that table:

1. **At 0 ms RTT every state is the same** (77–93 ms). On localhost there is no round trip to save, so
   server rendering cannot win. Any claim that it is faster has to name a latency.
2. **At 50 and 150 ms RTT server rendering is 2.3–3.0× faster**, because the browser stops paying a
   round trip after JS boot to fetch what the document could have carried.
3. **The members page got no benefit until a query key was fixed.** Its loader prefetched
   `{ orgSlug }` while its component queried `{ orgSlug, limit }` — different keys, so the prefetch
   warmed a cache entry nobody read and the browser refetched on every visit. Awaiting the loaders
   changed nothing (495 → 495 ms); sharing one query definition took it from 1413 ms to 469 ms. The
   mismatch predates this work. Server rendering only made it visible.

The server cost is real but far smaller than a document-only comparison suggests. Counting **every
request the browser makes, across both hosts** — 5 per visit client-rendered (static shell,
`members.me`, `dashboard.summary`, two sidebar calls) against 3 server-rendered (document, two sidebar
calls) — medians of 3 runs × 200 visits, RTT 0:

`dashboard.summary` was removed after this measurement because no product screen consumed it; the
request counts above describe the benchmark as run rather than the current route graph.

| concurrency | `ssr:false` visits/s | `ssr:true` visits/s | ratio     | `ssr:false` p50 | `ssr:true` p50 |
| ----------- | -------------------- | ------------------- | --------- | --------------- | -------------- |
| 1           | 164.3                | 94.0                | **0.57×** | 5.6 ms          | 10.2 ms        |
| 10          | 293.1                | 261.0               | 0.89×     | 29.0 ms         | 30.1 ms        |
| 30          | 311.5                | 360.9               | 1.16×     | 85.7 ms         | 80.3 ms        |

Run-to-run spread inside each cell is 1.02–1.29×, so only the `c=1` row is outside the noise. Read that
way: server rendering costs about **1.7× capacity at no concurrency and roughly nothing under load**,
while per-visit database work goes _down_ (the client-rendered visit paid 4 membership joins, the
server-rendered one pays 2 — 1 inside the document, 1 for the sidebar's own request).

A document-only comparison looked much worse (103 vs 1361 req/s) and was misleading: under `ssr: false`
the document is a static file, but the same membership and summary queries still ran — on the API host,
excluded from that measurement. The work did not disappear, it moved.

Per document, for completeness:

| per document, medians of 3 runs × n=40 | before (`ssr:false`) | after (SSR)          |
| -------------------------------------- | -------------------- | -------------------- |
| dashboard bytes / statements / joins   | 6 383 B / 0 / 0      | 14 660 B / 5 / **1** |
| members bytes / statements / joins     | 6 383 B / 0 / 0      | 23 800 B / 6 / **1** |
| dashboard TTFB p50                     | 1.8–2.0 ms           | 11.3–12.1 ms         |
| members TTFB p50                       | 1.4 ms               | 10.2–10.5 ms         |

The change that is not about speed at all: under `ssr: false` an unauthenticated request for
`/mercy-general/dashboard` returned **200** with the app shell and redirected in the browser
afterwards. Under `ssr: true` it returns **307 → `/login?redirect=…`**, and a signed-in non-member gets
**307 → `/join`**. The gate reaches the server, which is what docvault's ADR 0003 deferred.

## Evidence

Method. `bun run db:seed -- --reset` (3 users, 2 organizations, 4 `member` rows, 3 members in Mercy
General), production builds, `NODE_ENV=production`, docvault on API `:3200` / web `:3201`. Statements
counted with `log_statement='all'` bracketed between marker queries so the window is exactly the request
under test. Latency is `curl` TTFB, n=40, after warm-up. Time-to-data is measured in headless Chromium
with the HTTP cache disabled, polling the DOM for a seeded email; RTT is emulated through CDP
`Network.emulateNetworkConditions`. Each state was rebuilt and both hosts restarted before measuring.
Every number here comes from one session, because absolute timings are not comparable across sessions on
this machine.

Paint timings are absent on purpose: this environment returns no `first-contentful-paint` entries and
will not run document-start injection, for every state equally. Polling for the data is what replaced
them, and it measures the thing the question is about.

### The memo, isolated under SSR

Only the memo lookup in `resolveMembership` was disabled, then restored (md5 verified, no marker left):

| docvault SSR document | memo off | memo on |
| --------------------- | -------- | ------- |
| dashboard joins       | 2        | **1**   |
| dashboard statements  | 6        | **5**   |
| members joins         | 2        | **1**   |
| members statements    | 7        | **6**   |
| dashboard TTFB p50    | 12.0 ms  | 14.3 ms |
| members TTFB p50      | 12.9 ms  | 12.0 ms |

The join count halves because each document resolves two org procedure calls — the parent loader's
`members.me` and the page's own query — that prove the same membership. Latency is a wash in both
directions: one indexed join is ~0.4 ms warm against a ~12 ms render on a local socket. Under
`ssr: false` the memo cannot show up at all, because the document does no database work.

### Correcting 06

[06](./06-docvault-pattern-comparison.md) reported 633 ms to data for docvault against 126 ms here, and
attributed the gap to client rendering. That was measured against the **old shell**, which read the
session and organization list through Better Auth client hooks behind a `Skeleton` gate. With that shell
replaced but rendering still on the client, the same page reaches data in **79 ms at 0 ms RTT**. So most
of the original 633 ms was the auth-hook waterfall, not client rendering as such. The render strategy is
worth 2–3×, at latency; the auth hooks were worth far more than that.

### React Compiler

Both repositories run the compiler through `babel({ presets: [reactCompilerPreset()] })` before the
React transform, so every build measured above was compiled identically.

A rule-of-React violation makes React Compiler 1.0.0 **skip a component silently** — the build still
succeeds. Two whole components in docvault were being skipped, both from a default inside an object
destructuring pattern:

- `apps/web/src/components/app-shell.tsx` — `const { data: waiting = 0 } = useQuery(...)` in
  `BillsBacklogBadge`, which renders in every org page's sidebar.
- `apps/web/src/components/page.tsx` — `SkeletonRows({ count = 3 })`.

Confirmed in the shipped bundle, not only in a harness: in `page-*.js`, `ErrorNote` carries the
compiler's `react.memo_cache_sentinel` machinery while `SkeletonRows` was emitted as a plain
unmemoized function. Both were fixed by reading the default in the body instead of the pattern; docvault
now reports zero bailouts across `apps/web/src`, and the rebuilt bundle memoizes both.

The failing shape is broad — `{ count = 3 }`, `{ data: value = 0 }`, and a destructured hook result with
a default all bail out with `(BuildHIR::lowerAssignment) Expected object property value to be an LVal`.
Only the no-default version compiles.

## What this proves / does not prove

Proved, by toggling one switch at a time: the memo removes one membership join per extra org procedure
call sharing a request and does not move document latency at this size; server rendering moves data into
the first document and the authorization gate onto the server; server rendering is worth 2.3–3.0× time
to data at 50–150 ms RTT and nothing at 0 ms; it costs 6–20× document throughput.

Not proved: that any of this holds at realistic data volumes. The fixture has three members and no
bills. Statement counts are dataset-independent; the throughput numbers are a ceiling that will fall as
queries get real work to do, on both sides.

Not measured: throughput under emulated latency, which would favour SSR further (fewer round trips per
visit), and any concurrency above 30.

Not reproduced: the true pre-migration application. The `ssr: false` column is the new code with
rendering switched off, not the old shell — the old shell also made two Better Auth client calls that no
longer exist. The real before was worse than that column, as the 06 correction above shows.

Still open in docvault, and unrelated to any of this: the sidebar makes two client calls after
hydration (a bills badge and the founder probe) because it mounts inside `ClientOnly`; and
`cookieCache` is enabled with no `maxAge`, so Better Auth's 300 s default lets a revoked session
authenticate for up to five minutes while membership and permissions stay current. That one deserves its
own decision, in both repositories.

## Next falsification

Re-run the latency sweep against a dataset with real rows. The prediction is that the 0 ms column stays
flat, the 50 and 150 ms advantage holds or widens, and the SSR document's throughput falls faster than
the static shell's, moving the break-even point. If server rendering ever wins at 0 ms RTT, something
else regressed.

Then audit the other org routes for the query-key mismatch that cost the members page its entire SSR
benefit: any route whose loader and component declare the query input separately rather than sharing one
definition is a candidate.

## Sources

- Migrated docvault code: `packages/api/src/lib/context.ts`,
  `packages/api/src/lib/procedures/factory.ts`, `apps/web/src/lib/orpc.ts`,
  `apps/web/src/routes/$orgSlug/route.tsx`, `apps/web/src/routes/$orgSlug/members.tsx`,
  `apps/web/src/components/app-shell.tsx`, `apps/web/src/components/page.tsx`,
  `tests/support/client.ts`, `tests/integration/request-lifecycle.test.ts`
- docvault decision records 0024, 0025, 0026; superseded 0003 and 0009
- Prior comparison of the pre-migration state: [06](./06-docvault-pattern-comparison.md)
- The patterns as this repository states them:
  [ADR 0015](../contributing/decisions/0015-org-procedure-only.md),
  [ADR 0021](../contributing/decisions/0021-server-rendered-org-pages.md)
