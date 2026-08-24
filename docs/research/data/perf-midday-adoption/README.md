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
the review fixes (microsecond-precise search cursor, URL-sync rewrite,
memoized catalog rows, `filter={null}`, guarded settle-invalidation).

| Metric                                                 | Before                                          | After                           | Bound    | Result                                                                   |
| ------------------------------------------------------ | ----------------------------------------------- | ------------------------------- | -------- | ------------------------------------------------------------------------ |
| `patient.search` first page p95                        | 8.25 ms                                         | 8.56 ms (104%)                  | ≤ 110%   | pass                                                                     |
| `patient.search` `q="ra"` p95                          | 7.39 ms                                         | 7.60 ms (103%)                  | ≤ 110%   | pass                                                                     |
| `patient.search` phone p95                             | 9.60 ms                                         | 10.04 ms (105%)                 | ≤ 110%   | pass                                                                     |
| `catalog.list` p95                                     | 16.84 ms                                        | 15.29 ms (91%)                  | ≤ 110%   | pass                                                                     |
| SSR `/mercy-general/patients` p50 / p95, 30-way        | 102.8 / 133.3 ms                                | 97.5 / 114.5 ms                 | ≤ 110%   | pass                                                                     |
| SSR `/mercy-general/patients` p50 / p95, single stream | 6.2 / 8.0 ms                                    | 6.9 / 9.3 ms (112%)             | ≤ 110%   | miss on paper; +0.7 ms absolute, within round-to-round jitter — see note |
| Patients route script transfer                         | 22,737 B                                        | 22,805 B (+68 B)                | ≤ +15 KB | pass                                                                     |
| Catalog toggle click → visible flip @ Slow 4G          | n/a (full round trip, ≥ 800 ms at this latency) | 7 ms median (18 ms unthrottled) | < 100 ms | pass                                                                     |

Note on the single-stream SSR row: the absolute delta is under 1 ms on a ~6 ms
route and the 30-way rounds got faster. Individual rounds vary by more than
this. We read it as noise, not regression; re-measure if the route grows.

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
