# Frontend patterns: what HMS should still take from its references

Consolidates five memos written 2026-08-31 to 2026-09-01 (Midday frontend
playbook, state ownership, client search ownership, RHF field ownership, and the
HMS/Midday/OpenStatus form comparison). Their settled conclusions are promoted
into [Development](../development.md) and the [ledger](./README.md). What
survives here is the **unbuilt work** and the pins that justify it.

## Question

How do Midday's `apps/dashboard` and OpenStatus's dashboard keep a large console
cheap to render and cheap to fetch, and which of it still applies to HMS on
TanStack Start, oRPC, Base UI and React Compiler?

## Answer

**Most of it does not apply, and the reason is one fact: React Compiler is on in
HMS and off in Midday.** Midday's 21 `memo()` calls, its `arePropsEqual`
comparator and its 148 `useCallback`s are compensation for a compiler HMS
already runs. Porting them would add cost, not remove it.

On the two things HMS was actually tested against, HMS is already ahead:

|                | Field binding                       | Error subscription                            | Cost per keystroke                                   |
| -------------- | ----------------------------------- | --------------------------------------------- | ---------------------------------------------------- |
| **HMS**        | `register` (54) + `Controller` (12) | per-field `useFormState({name, exact: true})` | **0 renders** for 54 fields                          |
| **OpenStatus** | `Controller` only (186)             | per-field `useFormState({name})`              | 1 field subtree + whole form where `watch()` is used |
| **Midday**     | `Controller` only (105 + 11 raw)    | root `formState` proxy, shared                | 1 field subtree + whole form on any error change     |

HMS is the only one of the three that lets the DOM own a draft value, and the
only one that follows RHF's own documented performance model. `grep -rn
"register(" apps/dashboard/src` returns **0** in Midday.

**Three items remain unbuilt.** Everything else is either landed or rejected.

## Remaining work

**1. `ServicePicker` is the last controlled picker input.** `inputValue={query}`
/ `onInputValueChange={setQuery}` (`opd-service-picker.tsx:130-131`) re-renders
the component on every keystroke. Midday's command menu shows the alternative:
pass no `value`, let the primitive hold the text, treat the callback as
write-only
([`search.tsx:832-846`](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/apps/dashboard/src/components/search/search.tsx#L832-L846)).
The obstacle is real: the picker must clear its box after a selection and
`defaultInputValue` alone cannot. Solve that first (a `key` bump on selection,
or an imperative clear on the input ref), then drop the controlled prop.
Profile the keystroke before and after; do not do it blind.

**2. oRPC request batching is installed and unused.** Add `BatchLinkPlugin` to
the client link in `apps/web/src/lib/orpc.ts` and `BatchHandlerPlugin` to the
`RPCHandler` in `apps/server/src/index.ts`. Two lines, no component changes. The
OPD intake route alone fans out to three procedures in its loader
(`routes/$orgSlug/opd/new.tsx:30-43`) — three round trips on client navigation
today. Measure the request count before and after.

**3. `Route.useSearch({ select })` at the remaining call sites.** With
`defaultStructuralSharing: true` already on, a `select` narrows the subscription
to one key. On `opd/index.tsx`, toggling `includeClosed` re-renders components
that read only `date`. Small, safe, mechanical.

**Gated, not scheduled.** Per-widget dashboard streaming is a whole-route
decision that conflicts with the current "loader primes, component reads"
convention — only the multi-card dashboard route earns the argument. Postgres
FTS and `pg_trgm` indexes stay unbuilt until production p95 asks: `05a39b9`
measured 40k seeded patients and found the current queries adequate. Seeding
detail navigation from the list cache fights TanStack Router's blocking loader;
scope it to one route or skip it.

## Falsification

One profiled React Scan session on the OPD desk against the 40k-patient seed,
before and after items 1–3:

1. Type six characters into the service picker. Count renders of
   `ServicePicker`, the combobox wrapper and the Base UI list. Item 1 should
   reach zero physical-typing renders, matching the `OpdSearchInput` correction.
2. Navigate to `/opd/new` from the day list with the network panel open. Item 2
   should collapse the loader's three requests into one.
3. Toggle **Include closed** on the OPD day. Item 3 should take the
   `date`-only readers to zero renders.

If an item shows no change, drop it rather than keep it for tidiness.

## Rejected, with reasons

- **Midday's memoization density as a default.** See above. HMS's one `memo`
  (`settings/catalog.tsx:302`) earned its place against a measured 150 ms → 7 ms
  flip at 1,000 rows; each future one must cite its own measurement.
- **Midday's totals loop.** Watching a field array, recomputing in floating
  point, then writing back through `setValue` in an effect is a cascade and a
  money bug at once. HMS's server-owned `opd.quoteWalkIn` with the shared
  integer-paise `computeInvoiceLines` preview is correct.
- **`Controller` on plain inputs**, **offset pagination named "cursor"**, and
  **client-side float money** — HMS's `register`, keyset tuples, and `numeric`
  strings all beat them.
- **Zustand, nuqs, a global client store.** Router search params and React Query
  already own what Midday splits across three libraries.
- **`useDeferredValue` to suppress requests**, **manual query cancellation**
  beside the oRPC adapter, and **one generic search controller**. The owner
  contracts differ; the adapter already forwards Query's `AbortSignal`.
- **Redis, read replicas, region routing.** Multi-region SaaS answers. HMS is
  one region, one database.

Rate limiting is a real HMS gap, but Midday does not own that claim — its own
tRPC path has none. Decide it against threat modelling, not against this memo.

## What this does not prove

Nothing here is a production measurement. Every render count is React Scan in
development, and every latency number in
[`data/perf-midday-adoption/`](./data/perf-midday-adoption/) is one machine, one
seed, one session. Reference snapshots age: re-pin before reusing them.

## Sources

- [midday-ai/midday @ 51587319](https://github.com/midday-ai/midday/tree/51587319f26a0ffaa9dfccab1920373cb65689b7)
  (2026-06-13) and [openstatusHQ/openstatus @ 48b5a2c](https://github.com/openstatusHQ/openstatus)
  (2026-09-01); HMS at `df40de3`. Full trees read locally at those pins.
- [oRPC client plugins](https://orpc.dev/docs/client/plugins) and
  [server plugins](https://orpc.dev/docs/server/plugins), installed v1.15
- [TanStack Router search params](https://tanstack.com/router/latest/docs/guide/search-params)
  — `select` and structural sharing
- [TanStack Query `placeholderData`](https://tanstack.com/query/latest/docs/framework/react/guides/placeholder-query-data),
  [optimistic updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates),
  and [cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation)
- [React Hook Form](https://www.react-hook-form.com/) 7.87 —
  [`Controller`](https://github.com/react-hook-form/react-hook-form/blob/master/src/controller.tsx)
  and [`useFormState`](https://github.com/react-hook-form/react-hook-form/blob/master/src/useFormState.ts)
  sources; [maintainer discussion on callback-time reads](https://github.com/orgs/react-hook-form/discussions/3896)
- [React Compiler](https://react.dev/learn/react-compiler),
  ["You Might Not Need an Effect"](https://react.dev/learn/you-might-not-need-an-effect)
- [Base UI Combobox](https://base-ui.com/react/components/combobox)
- [PostgreSQL full text search](https://www.postgresql.org/docs/17/textsearch.html)
  and [pg_trgm](https://www.postgresql.org/docs/17/pgtrgm.html)
