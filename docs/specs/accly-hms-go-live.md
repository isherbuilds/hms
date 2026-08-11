# Spec: accly-hms go-live — business dates, multi-terminal freshness, operational reports, worklists

Status: ready
Authority: roadmap decision record `docs/02-roadmap-decisions.md` (2026-08-08, brainstorm +
external advisory reconciled against code); v0 spec `docs/specs/accly-hms-v0.md` (implemented).
Supersedes: the v0 spec's "Tally XML export … the slice following Slice 8" deferral — the
handover boundary is now governed by `docs/02-roadmap-decisions.md` (XLSX first, adapter only
if the accountant acceptance test fails).

Vocabulary: `docs/CONTEXT.md`. Organization, Patient, Visit, Charge, Invoice, Credit Note,
Refund, Billing Ledger, Business Date are used exactly as defined there.

## Problem

All eight v0 slices are implemented, but the pilot cannot go live on them:

1. Tokens and the queue bucket days in UTC (`packages/api/src/routers/visit.ts` token key and
   queue filter) while the Billing Ledger and GST register bucket in `Asia/Kolkata`
   (`packages/api/src/lib/ledger.ts`), and fiscal-year document numbering derives from the UTC
   calendar date (`billing.ts` `fiscalYearLabel(now, …)` call sites). One hospital day can
   split across queues, reports, and — in the 00:00–05:30 IST window around April 1 —
   statutory number series that disagree with the ledger's own entry dates.
2. Reception, billing, and the owner run separate terminals; the UI refreshes only after the
   local tab's own mutations, so another terminal's visit, transition, or invoice is invisible
   until manual reload.
3. The day-close reports the front office and owner need — daily collections by method, OPD
   register — do not exist; only statutory reports (trial balance, billing-ledger balance
   sheet, GST) shipped.
4. Known exceptions (visits leaking unbilled charges, refunds owed to patients) surface nowhere
   as actionable lists.

## Solution

Four slices, after which the pilot starts live OPD traffic: an organization timezone with one
shared Business Date rule applied to tokens, queue, fiscal-year numbering, ledger, and reports;
conservative polling + conflict-refresh on the shared operational screens; the two day-close
reports with XLSX/print export; and unbilled-activity + refund-due worklists driven by an
org-editable threshold.

## Validation / Evidence

Owner-funded pilot readiness work; no new product bet. The gap list is verified against code
(2026-08-08): `visit.ts:135-136` UTC token comment, `visit.ts:313-316` UTC queue window,
`ledger.ts` fixed `REPORT_TIME_ZONE`, `report.ts` hard-coded `Asia/Kolkata` GST bucketing,
`reportRouter` containing only `trialBalance`/`balanceSheet`/`gst`.

## User Stories

1. As a **receptionist**, the queue's "today" and the token series match the hospital's wall
   clock, including for late-evening OPD, regardless of server timezone.
2. As a **billing clerk**, a visit created or invoiced at another terminal appears on my queue
   and billing lists within ~10 seconds without reloading, and when I lose a race (someone else
   transitioned the visit or issued the invoice) the screen refreshes to the winning state and
   tells me, instead of erroring opaquely.
3. As an **owner**, I close the day with a collections report — payments and refunds by
   cash/UPI/card, net collections, receiver breakdown — that matches the cash drawer, and an
   OPD register listing every visit with its token, practitioner, invoiced value, and balance.
4. As a **billing clerk**, I work an exceptions list: visits with pending charges older than
   the configured threshold, and invoices with refund due — each row linking straight to the
   visit's billing workspace.

## Implementation Decisions

**Business Date (Slice 9).** `organization_settings` gains `timeZone` (IANA name, `NOT NULL`,
migration backfill `'Asia/Kolkata'`, added to `SETTINGS_DEFAULTS`, validated against
`Intl.supportedValuesOf("timeZone")` in the settings router and exposed on the admin settings
page). One helper module `packages/api/src/lib/business-date.ts` owns every calendar
derivation:

- `businessDate(instant, timeZone): string` — `YYYY-MM-DD` of the instant in the zone;
- `businessDayWindow(date, timeZone): { start: Date; end: Date }` — UTC instants of the zone's
  midnight-to-midnight window;
- fiscal-year selection: `fiscalYearLabel` keeps its signature but every caller derives the
  calendar parts through the helper, so an invoice issued at 00:10 IST on April 1 lands in the
  opening fiscal year even though the UTC clock still reads March 31 — and its number series
  agrees with the journal's `entryDate`, which is already IST-correct today.

Consumers migrated in this slice: token counter key and queue window in `visit.ts`; the four
`fiscalYearLabel` call sites in `billing.ts`; `ledgerEntryDate` in `ledger.ts` (drops the fixed
`REPORT_TIME_ZONE`); the GST/date bucketing SQL in `report.ts` takes the org zone as a
parameter; `dayBounds()` in `dashboard.ts` (UTC today-window behind the queue and collections
cards). Settings arrive through the existing TTL-cached settings read — no new lookup path.
India has no DST, but the helper is zone-generic and tested at a DST boundary anyway so a
future non-Indian tenant does not corrupt its day windows.

**Freshness (Slice 10).** Web-only. The shared operational queries — front-desk queue, billing
visits list, billing visit workspace, front-desk visit detail — get `refetchInterval` ~10 s
(foreground only, TanStack default suppresses background tabs) and a lower per-query
`staleTime` than the 60 s global default in `apps/web/src/lib/query-client.ts`. Mutations
already invalidate locally; this slice adds, on `CONFLICT` from `visit.transition` and
`billing.issueInvoice`, an invalidate + toast naming the cross-terminal cause. A small shared
"updated Xs ago / refresh" affordance renders from `dataUpdatedAt` on those four screens. No
websockets, SSE, or realtime infrastructure — polling adequacy is exactly the feedback the
pilot should produce.

**Operational reports (Slice 11).** Two read-only procedures in
`packages/api/src/routers/report.ts` under the existing `report: ["read"]` permission:

- `report.dailyCollections({ orgSlug, from, to })` — payments and refunds grouped by method
  (count + amount), gross receipts, net collections (payments − refunds), invoices issued
  (count + value) and credit notes listed separately from money movement, and a per-receiver
  (`payments.receivedBy` / `refunds.refundedBy`) breakdown. Money identities reuse
  integer-paise arithmetic from `invoice-math.ts`.
- `report.opdRegister({ orgSlug, from, to })` — one row per Visit in the window (Business Date
  of visit creation): token, MRN, patient name, department, practitioner, status, invoiced
  gross, credit total, payments, refunds, outstanding. Aggregates all of a visit's invoices;
  never assumes one invoice per visit. Cancelled visits appear flagged and are excluded from
  completed-volume totals.

Both validate `from ≤ to` and cap ranges at 31 days (`assertValidPeriod` pattern). Routes
`reports/daily-collections.tsx` and `reports/opd-register.tsx` follow the existing report page
pattern (date filters defaulting to today, `downloadXlsx` from `apps/web/src/lib/report-export.ts`,
print view); OPD register rows link to the visit billing workspace.

**Worklists (Slice 12).** `organization_settings` gains `unbilledAlertHours` (integer, check
1–168, default 24, admin-editable). Two procedures, same permission:

- `report.unbilledActivity({ orgSlug })` — non-cancelled Visits whose oldest `pending` charge
  is older than the threshold: patient, visit, practitioner, department, visit status, oldest
  pending age, pending amount. Invoiced and voided charges never count.
- `report.refundDue({ orgSlug })` — invoices with negative outstanding
  (`grandTotal − creditTotal − paymentsTotal + refundsTotal < 0`): invoice number, patient,
  the four components, refund due (`−outstanding`), age since the credit note that created it.
- `report.duesOutstanding({ orgSlug })` — the mirror of refund due: invoices with positive
  outstanding (`grandTotal − creditTotal − paymentsTotal + refundsTotal > 0`): invoice number,
  patient, the four components, amount due, age since issuance. Pure read over existing rows —
  no schema, no posting.

All three return bounded lists (cap 200, oldest first) — worklists, not archives. One route
`reports/exceptions.tsx` renders the sections with rows linking to
`/org/$orgSlug/billing/visits/$visitId`.

**Deliberately not here.** No new permission statements: statutory-vs-operational report
visibility split is a recorded pilot-owner decision (see roadmap doc), and until then
`report: ["read"]` governs all report reads. No appointments, vitals, or patient timeline
(stage 2). No Tally adapter (conditional). Every new query carries the tenant predicate; both
worklist queries are new SQL over existing tables only — no schema beyond the two settings
columns.

## Test Seams

Existing seams only; prior art: `tests/support/database.ts` (real Postgres),
`createTestUser`/`createOrganization`/`joinOrganization`/`clientFor`/`expectORPCCode`,
`eventually` for audit rows; unit prior art `tests/unit/invoice-math.test.ts`,
`tests/unit/report-presentation.test.ts`, `tests/unit/query-client.test.ts`.

- `business-date.ts` — unit: zone-midnight boundaries (23:59/00:01 IST), March 31 → April 1
  fiscal rollover at IST vs UTC clocks, a DST-transition zone, invalid zone rejection.
- `report.dailyCollections` / `report.opdRegister` — integration through the router client
  against a seeded day: identities hold, per-visit aggregation correct, tenancy four-questions.
- `report.unbilledActivity` / `report.refundDue` — integration: threshold entry/exit,
  invoice/void/refund transitions clear rows, tenancy four-questions.
- Slice 10 has no server seam; its proof is the two-browser smoke plus a unit test only if the
  interval/staleTime options are extracted into a testable helper.

## Task Plan

- [ ] Slice 9: Organization timezone + Business Date (riskiest: touches statutory numbering)
  - Acceptance: `organization_settings.timeZone` exists (IANA, backfilled `Asia/Kolkata`,
    settings page + router validation via `Intl.supportedValuesOf`); token counter keys, queue
    day window, all four fiscal-year numbering sites, ledger entry dates, and GST bucketing
    derive from `business-date.ts` and the org's zone; no remaining hard-coded
    `Asia/Kolkata`/UTC calendar derivation in `packages/api` outside the helper; a visit
    created at 00:10 org-local time takes token 1 of the new Business Date; an invoice issued
    at 00:10 IST on April 1 numbers into the opening fiscal year (UTC clock still March 31)
    with FY label and journal `entryDate` agreeing on the new year.
  - Verify: `bun run check-types && bun run check && bun run test` — new unit suite for
    `business-date.ts` (midnight, fiscal rollover, DST zone, invalid zone) plus existing
    counters/visits/billing/accounting suites green; grep proves `REPORT_TIME_ZONE` is gone.
  - Depends on: none
  - Owns/Touches: `packages/db/src/schema/organization-settings.ts` + generated migration,
    `packages/api/src/lib/business-date.ts` (new), `packages/api/src/lib/ledger.ts`,
    `packages/api/src/routers/{visit,billing,report,settings,dashboard}.ts`,
    `apps/web/src/routes/org/$orgSlug/settings/organization.tsx`, `tests/unit/business-date.test.ts`.
  - Interfaces: exports `businessDate(instant, timeZone)`, `businessDayWindow(date, timeZone)`
    consumed by Slices 11–12; settings row gains `timeZone: string` (in `SETTINGS_DEFAULTS`
    and `settings.get/update`).
- [ ] Slice 10: Multi-terminal freshness
  - Acceptance: front-desk queue, billing visits list, billing visit workspace, and front-desk
    visit detail refetch on a ~10 s foreground interval and on window focus; a `CONFLICT` from
    `visit.transition` or `billing.issueInvoice` invalidates the affected queries and toasts
    that another terminal acted; each screen shows last-updated time with a manual refresh; no
    websocket/SSE dependency added.
  - Verify: `bun run check-types && bun run check && bun run test`; two-browser smoke — visit
    created in window A appears in window B ≤ 15 s; concurrent transition race leaves loser
    seeing winner's state with the explanatory toast; issued invoice leaves the other
    terminal's pending list.
  - Depends on: none
  - Owns/Touches: `apps/web/src/routes/org/$orgSlug/front-desk/{queue,visits.$visitId}.tsx`,
    `apps/web/src/routes/org/$orgSlug/billing/{index,visits.$visitId}.tsx`, a shared
    last-updated component in `apps/web/src/components/`.
  - Interfaces: none produced; consumes existing `orpc.*.queryOptions`.
- [ ] Slice 11: Daily collections + OPD register
  - Acceptance: `report.dailyCollections` returns method-grouped payments and refunds (count +
    amount), gross/net, invoice and credit-note context, receiver breakdown;
    `report.opdRegister` returns one row per visit with token, patient, practitioner,
    department, status, and the invoice/credit/payment/refund/outstanding aggregate; both
    bucket by Business Date in the org zone, validate ranges (≤ 31 days), and ship routes with
    today-default filters, XLSX export, print view, and visit links.
  - Verify: `bun run check-types && bun run check && bun run test` — integration seeds a day
    (partial payments, credit note, cash + UPI refunds, a cancelled visit) and asserts: net =
    payments − refunds; invoice value ≠ collections; every visit exactly once; cancelled visit
    flagged and excluded from completed totals; tenancy four-questions for the new procedures.
  - Depends on: Slice 9
  - Owns/Touches: `packages/api/src/routers/report.ts` (coordinator-owned with Slice 12),
    `apps/web/src/routes/org/$orgSlug/reports/{index,daily-collections,opd-register}.tsx`,
    `tests/integration/reports-operational.test.ts` (new).
  - Interfaces: produces `report.dailyCollections({ orgSlug, from, to })` and
    `report.opdRegister({ orgSlug, from, to })` with money as 2-decimal strings, consumed by
    the day-close SOP; consumes Slice 9's window helper.
- [ ] Slice 12: Unbilled-activity + refund-due + dues worklists
  - Acceptance: `unbilledAlertHours` settings column (1–168, default 24) editable on the admin
    settings page; `report.unbilledActivity` lists non-cancelled visits whose oldest pending
    charge exceeds the threshold, with age and pending amount; `report.refundDue` lists
    invoices with negative outstanding and its components; `report.duesOutstanding` lists
    invoices with positive outstanding and its components; all three capped at 200 oldest-first;
    `reports/exceptions.tsx` renders the sections with links into the billing workspace.
  - Verify: `bun run check-types && bun run check && bun run test` — integration: backdated
    pending charge enters the list and invoicing/voiding removes it; cancelled visit excluded;
    G=100/P=50/CN=80 yields refund due 30 and recording the refund clears the row; G=100/P=40
    yields dues 60 and recording the balance payment clears the row; tenancy four-questions for
    all three procedures.
  - Depends on: Slice 9 (dates), Slice 11 (shared `report.ts` and reports index — sequence,
    do not parallelize)
  - Owns/Touches: `packages/db/src/schema/organization-settings.ts` + generated migration,
    `packages/api/src/routers/{report,settings}.ts`,
    `apps/web/src/routes/org/$orgSlug/settings/organization.tsx`,
    `apps/web/src/routes/org/$orgSlug/reports/{index,exceptions}.tsx`,
    `tests/integration/reports-operational.test.ts` (extends Slice 11's file).
  - Interfaces: produces `report.unbilledActivity({ orgSlug })`, `report.refundDue({ orgSlug })`,
    and `report.duesOutstanding({ orgSlug })`; consumes the settings row and Slice 9's helper.

Parallelism: Slice 10 may run alongside Slice 9 (disjoint write sets). Slices 11 and 12 share
`report.ts`, the reports index, and the test file — run them in order. Shared files touched by
multiple slices (`packages/api/src/routers/report.ts`, `reports/index.tsx`,
`organization-settings.ts`) are coordinator-owned; each slice appends only its own exports.

## Out of Scope

Appointments (trigger-gated, roadmap), vitals capture and patient timeline (stage 2), Tally
adapter (conditional on the accountant acceptance test), websockets/realtime, report-permission
split, pharmacy/lab/radiology/IPD/emergency/OT, offline mode, payment gateways.

## Explicitly Deferred

- Statutory-report visibility for ordinary members (`report: ["read"]` is currently granted to
  every role) — pilot-owner decision recorded in `docs/02-roadmap-decisions.md`; splitting the
  statement is a one-file `access.ts` change when decided.
- `unbilledAlertHours` tuning — ships at 24; re-seed after observing the pilot's real billing
  lag.
- Cashier/shift-level handover is not part of the current slice. Before Slice 11 starts, validate
  whether the client's existing giver/receiver handover is a required day/shift-close control. If
  it is, reopen Slice 11 to produce an acknowledged handover record (identity, shift/terminal,
  method totals, variance, timestamp) rather than shipping a read-only report and discovering the
  control gap at cutover; evidence is in `docs/research/03-client-hms-production-sitemap.md`.
  DanpheEMR corroborates the control shape: an acknowledged two-party handover document
  (giver/receiver/counter, amount, due, received-by/on, pending→received) with a mirrored employee
  cash ledger — see `docs/research/04-danphe-marley-entity-deep-dive.md` E2 for the donor shape
  and its flaws (dual receive paths, no variance state) to avoid.
- Cash-drawer expenses (petty payouts from the reception drawer — incumbent evidence O7) are
  not modelled, and must not be half-modelled: `Cash in Hand` (1100) is a real posted ledger
  account, so a payout that posts nothing would make the ledger silently overstate the physical
  drawer — the decoration failure mode applied to money. Pilot SOP: nothing leaves the drawer;
  petty expenses come from a separate float outside the product. If the pilot proves drawer
  payouts are non-negotiable, that is a decision-5 amendment (a real `expense` posting source
  crediting Cash in Hand), never a memo field.

## Open Questions

- Does the pilot require a persisted cashier/shift handover, or is the daily collections report plus
  an external SOP sufficient? Resolve before Slice 11 implementation.
- Does the pilot's front desk pay any expense from the cash drawer today? Determines whether
  the day-close SOP needs a separate petty float, or decision 5 in the roadmap must be amended.
  Ask in the same handover interview.
- Which tender types does the pilot actually take (cheque? bank transfer? sponsor credit?), and
  is the printed receipt per tender row or one per bill? `payments.method`/`refunds.method`
  carry a `cash/upi/card` CHECK and receipt numbers are per-payment-row. The CHECK is cheap to
  widen whenever the answer arrives (appended DROP/ADD CONSTRAINT — allowed even after the
  migration history freezes, which ends rebasing, not migrating); do not widen it speculatively.
  Receipt granularity is the real deadline: per-payment vs per-bill numbering is baked into
  printed documents, so it must be settled before the first live receipt.
