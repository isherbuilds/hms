# Midday dashboard patterns for HMS

Temporary research memo (large observation set; see ledger policy). Promote
accepted conclusions to the ledger/decision log, then delete this file.

**Source pin:** `midday-ai/midday` `main` at commit
[`5158731`](https://github.com/midday-ai/midday/commit/51587319f26a0ffaa9dfccab1920373cb65689b7).
All midday paths below refer to that commit. HMS paths refer to this repo on
2026-08-24. Library claims are version-pinned in §7. We have written
permission from the midday creators to copy components verbatim; license is
not a constraint.

## Question

What can we take from midday's dashboard (search, combobox/command, tables,
data layer, forms, dates, auth/onboarding, settings, styling) to make HMS
better, faster, and smaller — and where are midday's 2024-era patterns already
behind the current (Aug 2026) releases of TanStack Query/Router/Start, oRPC,
react-hook-form, and Zod?

## Answer

Copy midday's **state architecture, cache algorithms, and interaction math —
not its components**. Midday is Next.js RSC + Radix + nuqs + Tailwind 3 + Zod
v3 + TanStack Table v8; HMS is TanStack Start + Base UI + Tailwind 4 + Zod 4.
Verbatim copy-paste works only for primitive-free pieces (hooks, cache
transactions, date math, schemas, layout composition). Every Radix-backed
component needs a Base UI port, and every nuqs hook maps to Router-native
`validateSearch`.

Our data layer is already **ahead** of midday's in four places: keyset cursors
(midday's "cursor" is a stringified SQL offset), awaited org-scoped
invalidation, React Compiler enabled, and permission-guarded procedures
(midday leaves `team.update`, `team.invite`, `team.delete`, and API-key CRUD
on membership-only middleware). Do not regress to their versions of these.

The real gaps midday exposes in HMS, in priority order:

1. **No accessible combobox/command primitive.** Our pickers are bespoke
   input+buttons without listbox semantics.
2. **No optimistic updates anywhere.** Every mutation awaits refetch.
3. **URL filter state is partial.** Table filters/sort are local component
   state; not shareable or restorable.
4. **No column model.** Fine today; adopt TanStack Table **v9** (not midday's
   v8 pattern) when a screen earns visibility/selection/resize.
5. **Ad-hoc server-error→field mapping** (midday has the same flaw; both
   should centralize a tiny CONFLICT→`setError` helper).

## 1. Search, command palette, combobox

**What midday does** (`apps/dashboard/src/components/search/*`,
`packages/ui/src/components/combobox-dropdown.tsx`, cmdk 1.1.1):

- Global `⌘K` modal: Zustand open-store, `Command shouldFilter={false}`,
  server supplies matches, groups by entity type, appends local "Create …"
  actions, context-aware ordering (running timer floats its group first).
- **Adaptive debounce:** 200 ms one-word, 700 ms multi-word
  (`search/search.tsx`). `placeholderData: (prev) => prev` keeps old results
  visible; a 2 px fetching line replaces spinners.
- `ComboboxDropdown<T>`: Popover + cmdk, own `includes` filter, `loop`
  keyboard nav, create-on-the-fly row when no match (`select-category.tsx`
  creates, invalidates, selects in one round trip).
- Selectors prefetch whole lists (first 100 customers) and filter in memory;
  no per-keystroke server query, no virtualization.
- Backend list search: `buildSearchQuery` escapes FTS operators, adds `:*`
  prefix per token, ORs FTS with `ILIKE`, always under the tenant predicate
  (`packages/db/src/utils/search-query.ts`, `queries/customers.ts`). The
  global `global_search` SQL function body is **not in the repo** — its
  ranking cannot be copied. Multi-word empty results fall back to
  `gpt-4o-mini` filter extraction — skip that.

**What we have:** `OpdPatientSearch` debounces 300 ms, phone/name detection,
20-row cap, hides stale results while raw ≠ debounced
(`apps/web/src/components/opd-patient-picker.tsx:31-58`) — but plain `<ul>`
of buttons, no combobox roles, no arrow keys. `ServicePicker` same shape.
`packages/ui` has **no** command/combobox/popover primitive.

**Adopt:**

- Add shared `combobox` + `command` primitives from the shadcn **base**
  registry (our kit is base-lyra; the base registry ships Base UI-backed
  Command/Combobox — check with `bunx --bun shadcn@latest search`/`add`
  before writing custom UI). Then rebuild `OpdPatientSearch` and
  `ServicePicker` on them; keep our debounce/phone logic.
- Copy the `ComboboxDropdown` API shape: `shouldFilter=false` + own filter,
  disabled items, create-on-the-fly slot, `renderListItem({ isChecked })`.
- Add `placeholderData: keepPreviousData` to patient search queries; adopt
  adaptive debounce only if 300 ms proves noisy.
- A `⌘K` palette is **optional** for an all-day console with stable nav
  (ledger: navigation favors fixed destinations). If added: patient-first,
  server-owned matches, our FTS+ILIKE pattern; no LLM fallback.

**Skip:** cmdk itself (Radix-世界), Zustand for open state (a route search
param or local state suffices), midday's missing min-char guard (they query
on empty string; keep our `enabled: length >= 2`).

## 2. Tables and lists

**What midday does** (`components/tables/transactions/*`,
`tables/core/virtual-row.tsx`, `hooks/use-table-settings.ts`):

- TanStack Table v8 with **only `getCoreRowModel`** — filtering and sorting
  are server-side via query input; the table is a pure column/selection/
  visibility model.
- Column defs carry `meta` (sticky, skeleton shape, className); cells call
  stable callbacks through memoized `table.options.meta`; shift-click range
  selection.
- `@tanstack/react-virtual` rows (45 px estimate, overscan 10), `memo`'d
  `VirtualRow` with custom comparator + `contain: layout style paint`.
- Infinite loading keyed off the **last rendered virtual row index**, not
  scroll pixels (`hooks/use-infinite-scroll.ts`).
- Column visibility/size/order in a unified 10-year cookie so the SSR
  skeleton matches final geometry.
- **Weaknesses:** cursor is a decimal-string SQL offset; `hasNextPage =
fetched === pageSize` (phantom last page on exact multiples); any active
  filter switches to `pageSize: 10000` — virtualization hides DOM cost but
  the client still holds 10 k rows.

**What we have:** oRPC `infiniteOptions` with compound keyset cursors
(`{createdAt,id}`, `{dayOrderAt,id}`), loader `prefetchInfiniteQuery`,
explicit Load-more buttons, semantic `Table` only
(`apps/web/src/routes/$orgSlug/patients/index.tsx:24-55`,
`packages/ui/src/components/table.tsx`). No column model, no virtualization.

**Adopt:**

- Keep keyset cursors — strictly better than midday's offset cursors, and
  the ledger already mandates stable keysets. Fetch `limit+1` (we should
  verify we do; midday's exact-multiple bug is a cautionary case).
- When a screen needs column visibility/selection/bulk actions (billing
  worklist, reports): TanStack Table **v9** (`useTable` + explicit
  `features`, TanStack Store subscriptions — §7), with midday's division of
  labor: core row model only, server sort/filter, `meta`-carried callbacks.
- Copy the empty-state triad: no-data vs no-results(filters) vs
  work-complete (`empty-states.tsx`) — cheap and high-value for OPD/billing.
- Virtualize only after measuring; our pages are 20–100 rows. If adopted,
  copy the virtual-row-index load-more trigger and the `memo` comparator.
- Persist column settings per org+user (cookie or server), never bare keys —
  midday scopes localStorage by `teamId` (`use-latest-project-id.ts`); ours
  must scope by org.

**Skip:** `pageSize: 10000` under filters; DnD column reorder until asked;
sticky-column CSS-variable machinery until a wide table exists.

## 3. Data layer: query, mutations, invalidation

**What midday does** (`src/trpc/*`, `transaction-details.tsx`,
`notification-setting.tsx`, `hooks/use-team.ts`):

- tRPC 11 + TSQ 5.95: generated `queryOptions`/`infiniteQueryOptions`/key
  factories; zero hand-built key tuples; RSC `prefetch`/`batchPrefetch` +
  `HydrateClient` with **pending-query dehydration** (fire, don't await,
  stream into hydration).
- Canonical optimistic transaction: `cancelQueries` both keys → snapshot →
  `setQueryData` detail **and** every infinite page → rollback on error →
  `invalidateQueries` on settle. Cleanest minimal instance is the
  notification toggle; `useTeamMutation` is the reusable partial-merge form.
- No global mutation-toast policy; per-feature choice of silent rollback /
  success toast / code-specific field error.

**What we have:** the same seam, already org-scoped:
`createTanstackQueryUtils` singleton with request-keyed `WeakMap` SSR context
(`apps/web/src/lib/orpc.ts:12-49`), `.key({input:{orgSlug}})` prefix
invalidation, awaited domain invalidators
(`lib/domain-invalidation.ts`), `OPERATIONAL_REFETCH` polling policy,
conflict toast helper (`lib/opd-operational-query.ts`). **Zero optimistic
updates.**

**Adopt:**

- The cancel/snapshot/patch/rollback/invalidate sequence for **frequent,
  reversible, low-stakes** toggles only (e.g. a settings switch, tag/flag
  edits). Every key in the sequence must carry `orgSlug`. Do **not** apply it
  to OPD state-machine transitions or money — our awaited invalidation +
  CONFLICT toast is the correct discipline there (decision-adjacent; rollback
  cannot restore multi-view operational truth).
- `useTeamMutation`-style partial-merge optimistic hook for org settings
  (`setQueryData(key, old => ({...old, ...patch}))`).
- Centralize the remaining inline invalidations (patients, catalog) into
  `domain-invalidation.ts` siblings — we already proved the pattern for
  OPD/billing.

**Skip:** midday's fire-and-forget `invalidateQueries` (weaker than ours);
SuperJSON (oRPC serializes natively); their per-request server QueryClient
pattern (Start's `setupRouterSsrQueryIntegration` already owns hydration,
`apps/web/src/router.tsx:13-34`).

## 4. Forms

**Midday** (`hooks/use-zod-form.ts`, `forms/product-form.tsx`,
`invoice/form-context.tsx`, `forms/transaction-edit-form.tsx`):

- Same `useZodForm` seam we have; ours has the better `z.input`/`z.output`
  generics — keep ours.
- CONFLICT→`form.setError("name", …)` mapping is local per form; **no
  generic mapper exists in midday either.**
- Debounced-autosave editor: local state + `useDebounceValue(500)` +
  compare-to-server before mutate; invoice editor keeps a **serialized
  baseline in a store and advances it only after all writes in the save
  cycle succeed** — the one autosave invariant worth remembering.
- Explicit save + `!form.formState.isDirty` disable for normal forms.

**Adopt:** a ~15-line `applyOrpcFieldError(form, error, map)` helper wrapping
our `hasErrorCode` (`lib/orpc-error.ts`) so catalog/patient forms stop
hand-rolling CONFLICT mapping. Keep explicit save; no autosave in clinical/
financial forms without a decision.

**New-API note (§7):** RHF `subscribe()` (≥7.55) for non-render side effects;
we already use `useFormState({name})` correctly in `packages/ui` form.tsx.

## 5. Dates, calendar, settings, auth

**Dates** (midday `date-range-filter.tsx`, `utils/date.ts`,
`packages/invoice/src/utils/recurring.ts`):

- Copy the **date-only boundary discipline**: serialize as
  `formatISO(d, {representation:"date"})`, one canonical parse rule. Midday
  itself mixes local `parseISO` (filters) with UTC `TZDate` (tracker) —
  adopt one rule, not their mix. For true date-only fields prefer a Postgres
  `date` column + `YYYY-MM-DD` string over their UTC-midnight-timestamp
  helper.
- Date-range presets list (`utils/date-presets.ts`: this/last month, quarter,
  YTD, last year, 30/60/90d) is directly copyable for reports.
- `Calendar` = react-day-picker 9.8 wrapper, Radix-free — copyable if we ever
  need a range calendar (new dep: `react-day-picker`); the enclosing
  Popover/Select must be Base UI.
- Tracker's 15-min slot math and single global `setInterval` timer store are
  clean but out of HMS scope today.

**Settings/access** (midday `settings/*`, `tables/members/*`):

- Copy: `SecondaryMenu` (primitive-free exact-path underline nav), one card
  per concern with explicit Save, typed-`DELETE` danger-zone confirm,
  one-time-secret modal + `CopyInput` pattern, members table carrying
  `currentUser`/`totalOwners` in table meta with last-owner protection.
- **Do not copy their authorization posture.** Role checks are inline in two
  procedures; invite/update/delete-team and API keys are membership-only.
  Our `orgProcedure(permission)` + `access.ts` model is categorically
  stronger and stays authoritative (hard rules 2 and 5).
- Their notification-toggle optimistic pattern is the best first candidate
  if we add per-user notification settings.

**Auth/onboarding** (midday `login/*`, `use-onboarding-step.ts`): mostly N/A
(we have operator-created accounts, no public signup — D006). Worth taking:
provider-as-data config + one generic button, last-used cookie (not
localStorage), `input-otp` slot UI if we ever add OTP/MFA, and the onboarding
clamp idea — URL step key clamped between earliest incomplete **required**
milestone and max, durable milestones in the DB. Their OTP flow swallows
errors and has no resend cooldown — anti-pattern, don't copy.

## 6. Styling, bundle, performance

**Midday:** Tailwind **3** preset, `next/font` two families,
`optimizePackageImports` for icon/motion/chart libs, `sideEffects:false` +
per-file exports in packages/ui, five `next/dynamic` boundaries (PDF viewer,
maps autocomplete ≈200 KB, lottie, global sheets), IntersectionObserver-gated
PDF thumbnails with an in-memory cache, `lazy-chart` (render charts only near
viewport), `use-scroll-header` (RAF-coalesced CSS-variable writes, zero
re-renders per scroll), Recharts with `isAnimationActive={false}`. React
Compiler installed but **not enabled**.

**We already have:** Tailwind 4, React Compiler on, Nitro gzip+brotli,
ExcelJS dynamic import (`lib/report-export.ts:7-10`), rationed motion.

**Adopt:** dynamic-import any future heavy viewer (PDF preview for `file`
domain is the obvious next case — copy the IntersectionObserver + cache
gating from `pdf-thumbnail.tsx`); `lazy-chart` idea if the dashboard grows
below-fold charts; `use-scroll-header` only if we add a hiding header. Add
route-level code splitting only after inspecting the actual client chunks —
our routeTree imports are static but Start may split at build; **measure
first** (ledger: rejected micro-optimizations stay rejected).

**Skip:** framer-motion anything (17 marketing animations, TextMorph,
AnimatedSizeContainer), NumberFlow animated KPIs, their font/icon setup
(ours is settled).

## 7. Library currency — where midday's patterns are already stale

Verified 2026-08-23/24 against owning sources; HMS versions from
`package.json` catalogs.

| Library               | Midday uses      | Current stable                   | HMS              | Delta that matters                                                                                                                                                |
| --------------------- | ---------------- | -------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TanStack Query        | 5.95.2           | **5.102.1** (2026-08-23)         | 5.101.4          | 5.102 adds `queryClient.query(...)`; docs deprecate `prefetchQuery`/`ensureQueryData` for v6 removal. `streamedQuery` stable.                                     |
| TanStack Router/Start | n/a (Next.js)    | 1.170.32 / 1.168.49              | one patch behind | `validateSearch` takes Zod 4 directly; `retainSearchParams`/`stripSearchParams` middleware = nuqs `clearOnDefault` equivalent. Start officially still **RC**.     |
| oRPC                  | n/a (tRPC 11.16) | **1.15.0**                       | 1.15.0           | `.streamedOptions()`/`.liveOptions()` (experimental) for event iterators; exact vs prefix key helpers. v2 is beta — skip.                                         |
| react-hook-form       | 7.x + Zod **v3** | **7.86.0**; v8 still beta        | 7.85.0           | `subscribe()`/`createFormControl` (≥7.55) for render-free observation. Stay on 7.                                                                                 |
| @hookform/resolvers   | 3.x-era          | **5.9.1**                        | 5.8.0            | 5.x split input/output inference — our `useZodForm` generics already model this.                                                                                  |
| Zod                   | v3 (`zod/v3`)    | **4.4.3**                        | 4.4.3            | We are current; midday's schemas need translation when copied (error API, `.default()` semantics, `.merge()`→`.extend()`).                                        |
| TanStack Table        | v8               | **9.1.2** (v9 stable 2026-08-04) | not used         | v9: `useTable` + explicit `features`, TanStack Store, per-table meta typing, ESM-only. Start on v9 if adopted.                                                    |
| TanStack Virtual      | 3.x              | 3.14.10                          | not used         | `anchorTo:'end'` for log-like lists. Conditional.                                                                                                                 |
| nuqs                  | 2.8.9            | 2.10.0                           | not used         | TanStack Router adapter exists but is **experimental and does not support Start**; nuqs' own docs point Router users to native search APIs. **Do not introduce.** |
| Tailwind              | 3.4              | 4.x                              | 4.3.3            | Their preset/config is not portable; only class lists are.                                                                                                        |
| Bun                   | n/a              | **1.4.0** (2026-08-20)           | 1.4              | `bun run --parallel`, test sharding, isolated installs + global virtual store, `bun audit fix`. Selective; Turborepo stays.                                       |

Actionable version work: RHF 7.86 + resolvers 5.9.1 (done 2026-08-24).
**Superseded (2026-08-24): the TSQ 5.102 bump failed** — 5.102 renamed the
mutation context generic (`TOnMutateResult`) and `@orpc/tanstack-query`
1.15.0 no longer type-checks against it; HMS stays on 5.101.x with a
`@tanstack/query-core` override until oRPC ships compatible types (see
`docs/specs/midday-adoption.md` §Outcome). Evaluate `.liveOptions()` as a
replacement for the 10-second OPD polling (`lib/operational-query.ts`) —
that is a spec-level change, not a drive-by.

## What this proves / does not prove

**Proves:** midday's concrete implementations at one pinned commit; current
library versions and documented APIs at retrieval date; exact HMS state at
cited files. The gap list (§ Answer) is grounded in both trees.

**Does not prove:** that any pattern improves HMS's measured latency or
bundle (no benchmarks were run; midday itself ships no bundle report — its
only number is a code comment claiming ~200 KB saved on maps). Does not prove
midday's global-search ranking quality (SQL function body absent from repo).
Does not prove `zod/mini` works with oRPC (no owning-source statement).
"Written permission to copy" is taken as user-supplied fact; it removes
license risk, not porting cost.

## What this means for us

Recommended order (each item is a separate small spec/PR, not one migration):

1. **Combobox/command primitives** from the shadcn base registry; rebuild
   patient/service pickers on them. Biggest UX+a11y gap.
2. **Version bumps + loader API migration** (TSQ 5.102 `queryClient.query`,
   RHF 7.86/resolvers 5.9.1). Mechanical.
3. **Router-native URL filter state** for patients/OPD/billing lists:
   `validateSearch` + `stripSearchParams` defaults; commit-on-submit search;
   `useDeferredValue` into the query input; `placeholderData:
keepPreviousData` on search queries.
4. **First optimistic toggle** using the notification-setting recipe on one
   low-stakes org-scoped mutation; extract the helper only at the second
   call site (YAGNI).
5. **`applyOrpcFieldError` helper**; migrate catalog + patient forms.
6. **Settings-page furniture** as screens appear: SecondaryMenu, danger-zone
   confirm, one-time secret display, members-table meta pattern under our
   `access.ts` permissions.
7. **TanStack Table v9** only when billing/reports demand a column model;
   date-range presets when reports grow range filters.

Everything else in the reports (tracker calendar math, TUS uploads, MFA UI,
charts DnD grid) is catalogued above for when its domain arrives.

## Next falsification

1. Add `combobox`/`command` via the shadcn CLI in a branch; verify the base
   registry versions compose with base-lyra tokens and our unlayered
   `:focus-visible` rule; wire `OpdPatientSearch` and keyboard-test it.
2. Upgrade TSQ to 5.102 in a branch; confirm `queryClient.query()` works
   under `setupRouterSsrQueryIntegration` dehydration (Router docs still show
   the old API — the two owning docs currently disagree).
   **Answered 2026-08-24: falsified earlier — type-level incompatibility
   with `@orpc/tanstack-query` 1.15.0 blocks the 5.102 upgrade before the
   dehydration question is reachable (spec Outcome).**
3. Implement one optimistic toggle and kill the network mid-flight; confirm
   rollback restores every org-scoped view and the denial audit still fires.
4. Spike `orpc.….liveOptions()` against an event-iterator procedure; measure
   vs 10 s polling on the OPD day list before touching
   `OPERATIONAL_REFETCH`.

## Sources

- midday-ai/midday @ `5158731` — all `apps/dashboard/src/...`,
  `packages/ui/...`, `apps/api/...`, `packages/db/...` paths above.
- HMS repo files as cited (`apps/web/src/...`, `packages/ui/src/...`).
- TanStack Query docs/releases: tanstack.com/query (query-options, suspense,
  prefetching guides); `queryClient.query` commit `40321a0`; registry
  metadata for 5.102.1.
- TanStack Router/Start docs: search-params, external-data-loading,
  preloading, selective-ssr; Start overview (RC status).
- oRPC docs: orpc.dev/docs/integrations/tanstack-query, /docs/procedure.
- react-hook-form releases v7.86.0; resolvers v5.9.1/v5.0.0; RHF subscribe/
  createFormControl docs.
- Zod: zod.dev/v4, /v4/changelog, /packages/mini.
- TanStack Table v9 migration guide; react-table 9.1.2 / 9.0.0 releases;
  react-virtual 3.14.10 release.
- nuqs: nuqs.dev/docs/adapters (TanStack Router caveats); v2.10.0 release.
- Bun: bun.sh/blog/bun-v1.4; docs on isolated installs, workspaces.
