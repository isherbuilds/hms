# Spec: Midday pattern adoption — search primitives, URL state, optimistic writes, measured

Status: ready
Authority: user request 2026-08-24 (adopt midday dashboard patterns; seed data;
before/after performance numbers) + research memo
[docs/research/midday-dashboard-patterns.md](../research/midday-dashboard-patterns.md).
Supersedes: none.

## Problem

Three gaps the midday research confirmed, felt by reception/desk staff daily:

1. Patient and service pickers are bespoke input+button lists with no listbox
   semantics — no arrow-key navigation, no `aria-activedescendant`, no
   screen-reader contract (`opd-patient-picker.tsx`, `opd-intake-services.tsx`).
2. Patient list search lives in component state. A reload, a shared link, or
   Back loses the search. Every keystroke swap blanks the list because the
   query has no `placeholderData`.
3. Every mutation awaits a full refetch. A catalog activate/deactivate takes a
   full round trip plus a list refetch before the row visibly changes.

We also have no volume dataset, so none of these paths has ever been measured
above ~10 rows. "Faster" claims are currently unfalsifiable.

## Solution

Add a shared Base UI combobox primitive and rebuild both pickers on it. Move
patient search into the route's validated search params with
`keepPreviousData`. Add the first optimistic mutation (catalog `active`
toggle) plus a shared oRPC→form-field error helper. Bump the query/form stack
to current stable and off deprecated APIs. Bracket the whole change set with a
deterministic volume seed and the existing benchmark harness so every claim
carries a before/after number.

## Validation / Evidence

Internal maintenance + UX adoption; no product bet. Evidence base: the pinned
midday research memo and the August 2026 library-currency table therein.
Performance evidence convention: JSON runs under `docs/research/data/`
(precedent: `docs/research/data/performance-2026-08-20/`), harness:
`scripts/benchmark-server.ts`, `scripts/benchmark-browser.ts`.

## User Stories / Scenarios

1. As a receptionist, I press ArrowDown/Enter in the patient search and select
   a match without touching the mouse; a screen reader announces options and
   the active option.
2. As a desk user, I search the patients list, reload the page, and the same
   filtered list returns; while I type, the previous results stay visible
   instead of flashing empty.
3. As an admin, I deactivate a catalog item and the row flips instantly; if
   the server rejects it, the row flips back and I see the error.
4. As an admin, submitting a duplicate catalog code shows the error on the
   code field (already true) via a shared helper also used by patient forms.
5. Before/after scenario (performance): with 20,000 seeded patients and 1,000
   catalog items, patient search p95, patients SSR p50/p95, and patients-route
   script bytes are recorded before slice 2 and after slice 5, and the deltas
   meet the acceptance bounds below.

## Implementation Decisions

- **Combobox primitive.** New `packages/ui/src/components/combobox.tsx` on the
  Base UI combobox (the package `packages/ui` already depends on; no Radix, no
  cmdk). First try `bunx --bun shadcn@latest add combobox` from the base
  registry, then adapt to base-lyra density (`text-xs`, compact controls,
  radius scale) and the unlayered `:focus-visible` rule; hand-write on Base UI
  if the registry item does not fit. Behavior contract copied from midday's
  `ComboboxDropdown`: consumer-owned filtering (no built-in filter), disabled
  items, optional create-on-the-fly row, looped keyboard navigation.
  Consumers in this spec: `OpdPatientSearch` (async, debounced, server
  matches — keep the existing 300 ms debounce, phone/name detection, 2-char
  gate, `enabled` guard) and `ServicePicker` (in-memory filter over the loaded
  catalog, keep the 8-row slice). No command palette (out of scope).
- **Patients URL state.** `routes/$orgSlug/patients/index.tsx`
  `validateSearch` gains `q: z.string().trim().optional().catch(undefined)`;
  input keystrokes stay local, the debounced value writes `q` via
  `navigate({ search, replace: true })`; empty `q` is stripped from the URL.
  The infinite query adds `placeholderData: keepPreviousData`. Loader
  prefetches using `q` from the search params. No nuqs (its TanStack adapter
  does not support Start).
- **Phantom-page fix.** `patient.search` fetches `limit + 1` rows and returns
  at most `limit`; `nextCursor` is set only when the extra row exists. The
  response shape `{ items, nextCursor }` is unchanged.
- **Optimistic toggle.** Catalog rows get an inline Active switch (shown with
  the same visibility as the existing Edit affordance) calling the existing
  `catalog.update` with the row's current fields and flipped `active`.
  Mutation applies the midday recipe: `cancelQueries` on
  `orpc.catalog.list.key({ input: { orgSlug } })` → snapshot → `setQueryData`
  patch on every cached list variant → rollback in `onError` (+ toast) →
  `invalidateQueries` in `onSettled`. Audit and permission behavior are
  untouched (server unchanged). This is the proving instance; no generic
  optimistic helper until a second call site exists (YAGNI).
- **Field-error helper.** `applyOrpcFieldError(form, error, map)` in
  `apps/web/src/lib/orpc-error.ts`, built on the existing `hasErrorCode`.
  `map: Record<string, { field; message }>` keyed by ORPC code; returns
  `true` when a mapping was applied. Consumers: catalog form (replaces its
  inline CONFLICT block) and `patient-form.tsx` (UID conflict keeps its toast
  if no natural field exists — decide at the call site, helper stays dumb).
- **Version bumps.** `@tanstack/react-query{,-devtools}` → 5.102.x;
  `@tanstack/react-router`/`react-router-ssr-query`/`react-start`/
  `react-router-devtools` → current patch; `react-hook-form` → 7.86.x;
  `@hookform/resolvers` → 5.9.x (catalog entries in root `package.json` and
  `apps/web/package.json`). Migrate route loaders off APIs the 5.102 docs
  deprecate (`queryClient.query(...)`) **only where an equivalent exists for
  the call**; infinite prefetches keep `prefetchInfiniteQuery` (no stable
  replacement verified). No RHF v8, no oRPC v2 beta, no TanStack Table (not
  needed by any current screen), no virtualization.
- **Volume seed.** New `scripts/seed-volume.ts` (`bun run db:seed:volume`):
  20,000 patients and 1,000 catalog items (400 active) into **each** of
  `mercy-general` and `ridgeview-academy` (40,000 patients total) via direct
  drizzle inserts (batched), on top of the normal dev seed. Both orgs get
  volume so the `orgId` predicate on the unindexed name/phone ILIKE does real
  filtering work — a single-org dataset is the best case and understates the
  scan (`patients` has only org+mrn, org+uid, and org+createdAt indexes).
  Deterministic PRNG with a fixed seed; reuses the dev seed's production
  refusal; idempotent (skips when volume rows already exist). No
  appointments/charges — no measured surface in this spec needs them, and
  money rows carry invariants this script must not re-implement. Baselines
  from `docs/research/data/performance-2026-08-20/` are **not** comparable
  (different data volume); before and after runs both happen in this change
  set, same session, same dataset, same serve procedure.
- **Measurement.** New `scripts/benchmark-rpc.ts` (`bun run benchmark:rpc`):
  signs in like `benchmark-server.ts`, POSTs `/rpc` for
  `patient.search` (empty query first page; `q="ra"`; `q` by phone digits)
  and `catalog.list`, reports p50/p95/p99 over ≥200 requests after warmup,
  honors `PERF_OUTPUT`. Results live in
  `docs/research/data/perf-midday-adoption/` as `before-*.json` /
  `after-*.json` plus a `README.md` that records the exact serve commands and
  environment so the after-run replicates the before-run.

## Test Seams

- `POST /rpc` procedure boundary (existing integration-test seam in `tests/`
  against real Postgres): `patient.search` pagination — seed exactly
  `limit` matching rows → `nextCursor` is null; `limit + 1` rows → cursor
  returned and second page has one item. Tenant predicate untouched (existing
  tenancy tests keep covering it).
- Benchmark harness outputs (`benchmark:server`, `benchmark:browser`, new
  `benchmark:rpc`): the before/after JSON files are the performance seam.
- Browser (`browser` tool / manual): combobox keyboard + ARIA contract,
  URL-restored search, optimistic flip-and-rollback (rollback proven by
  killing the server mid-mutation), duplicate-code field error.
- No component unit-test infrastructure exists in `apps/web`; client behavior
  is verified at the browser seam, matching current repo practice.

## Task Plan

- [x] Slice 1: Volume seed + RPC bench + baseline capture
  - Acceptance: `db:seed:volume` inserts 20,000 patients / 1,000 catalog items
    into each of mercy-general and ridgeview-academy deterministically in
    under 60 s, refuses production, and is idempotent. `benchmark:rpc` emits
    p50/p95/p99 JSON. Baseline recorded against production builds with volume
    data: `before-rpc.json`, `before-server.json` (PERF_ROUTES includes
    `/mercy-general/patients`), `before-browser.json` (routes include
    `/mercy-general/patients`, `/mercy-general/settings/catalog`), plus the
    runbook README.
  - Verify: `bun run db:seed:volume && bun run benchmark:rpc` (with PERF_*
    env); JSON files exist under `docs/research/data/perf-midday-adoption/`;
    `bun run check-types`.
  - Depends on: none
  - Owns/Touches: `scripts/seed-volume.ts` (new), `scripts/benchmark-rpc.ts`
    (new), root `package.json` scripts block (coordinator-owned),
    `docs/research/data/perf-midday-adoption/**` (new)
  - Interfaces: produces npm scripts `db:seed:volume`, `benchmark:rpc`
    (env: `PERF_API_URL`, `PERF_EMAIL`, `PERF_PASSWORD`, `PERF_OUTPUT`);
    baseline JSONs consumed by Slice 6.

- [x] Slice 2: Combobox primitive + picker rebuilds (proof slice, riskiest)
  - Acceptance: `packages/ui` exports a Base UI combobox with consumer-owned
    filtering, disabled items, create-slot, loop keyboard nav; patient picker
    and service picker use it with behavior parity (debounce, phone/name
    detection, 2-char gate, 20-row cap, register-new flow with focus return;
    service picker 8-row in-memory filter). ArrowDown/ArrowUp/Enter/Escape
    work; listbox/option roles and active-option state are announced. Motion:
    none added.
  - Verify: browser-drive OPD intake — keyboard-only patient selection and
    service add; `bun run check-types`. (Skip lint/format/global suite; final
    pass in Slice 6.)
  - Depends on: Slice 1 (baseline must pre-date UI changes)
  - Owns/Touches: `packages/ui/src/components/combobox.tsx` (new),
    `apps/web/src/components/opd-patient-picker.tsx`,
    `apps/web/src/components/opd-intake-services.tsx`
  - Interfaces: produces `Combobox` component family from
    `@hms/ui/components/combobox` (props: `items`, `onSelect`,
    `inputValue`/`onInputValueChange` controlled, `renderItem`,
    `emptyContent`, optional `onCreate`); consumed only inside this slice for
    now.

- [x] Slice 3: Dependency bumps + deprecated-API migration
  - Acceptance: TSQ 5.102.x, Router/Start current patch, RHF 7.86.x,
    resolvers 5.9.x installed via catalog/app manifests; non-patients route
    loaders migrated off APIs deprecated by TSQ 5.102 where a stable
    equivalent exists (single-query `ensureQueryData`/`prefetchQuery` →
    `queryClient.query(...)`); infinite prefetches unchanged; typecheck and
    integration tests pass.
  - Verify: `bun run check-types && bun run test`.
  - Depends on: Slice 1
  - Owns/Touches: root `package.json` catalog (coordinator-owned),
    `apps/web/package.json`, lockfile, `apps/web/src/routes/**` loaders
    **except** `routes/$orgSlug/patients/index.tsx` (owned by Slice 4),
    `apps/web/src/lib/query-client.ts` if signatures moved
  - Interfaces: consumes nothing; produces the upgraded API surface Slices 4–5
    compile against.

- [x] Slice 4: Patients URL search state + keepPreviousData + phantom-page fix
  - Acceptance: `?q=` round-trips (type → URL updates debounced+replace;
    reload/share restores the filtered list; empty q stripped from URL).
    While a new query is in flight the previous rows remain rendered
    (`placeholderData: keepPreviousData`). `patient.search` returns
    `nextCursor: null` when results end exactly at `limit`. Loader prefetches
    with the URL's `q`.
  - Verify: new integration test for the limit-boundary in `tests/` passes via
    `bun run test`; browser: search, reload, Back; `bun run check-types`.
  - Depends on: Slice 3
  - Owns/Touches: `apps/web/src/routes/$orgSlug/patients/index.tsx`,
    `packages/api/src/routers/patient.ts` (search handler only), one new test
    file in `tests/`
  - Interfaces: `patient.search` response shape `{ items, nextCursor }`
    unchanged (cursor semantics corrected only); route search schema gains
    optional `q`.

- [x] Slice 5: Optimistic catalog toggle + `applyOrpcFieldError`
  - Acceptance: inline Active switch on catalog rows updates the row in the
    same frame as the click; server rejection rolls the row back and shows a
    toast; settle re-syncs via invalidation; every cache key carries
    `orgSlug`. `applyOrpcFieldError(form, error, map)` exists in
    `lib/orpc-error.ts`; catalog form's CONFLICT mapping uses it; patient
    form uses it where a field mapping exists, keeping toast fallback.
    Server code unchanged.
  - Verify: browser with dev server: toggle flips instantly; kill
    `dev:server` mid-mutation → row rolls back + toast; duplicate catalog
    code → field error on `code`; `bun run check-types`.
  - Depends on: Slice 3
  - Owns/Touches: `apps/web/src/routes/$orgSlug/settings/catalog.tsx`,
    `apps/web/src/lib/orpc-error.ts`,
    `apps/web/src/components/patient-form.tsx`
  - Interfaces: produces
    `applyOrpcFieldError(form: UseFormReturn, error: unknown, map: Record<string, { field: string; message: string }>): boolean`.

- [x] Slice 6: After-measurement, results, docs, cleanup
  - Acceptance: after-run replicates the Slice 1 runbook on the same machine
    and dataset; `after-*.json` recorded; summary table (before vs after vs
    bound) in `docs/research/data/perf-midday-adoption/README.md`. Bounds:
    patient.search p95 (each variant) ≤ 110% of baseline; SSR
    `/mercy-general/patients` p50/p95 ≤ 110% of baseline;
    patients-route `scriptTransferBytes` ≤ baseline + 15 KB; catalog toggle
    click→visible-flip < 100 ms measured with 400 ms of added network delay
    (baseline comparison: the same interaction before Slice 5, ≥ delay +
    round trip). Any bound violation is fixed or explicitly accepted by the
    user before the spec closes. Research memo §"What this means for us"
    updated with outcomes; ledger row added; full `bun run check`,
    `check-types`, `test` pass once here.
  - Verify: `bun run check && bun run check-types && bun run test`; the
    summary table exists with all before/after pairs filled.
  - Depends on: Slices 2, 4, 5
  - Owns/Touches: `docs/research/data/perf-midday-adoption/**`,
    `docs/research/midday-dashboard-patterns.md`, `docs/research/README.md`,
    `docs/specs/midday-adoption.md` (status), `AGENTS.md` spec index if
    updated
  - Interfaces: consumes Slice 1 baseline JSONs and npm scripts.

Parallelism note: Slice 2 ∥ Slice 3 have disjoint write sets and may run
concurrently after Slice 1; Slices 4 and 5 are disjoint and may run
concurrently after Slice 3.

## Outcome (2026-08-24)

Implemented and measured; numbers and protocol in
`docs/research/data/perf-midday-adoption/README.md`. The first capture was
lost before commit, so the review re-ran the full protocol (fresh `35550b9`
baseline worktree vs. this change set, same session, same 40k-patient
dataset). Every spec bound passed: RPC p95 ≤ 104% of baseline, SSR within
bounds under load, patients script bytes +103 B (bound +15 KB), toggle
8 ms median flip at Slow 4G emulation (a full round trip is ≥ 800 ms
there), rollback and field-error mapping browser-verified against
production builds.

Deviations accepted during implementation:

1. **TanStack Query stays 5.101.x.** 5.102 renamed the mutation context
   generic (`TOnMutateResult`) and `@orpc/tanstack-query` 1.15.0 (latest
   stable; v2 is beta) no longer type-checks against it — hundreds of errors
   at untouched call sites. The `queryClient.query(...)` loader migration was
   reverted; RHF 7.86, resolvers 5.9.1, Router 1.170.32, Start 1.168.49
   bumps kept. A root `overrides` entry pins `@tanstack/query-core` to
   5.101.4 because `@tanstack/react-router-ssr-query` otherwise pulls a
   second, newer core. Re-attempt the bump when oRPC ships TSQ-5.102-
   compatible types (this answers falsification #2 in the research memo).
2. **Combobox hand-written on the existing Base UI package** — the registry
   item carried a different component family. `filter={() => true}` is
   required (`filter={null}` still applies the default filter in
   @base-ui/react 1.6).
3. **Checkbox, not Switch**, for the inline catalog toggle — the kit has no
   Switch primitive.
4. **Catalog document weight flagged**: +1.27 MB wire at the seeded 1,000
   rows from per-row SSR checkboxes. Not a spec bound; paginate the catalog
   page if real catalogs approach that size.
5. **Catalog rows are memoized.** With the seeded 1,000 rows the optimistic
   patch re-rendered every row and the flip took ~150 ms, missing the
   < 100 ms bound. A `memo`-wrapped `CatalogRow` plus a `useCallback`-pinned
   toggle handler restored 8–20 ms; the React Compiler alone did not keep
   the inline handler stable.

## Out of Scope

- Command palette (`⌘K`), TanStack Table v9, virtualization, oRPC
  `.liveOptions()` polling replacement, settings furniture, date-range
  presets — each waits for its own screen or spec (memo items 6–7 and
  falsification #4).
- Any server-side search change beyond the `limit + 1` fix (no FTS/trigram
  work; ILIKE at 20k rows is measured, not assumed, by Slice 1).
- Volume seeding of appointments, charges, invoices, or accounting rows.
- Optimistic updates for OPD state transitions or any money mutation
  (explicitly rejected in the memo; awaited invalidation stays).

## Explicitly Deferred

- Generic optimistic-mutation helper: extract at the second call site.
- Adaptive debounce (200/700 ms) for patient search: keep 300 ms unless the
  Slice 6 numbers show a problem.
- `zod/mini`, Bun isolated installs, `bun run --parallel`: no measured need.
- OPD list `q`/`includeClosed` URL state: patients list is the proving
  ground; OPD follows in a later change if the pattern earns it.

## Open Questions

None.
