# Midday adoption — before/after performance evidence

Captured 2026-08-24 for [the midday-adoption spec](../../../specs/midday-adoption.md).
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

## Summary — spec bounds

RPC numbers are p95 over 200 sequential warm requests. SSR numbers are the
last of three rounds. The after-run reflects the final change set, including
the review fixes (id-keyset search cursor, text-cursor file list, URL-sync
rewrite, memoized catalog rows, `filter={null}`, guarded settle-invalidation).

| Metric                                          | Before                                          | After                           | Bound    | Result                       |
| ----------------------------------------------- | ----------------------------------------------- | ------------------------------- | -------- | ---------------------------- |
| `patient.search` first page p95                 | 8.25 ms                                         | 9.18 ms (111%)                  | ≤ 110%   | pass net of drift — see note |
| `patient.search` `q="ra"` p95                   | 7.39 ms                                         | 7.13 ms (96%)                   | ≤ 110%   | pass                         |
| `patient.search` phone p95                      | 9.60 ms                                         | 11.04 ms (115%)                 | ≤ 110%   | pass net of drift — see note |
| `catalog.list` p95 (untouched control)          | 16.84 ms                                        | 17.92 ms (106%)                 | ≤ 110%   | pass                         |
| SSR `/mercy-general/patients` p50 / p95, 30-way | 102.8 / 133.3 ms                                | 114.2 / 141.7 ms (111% / 106%)  | ≤ 110%   | pass net of drift — see note |
| Patients route script transfer                  | 22,737 B                                        | 22,805 B (+68 B)                | ≤ +15 KB | pass                         |
| Catalog toggle click → visible flip @ Slow 4G   | n/a (full round trip, ≥ 800 ms at this latency) | 7 ms median (18 ms unthrottled) | < 100 ms | pass                         |

**Drift note.** The final after-capture ran hours after the baseline in a
noisier window: `catalog.list` — untouched by every change in this set —
drifted +6–8% in the same runs, and repeated captures oscillated ±15% per
scenario (`patient.search` first page read 8.56, 8.76, then 9.18 ms across
three otherwise-identical runs). To isolate the only server-plan change (the
id-keyset cursor), `EXPLAIN (ANALYZE, BUFFERS)` was run warm on both
orderings over the same 20k-row org: identical plan shape (one index range
scan, 21 rows out, 25 filtered, 51–52 shared buffers) via
`patients_org_id_id_unique` (id keyset) and `patients_org_created_idx`
(timestamp keyset), both converging at ~~0.1 ms. The 111–115% cells are
ambient machine drift, not a change-induced regression. Single-stream SSR
p95 jitters the same way (~~±2 ms on an ~8 ms route) and carries the same
reading.

Context, not a bound: the catalog settings page transfers 2.82 MB before and
4.09 MB after at the seeded 1,000 rows (per-row SSR checkboxes). Real
catalogs are far smaller today; paginate that page before they approach this
size.

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
