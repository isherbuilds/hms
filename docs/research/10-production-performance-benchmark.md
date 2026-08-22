# Production performance benchmark

Reviewed: 2026-08-20

## Conclusion

The first measured bottleneck was transport, not React rendering or duplicate data fetching. Nitro
served hashed JavaScript, CSS, and fonts at their full minified size. Enabling build-time Brotli and
gzip reduced cold-document transfer by 60.7–66.7% across four authenticated routes. Under Chrome's
Slow 4G preset, the dashboard's median FCP/LCP fell from 3,224 ms to 1,636 ms and its load event fell
from 6,390 ms to 3,621 ms.

The current TanStack Start guide also suggests `srvx` `FastResponse` for Node/Nitro. The initial
five-round sample looked positive, but an expanded order-balanced sample did not confirm the gain:
across 15 rounds per variant, concurrency-30 throughput was 1.2% lower and all distributions
overlapped. `FastResponse` was therefore removed. This is a measured rejection, not a retained
optimization.

These changes do not alter oRPC boundaries, Query keys, loader semantics, tenant scope, permissions,
or mutation behavior.

## Fixture and method

- Dedicated PostgreSQL database `hms_perf_dev`, migrated and seeded with the normal repository
  seed; no development database was reset.
- Production Hono/oRPC process at `127.0.0.1:3100` and production TanStack Start/Nitro process at
  `127.0.0.1:3101`.
- Chrome 151, isolated persistent profile, 1440 × 900. Each recorded cold-document sample restarted
  Chrome and capped disk/media cache at one byte. Five samples followed one discarded warm-up.
- Server samples used 100 sequential documents and 300 documents at concurrency 30, interleaved
  within each run after ten warm-ups. The expanded experiment has 15 rounds per artifact and a
  balanced A→B→B→A artifact order. Medians below are medians across all 15 rounds.
- The same worktree, data, hosts, credentials, and route inputs were used on both sides of each A/B.
  Generated build directories were swapped rather than rebuilt between the server A/B runs.

Raw samples are committed in [`data/performance-2026-08-20`](./data/performance-2026-08-20/).
`scripts/benchmark-server.ts` treats a redirect to the login page as failure even though `fetch`
would otherwise follow it to a 200 response. The browser harness similarly rejects a final-path
mismatch, SSR recovery, hydration RPCs, non-finite core metrics, or CLS over 0.05. It invokes the
lockfile-pinned `chrome-devtools-axi` 0.1.29 binary with a narrowed environment.

## Browser results: public-asset compression

All values are five-sample medians. Timing changes on the unthrottled localhost link are within
machine noise; transferred bytes are deterministic.

| Route     | Transfer before | Transfer after | Change | FCP/LCP before | FCP/LCP after | Requests |
| --------- | --------------: | -------------: | -----: | -------------: | ------------: | -------: |
| Dashboard |     1,072,620 B |      421,176 B | −60.7% |         140 ms |        136 ms |  43 → 43 |
| Queue     |     1,041,364 B |      353,825 B | −66.0% |         132 ms |        140 ms |  50 → 50 |
| Members   |     1,049,851 B |      360,139 B | −65.7% |         160 ms |        168 ms |  50 → 50 |
| Billing   |       969,769 B |      323,166 B | −66.7% |         140 ms |        132 ms |  41 → 41 |

### Slow 4G dashboard

| Metric              |      Before |     After |    Change |
| ------------------- | ----------: | --------: | --------: |
| transferred bytes   | 1,072,620 B | 421,176 B |    −60.7% |
| DOMContentLoaded    |    3,189 ms |  1,580 ms |    −50.5% |
| load                |    6,390 ms |  3,621 ms |    −43.3% |
| FCP                 |    3,224 ms |  1,636 ms |    −49.3% |
| LCP                 |    3,224 ms |  1,636 ms |    −49.3% |
| CLS                 |     0.00459 |   0.00459 | unchanged |
| long tasks          |        0 ms |      0 ms | unchanged |
| hydration RPCs      |           0 |         0 | unchanged |
| SSR recovery marker |       false |     false | unchanged |

Nitro's documented default is no public-asset compression. With `compressPublicAssets`, it emits
precompressed variants of supported assets larger than 1,024 bytes, avoiding runtime compression
overhead when Nitro serves the files itself ([official Nitro config](https://nitro.build/config#compresspublicassets)).
The measured core JavaScript asset changed from 349,853 bytes over the wire to a 93,422-byte Brotli
response. The clean web build increased from 6.73 s to 7.74 s (+1.01 s); this deployment-time cost
does not affect request latency.

The final explicit icon declaration also prevents the browser's implicit `/favicon.ico` probe from
entering the `/$orgSlug` wildcard. Before the change, that probe redirected through
`/favicon.ico/dashboard` to `/join` and emitted an RBAC membership-denial audit. The final cold
dashboard showed no favicon route traffic and retained zero hydration RPCs, zero long tasks, and the
same CLS. Its request count was 42; client chunk churn in the dirty worktree means this final count
is not used as a clean compression A/B claim.

## Server experiment rejected: `FastResponse`

| Load           | Metric     | Compression-only | `FastResponse` | Change |
| -------------- | ---------- | ---------------: | -------------: | -----: |
| concurrency 1  | throughput |     141.36 req/s |   145.96 req/s |  +3.3% |
| concurrency 1  | p50        |          6.47 ms |        6.35 ms |  −1.8% |
| concurrency 1  | p95        |          9.11 ms |        9.01 ms |  −1.0% |
| concurrency 30 | throughput |     278.41 req/s |   274.93 req/s |  −1.2% |
| concurrency 30 | p50        |        106.42 ms |      107.27 ms |  +0.8% |
| concurrency 30 | p95        |        122.55 ms |      121.16 ms |  −1.1% |

TanStack's current Node/Nitro hosting guide recommends `srvx` `FastResponse` because its optimized
Node response path avoids standard Web `Response` conversion and estimates about 5% more throughput
([official TanStack Start hosting guide](https://tanstack.com/start/latest/docs/framework/react/guide/hosting#performance-tip-fastresponse)).
That generic micro-optimization did not create a stable end-to-end improvement once database work,
SSR, and application logging were included. The 15-round ranges still overlapped heavily: sequential
throughput was 109.57–160.74 req/s without it and 100.99–159.65 req/s with it; concurrency-30
throughput was 230.32–291.51 versus 239.87–290.77 req/s. The direct dependency and custom server
entry were removed rather than carrying unproven complexity.

## What the case studies changed—and what we adopted

The three performance.dev articles are reverse engineering and interviews, not API documentation.
They are useful for forming hypotheses; this repository's measurements decide adoption.

- **Conductor:** profile the real product, keep stable router references, virtualize only truly long
  lists, and move nonessential work off the response path. HMS already uses TanStack Router/Query and
  React Compiler, and its measured cold routes had zero long tasks. There is no evidence yet for a
  broad memoization or virtualization rewrite. The measure-first workflow is adopted
  ([Conductor analysis](https://performance.dev/the-conductor-rewrite)).
- **Linear:** minimize or eliminate network work, preload the critical graph, cache immutable route
  code, and use optimistic state where rollback is safe. Compression directly addressed the network
  cost. A custom local-first sync engine is deliberately rejected for now: clinical and financial
  writes need server authorization, transactional invariants, conflict handling, and auditability.
  TanStack Query remains the bounded cache and mutation coordinator
  ([Linear analysis](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown)).
- **ChatGPT:** send a useful SSR shell, measure the real load path, stream where it advances the
  product's main action, and precompute only work the user is likely to need. HMS already produces
  complete authenticated SSR with zero post-hydration refetches in the measured routes. The AI
  surface already streams; broad server-driven prefetch plans would add complexity without a
  measured navigation problem. The article also shows that virtualization is a tradeoff, not a
  default—ChatGPT keeps messages in the DOM to preserve find-in-page and accessibility
  ([ChatGPT analysis](https://performance.dev/chatgpt)).

## Reproduction

Build and serve both applications against an isolated seeded database, then run:

```sh
PERF_OUTPUT=/tmp/browser.json bun run benchmark:browser

PERF_EMAIL='fixture@example.com' \
PERF_PASSWORD='fixture-password' \
PERF_OUTPUT=/tmp/server.json \
bun run benchmark:server
```

Set `PERF_NETWORK='Slow 4G'` and narrow `PERF_ROUTES` to the dashboard for the throttled run. Other
controls are named at the top of each benchmark script. The commands enforce correctness budgets;
compare their JSON against the committed baseline for timing, transfer, and request-count
regressions. Keep credentials and raw session cookies out of committed result files.

## Limits and next measurements

- Localhost TTFB does not model production region distance, TLS, CDN, or real database latency.
  Capture p75 RUM for navigation, FCP, LCP, INP, and route identity before choosing the next client
  optimization. Navigation and resource timing entries are the browser-owned basis for the current
  harness ([MDN timing guide](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Navigation_and_resource_timings)).
- The benchmark proves response and transfer behavior for the seeded routes; it does not prove
  performance for large patient lists, large invoices, reports, files, or long AI conversations.
- The server benchmark includes application logging and database work. It is deliberately an
  end-to-end SSR measure, not a microbenchmark of `Response` construction.
- Do not add a service worker, local database, speculative prefetch, or optimistic financial update
  until a trace demonstrates the corresponding wait and a correctness plan covers stale or failed
  writes.
