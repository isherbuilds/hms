# Midday adoption — before/after performance evidence

Captured 2026-08-24 for the completed Midday pattern-adoption change.
This capture replaces the original 2026-08-24 session files, which were lost
before commit. Both runs here happened in one session, on one machine, against
one dataset, so the pairs are comparable.

## Environment

- Apple M1 MacBook, macOS 25.5, Bun 1.4.0, production builds.
- `before-*` = commit `35550b9` built in a clean worktree; `after-*` = the
  midday-adoption working tree. Same dev Postgres for both.
- Dataset: normal dev seed plus `bun run db:seed:volume` — 20,000 patients and
  1,000 catalog items (400 active) in each of mercy-general and
  ridgeview-academy.

## Runbook

1. `bun run db:up && bun run db:seed && bun run db:seed:volume`
2. Build with the repo `.env` (`VITE_SERVER_URL=http://localhost:3000` is baked
   at build time): `bun run build`
3. Serve the production bundles on the dev origins (the bundles resolve
   `packages/env/.env` values; copy it next to each bundle):
   - API: `PORT=3000 bun run dist/index.mjs` in `apps/server`
     (`cp packages/env/.env apps/server/.env` first)
   - Web: `PORT=3001 bun .output/server/index.mjs` in `apps/web`
     (`cp packages/env/.env apps/web/.output/server/.env` first)
4. With `PERF_EMAIL=owner@example.com PERF_PASSWORD=password123
PERF_API_URL=http://localhost:3000 PERF_BASE_URL=http://localhost:3001`:
   - `PERF_OUTPUT=... bun run benchmark:rpc`
   - `PERF_ROUTE=/mercy-general/patients PERF_OUTPUT=... bun run benchmark:server`
   - `PERF_OUTPUT=... bun run benchmark:server` (dashboard default)
   - `PERF_ROUTES=/mercy-general/patients,/mercy-general/settings/catalog
PERF_OUTPUT=... bun run benchmark:browser`
5. Toggle interaction: measured in-page (see `toggle-interaction.json`) with
   Chrome DevTools "Slow 4G" network emulation.

## Recorded bounds

RPC numbers are p95 over 200 sequential warm requests. SSR numbers are the
last of three rounds. The after-run reflects the change set at capture time,
including the review fixes (id-keyset search cursor, text-cursor file list,
URL-sync rewrite, memoized catalog rows, `filter={null}`, guarded
settle-invalidation). The later core-screen refinement moved Patients list
search back to local state; the URL-sync result is historical, not current
product behavior.

| Metric                                          | Before                                          | After                           | Bound    | Result                  |
| ----------------------------------------------- | ----------------------------------------------- | ------------------------------- | -------- | ----------------------- |
| `patient.search` first page p95                 | 8.25 ms                                         | 9.18 ms (111%)                  | ≤ 110%   | bound missed — see note |
| `patient.search` `q="ra"` p95                   | 7.39 ms                                         | 7.13 ms (96%)                   | ≤ 110%   | pass                    |
| `patient.search` phone p95                      | 9.60 ms                                         | 11.04 ms (115%)                 | ≤ 110%   | bound missed — see note |
| `catalog.list` p95 (untouched control)          | 16.84 ms                                        | 17.92 ms (106%)                 | ≤ 110%   | pass                    |
| SSR `/mercy-general/patients` p50 / p95, 30-way | 102.8 / 133.3 ms                                | 114.2 / 141.7 ms (111% / 106%)  | ≤ 110%   | p50 missed; p95 passed  |
| Patients route script transfer                  | 22,737 B                                        | 22,805 B (+68 B)                | ≤ +15 KB | pass                    |
| Catalog toggle click → visible flip @ Slow 4G   | n/a (full round trip, ≥ 800 ms at this latency) | 7 ms median (18 ms unthrottled) | < 100 ms | pass                    |

The table reports the original bounds mathematically. They were not accepted
at capture time. The completed 2026-10-04 comparison below explicitly accepts
the three historical exceptions as drift; it does not rewrite these misses.

**Drift note.** The final after-capture ran hours after the baseline in a
noisier window: `catalog.list` — untouched by every change in this set —
drifted +6–8% in the same runs, and repeated captures oscillated ±15% per
scenario (`patient.search` first page read 8.56, 8.76, then 9.18 ms across
three otherwise-identical runs). To isolate the only server-plan change (the
id-keyset cursor), `EXPLAIN (ANALYZE, BUFFERS)` was run warm on both
orderings over the same 20k-row org: identical plan shape (one index range
scan, 21 rows out, 25 filtered, 51–52 shared buffers) via
`patients_org_id_id_unique` (id keyset) and `patients_org_created_idx`
(timestamp keyset), both converging at approximately 0.1 ms. The capture's evidence is
consistent with ambient machine drift rather than a change-induced regression,
but the 111–115% cells still miss the agreed bound. Single-stream SSR p95
jitters the same way (approximately ±2 ms on an approximately 8 ms route) and carries the same
interpretation.

### 2026-10-04 — interleaved remeasurement attempt (invalid)

The delegated decision is **not to accept the exceptions as drift on this
attempt**. First-page p95 (111%), phone p95 (115%), and 30-way Patients SSR p50
(111%) remain outside the original 110% bound. Treat them as unresolved
regression risks for the verification gate, not as proven change-induced
regressions. The historical control/plan evidence above supports the drift
hypothesis but does not replace a valid interleaved comparison.

Clean detached `/tmp` worktrees used `35550b9` before, `02897d8` after (the final
2026-08-24 cursor fix), and `78ee3da` current HEAD. Each received its own env
copy and locked dependency install; bundles were served on API/web ports
3100/3101, 3200/3201, and 3300/3301. The after-tree migrated and normal+volume
seeded dedicated `hms_perf`; current HEAD used separate `hms_perf_current`
because its schema removed historical columns. Both databases had exactly
20,000 patients, 1,000 catalog items and 400 active catalog items per seeded
organization. The shared development database was neither seeded nor reset.

Planned order was before RPC+SSR, after RPC+SSR, current RPC+SSR, repeated five
times, using the **same after-tree benchmark scripts** for every bundle.
RPC retained all four scenarios, including untouched historical `catalog.list`,
20 warmups and 200 sequential requests. SSR retained ten warmups, 100
single-stream requests and 300 requests at concurrency 30 per outer round.
Current HEAD's paginated catalog is context, not an untouched control.

Only before RPC round one completed. Its raw output is retained but **excluded**:
copied `NODE_ENV=development` affected the initial bundles; production SSR then
returned 500 with `jsxDEV is not a function`, and the server benchmark rejected
400 failed documents. Rebuilding with explicit `NODE_ENV=production` replayed
historical web cache entries instead of rebuilding. Concurrent Go compilation
was another reported confounder. The orchestrator then required immediate
wrap-up with no further checks/builds. Consequently there are **zero valid
paired rounds**, no interleaved medians or ratio distribution, and no new
within-bound claim. A continuation must explicitly use production build env,
bypass the stale build cache in the isolated trees, and complete the five
alternating rounds after competing compilation stops.

All started benchmark servers were stopped, all three worktrees removed, and
both dedicated databases dropped. No application code changed.

### 2026-10-04 — completed production interleaved comparison

**Decision: accept the three historical exceptions as drift.** This supersedes
the invalid attempt's unresolved decision, not its excluded timings.
Both new batches meet the first-page and phone bounds on ratios of median
p95. Patients SSR p50 misses in the initial batch but does not reproduce in
the repeat; its median paired ratio is within bound in both batches.
**[INFERENCE]** The changing direction/magnitude, including the untouched
historical control, supports ambient timing drift rather than a persistent
adoption-induced regression. This is explicit acceptance of the original
exceptions, not proof of causal equivalence or a production latency guarantee.

#### Method and validity

- Clean detached trees: before `35550b9`, after `02897d8`, current
  `78ee3da183e9defbc790aca2e120a0a8e4732689` (HEAD when this run started).
  Locked dependencies were installed in each tree.
- Built each tree with `NODE_ENV=production TURBO_FORCE=true
bun run build -- --force`, with production also written into its isolated
  env files. Every build reported **3 successful tasks, 0 cached tasks**.
  Pre-benchmark `jsxDEV` grep found **zero matches** in API `dist`, web
  `.output/server`, and web `.output/public/assets`.
  Full-output grep additionally found the optional development JSX API in
  current's static documentation search dependency (`hast-util-to-jsx-runtime`);
  that `/docs/_astro` code is not an HMS application/SSR development bundle.
- Historical trees shared dedicated `hms_midday_perf`, migrated and seeded
  with the after tree. Current used `hms_midday_perf_current`, migrated and
  seeded with its own tree because its schema is incompatible. Both received
  `db:seed` and `db:seed:volume` with explicit dedicated `DATABASE_URL`
  (development mode only while seeding). SQL confirmed **20,000 patients,
  1,000 catalog items, 400 active** per organization in both databases.
  The shared dev `postgres` database was not seeded, reset, or mutated.
- API/web ports: before **34100/34101**, after **34200/34201**, current
  **34300/34301**. All targets used the **same `02897d8` harness**:
  RPC 20 warmups + 200 measured sequential requests per scenario; SSR
  10 warmups + 100 single-stream requests + 300 requests at concurrency 30.
  `PERF_ROUNDS=1`; route `/mercy-general/patients`.
- Each batch used **six outer rounds**, all six permutations:
  B/A/C, A/C/B, C/B/A, B/C/A, C/A/B, A/B/C.
  Each target's RPC ran immediately before its SSR. Two complete batches
  yielded **36 target runs, 72 raw reports, zero request/document failures**.
  No samples or outlier rounds were excluded.
- Initial measurements allowed concurrent browser work. For the repeat,
  the parent requested a browser/heavy-work pause; the shared dev servers and
  OS background processes intentionally remained running. This was not a
  controlled idle host. The initial post-run resource snapshot showed an
  8 GB machine and 198,151 compressor pages (16,384 B/page). Swap counters were
  cumulative, not a measurement of swaps during the run.
- The repeat harness's Python cell timed out after 900 seconds during round
  six. Its already-written captures were retained; before's remaining SSR
  and current's RPC+SSR were then completed in order. This scheduling gap
  caused no failed capture or replacement of a completed report.

#### Median results

Values below are **medians across six per-run p95/p50 values**, not pooled
request percentiles. Ratios are after median / before median; bound ≤110%.
Only historical before/after `catalog.list` is the untouched control.

| Metric                            | Initial before / after | Ratio      | Repeat before / after | Ratio  |
| --------------------------------- | ---------------------- | ---------- | --------------------- | ------ |
| `patient.search` first page p95   | 11.527 / 12.231 ms     | 106.1%     | 62.927 / 20.263 ms    | 32.2%  |
| `patient.search` phone p95        | 55.304 / 53.356 ms     | 96.5%      | 51.243 / 34.571 ms    | 67.5%  |
| `catalog.list` p95 control        | 85.209 / 36.420 ms     | 42.7%      | 71.062 / 73.057 ms    | 102.8% |
| Patients SSR 30-way p50           | 204.953 / 231.273 ms   | **112.8%** | 505.746 / 329.841 ms  | 65.2%  |
| Patients SSR 30-way p95 (context) | 603.100 / 399.295 ms   | 66.2%      | 1546.008 / 726.788 ms | 47.0%  |

Paired after/before ratios use the same outer round. Their wide distributions
are essential evidence, not hidden outliers:

| Metric              | Initial min / median / max | Repeat min / median / max  | Repeat rounds ≤110% |
| ------------------- | -------------------------- | -------------------------- | ------------------- |
| First page p95      | 9.4% / 98.5% / 2109.8%     | 5.9% / **118.0%** / 228.4% | 2/6                 |
| Phone p95           | 12.4% / 100.7% / 1419.1%   | 2.0% / 93.8% / 264.7%      | 3/6                 |
| Catalog control p95 | 10.6% / 47.2% / 100.9%     | 29.9% / 79.0% / 1175.7%    | 4/6                 |
| Patients SSR p50    | 49.1% / 98.3% / 378.7%     | 17.6% / 76.9% / 367.8%     | 4/6                 |

The repeat first-page median paired ratio still exceeds 110%, despite its
ratio of medians passing. Thus this run does **not** show every round or
every aggregation within bound. The untouched control's 11.76× paired spike
and its large cross-batch change prevent precise 10% causal attribution on
this host. Acceptance rests on the absence of a reproducible aggregate
increase across the two production comparisons, alongside the historical
plan evidence, not on deleting slow runs or declaring the host noise-free.

#### Current HEAD context, not the adoption control

| Metric                      | Initial current median / before ratio | Repeat current median / before ratio |
| --------------------------- | ------------------------------------- | ------------------------------------ |
| First page p95              | 12.074 ms / 104.7%                    | 50.354 ms / 80.0%                    |
| Phone p95                   | 58.393 ms / 105.6%                    | 58.902 ms / **114.9%**               |
| Catalog p95 (now paginated) | 22.322 ms / 26.2%                     | 23.355 ms / 32.9%                    |
| Patients SSR p50            | 202.520 ms / 98.8%                    | 356.337 ms / 70.5%                   |

Current phone's repeat miss is recorded, not accepted as a new drift
exception or attributed to the historical adoption change. Current's
catalog has a different response size and cannot normalize that result.
Full current paired distributions are in the summary JSON.

All six benchmark servers were stopped, all three `/tmp` worktrees removed,
and both dedicated databases dropped. No application code changed.

### Historical interaction context

Context, not a bound: the catalog settings page transferred 2.82 MB before and
4.09 MB after at the seeded 1,000 rows (per-row SSR checkboxes). Superseded:
the page now renders a 50-row keyset first page with **Load more**; re-measure
the first-page transfer before quoting a size.

The optimistic flip needed a fix to meet its bound: with 1,000 rows the first
implementation re-rendered every row on the cache patch (~150 ms flip). A
memoized `CatalogRow` with a `useCallback`-pinned toggle handler brought it to
8–20 ms. The React Compiler did not stabilize the inline handler on its own.

Rollback was verified by stopping the API mid-session: the row flips back and
an error toast appears (`toggle-interaction.json`).

## Files

- `before-rpc.json` / `after-rpc.json` — `benchmark:rpc`, 4 scenarios
- `before-server-patients.json` / `after-server-patients.json` — SSR document benchmark
- `before-server-dashboard.json` / `after-server-dashboard.json` — dashboard control route
- `before-browser.json` / `after-browser.json` — Headless Chrome route metrics
- `toggle-interaction.json` — optimistic-toggle interaction samples and rollback proof
- `2026-10-04-interleaved-attempt.json` — invalid attempt method, failure and cleanup;
  explicitly records zero valid paired rounds, not a completed comparison
- `2026-10-04-discarded-development-mode-before-rpc.json` — excluded first RPC
  capture; never use its timings as production before/after evidence
- `2026-10-04-interleaved-results.json` — valid method, both batch medians,
  complete per-round ratio distributions, explicit drift decision and cleanup
- `2026-10-04-valid-{before,after,current}-round-{1..6}-{rpc,server}.json` —
  36 initial-batch raw reports
- `2026-10-04-quiet-{before,after,current}-round-{1..6}-{rpc,server}.json` —
  36 repeat-batch raw reports; “quiet” names the requested pause, not an idle host
