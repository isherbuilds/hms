# Frontend patterns: measured evidence

Living rules are in [Development: Reading data](../development.md#reading-data)
and [React and forms](../development.md#react-and-forms). This is evidence, not a
second implementation convention.

## Remaining work

The registry's batching and remaining search-selector proposals are **dropped**
on 2026-10-04. Both experiments were reverted; the client link, server handler,
and candidate route subscriptions retain their original code.

### Request batching — fewer requests, failed independent cancellation

Method: logged-in owner@example.com, `mercy-general`, development server,
1365 × 768 Chromium, React Compiler and React Scan enabled. Start at the OPD day
list with a fresh document/query cache, clear `tab.requests()` with
`tab.clearRequests()`, then navigate client-side via New Appointment; the seeded
case uses `tab.pushState('/mercy-general/opd/new?patientId=demo-pat-000754')`.
Count procedure POSTs, excluding OPTIONS and unrelated OPD polling. Timing is the
span from the first fan-out RPC's request timestamp to its last completed
response (`ts + durationMs`), not page paint or production latency.

| Intake loader fan-out                               | Before POSTs | With batching POSTs | Before span | With batching span |
| --------------------------------------------------- | -----------: | ------------------: | ----------: | -----------------: |
| No patient seed: departments + practitioners        |            2 |                   1 |    2,478 ms |             618 ms |
| Patient seed: patient + departments + practitioners |            3 |                   1 |    3,169 ms |           1,085 ms |

The permission check remains a preceding `member.me` when stale. The unseeded
capture includes that request: **3 → 2 POSTs**, dependency-chain span
**3,371 → 1,409 ms**. The seeded before capture reused fresh membership (3 POSTs
in total); the after capture fetched membership (2 POSTs in total, 3,304 ms
including its 2,210 ms check). Compare fan-out counts, not these differing
membership-cache states. No elapsed-speed claim follows from these single runs:
other agents were editing and using the shared development server. Early OPD
polling 500s came from an in-flight schema migration and were excluded.

The experiment used installed `@orpc/client` / `@orpc/server` **1.15.4**, a fallback
`groups: [{ condition: () => true, context: {} }]`, and `BatchHandlerPlugin`.
Unlike today's online docs, this installed version sends **`x-orpc-batch`**, so
CORS allowed that header. Its default URL appends `/__batch__` to the first
procedure's URL; the experiment explicitly set `/rpc/__batch__`. The browser-only
link branch changed; request-local in-process SSR stayed untouched.

Observed safeguards and falsification:

- Both intake pages rendered; seed patient was preserved. Batch responses were
  HTTP 207. A body of 1 MiB + 1 byte at `/rpc/__batch__` returned **413** with
  `{"error":"Request too large"}` through the existing `/rpc/*` limit.
- One batch containing a missing `patient.get` and valid `staff.listDepartments`
  independently returned **NOT_FOUND / 404** and **13 departments**. Error codes
  and messages survived the per-call envelope.
- Two concurrent calls (`patient.search`, `staff.listDepartments`): abort the
  patient call's controller after 10 ms while leaving the staff call live.
  **With batching both promises fulfilled. After reverting batching the patient
  promise rejected with AbortError and the staff promise fulfilled.** Aborting
  both batched calls rejected both with AbortError. Installed batching therefore
  preserves whole-batch abort, not independent call cancellation.

**Drop.** The request-count win fails the required cancellation contract. No
batching, CORS-header addition, or alternate transport remains. Login, mutation
error-toast/field-error, and debounce landing smokes were not claimed: the
candidate was rejected before landing, not accepted with missing smoke evidence.

### Search selectors — the proposed benchmark does not mount the candidates

On the same OPD desk, select Filters → Status → All (Open is the default), with
render tracking enabled before the interaction. `tab.reactEnable()` reported
React 19.3.0, but `tab.reactRenders({ action: 'get' })` returned **0 commits / no
components** despite visible updates; `reactTree()` was empty. React Scan 0.5.7
owns the development hook. Those zeroes are **instrumentation failure**, not a
performance result. For actual counts, wrap the existing hook's
`onCommitFiberRoot`, preserve its original callback, and count named component
fibers carrying React's PerformedWork flag (`flags & 1`) after each commit.
This was tab-local instrumentation only; no tracking code was committed.

| Open → All committed renders                                  | Before selectors | With candidate selectors |
| ------------------------------------------------------------- | ---------------: | -----------------------: |
| `OpdRoute`                                                    |                1 |                        1 |
| `OpdDeskView`                                                 |                1 |                        1 |
| `JoinOrganizationRoute`, `LoginRoute`, `InvoiceDocumentRoute` |    0 (unmounted) |            0 (unmounted) |

The existing `OpdRoute` status selector is unchanged. Temporary single-field
conversions in join, login, and the Invoice layout reader cannot reduce an OPD
interaction: those routes are not mounted. They were reverted. `OpdAppointments`
rendered 2 versus 1 times and total commits were 8 versus 7, but this is a query
completion/remount difference, **not** evidence for selectors in absent routes.
No claim of faster interaction or of zero mounted-reader renders is made.

The historical six-site inventory is stale: billing now reads `q` **and** `view`;
patients/index reads `create`, `q`, **and** `sex`; the old `patients/$patientId.tsx`
is now a nested layout with **no useSearch**. The OPD list reads from/to/status,
and its desk reads all filters. **Drop all remaining conversion proposals**:
three fail to show a reduction on the specified path and three are no longer
single-field sites. A future selector needs its own mounted, unchanged-field
measurement; route-wide tidying is not justified by this benchmark.

## Earlier evidence retained

The RHF field-ownership and React Compiler conclusions remain in Development;
[the retained performance captures](./data/perf-midday-adoption/) are development
measurements, not production guarantees. ServicePicker already leaves draft
input ownership to Base UI; this exercise does not profile its keystrokes.
Midday's manual memoization density, floating-point totals, global client stores,
and duplicate query-cancellation machinery remain rejected. Streaming, search
indexes, and cache seeding need their own workload evidence rather than adoption
by resemblance.

## Sources

- [oRPC batch plugin](https://orpc.dev/docs/plugins/batch-requests) and
  [client implementation](https://github.com/middleapi/orpc/blob/1.x/packages/client/src/plugins/batch.ts);
  installed 1.15.4 `dist/plugins/index.mjs` was read on 2026-10-04 to resolve
  header/URL differences and cancellation behavior.
- [TanStack Router search selectors](https://tanstack.com/router/latest/docs/guide/search-params)
  and [TanStack Query cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation).
- [Loaded React Scan 0.5.7 types](https://unpkg.com/react-scan@0.5.7/dist/index.d.ts)
  and [React Compiler](https://react.dev/learn/react-compiler).
- Original comparison pins: [Midday 51587319](https://github.com/midday-ai/midday/tree/51587319f26a0ffaa9dfccab1920373cb65689b7)
  and [OpenStatus 48b5a2c](https://github.com/openstatusHQ/openstatus); HMS `df40de3`.
