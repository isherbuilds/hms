# Operational reports and billing worklists

The **Next** scope and pre-pilot gate in [`product.md`](../product.md) own the
priority of this work. GST, Trial Balance, and Balance Sheet reports already
ship; this spec covers only the missing operational reports and billing
exceptions below.

Reports are Organization-scoped read models over source records. They never
become a second write model, and clinical notes are excluded.

## Current baseline

- `billing.worklist` returns tenant-scoped pending Charges for `checked_in` OPD
  appointments, oldest Charge first. It is searchable in SQL but is currently
  unbounded.
- `billing.openInvoices` returns issued Invoices with a positive outstanding
  balance, filtered in SQL before keyset pagination. It defaults to 25 rows and
  accepts at most 100.
- Invoice balances already share one calculation over Invoice value, Credit
  Notes, Payments, and recorded Refunds.

## Remaining work

### Day-close reports

**Daily collections** shows Payments minus Refunds by method and Organization
Business Date. Invoice value is never presented as cash collected.

**OPD register** shows one row per OPD Appointment with token, Patient,
Practitioner, Department, observable status, billed, paid, and outstanding
amounts. `checked_in` plus `arrivedAt` is attended work; `booked`, `cancelled`,
and `no_show` remain distinct outcomes. The report must not invent a completed
state.

Both reports:

- accept an inclusive Organization-local date range;
- link from `/$orgSlug/reports`;
- support XLSX and print output; and
- reconcile on-screen and exported totals under identical filters.

### No-show accuracy gate

OPD currently changes past `booked` rows to `no_show` lazily when `opd.day`
reads that Business Date. A report therefore cannot assume every past date has
already been opened.

Before the OPD register or a no-show total ships, establish one tenant-scoped
reconciliation boundary shared by operational and report reads, or approve a
different authoritative mechanism. Until then, a stale booking remains
`booked`; do not publish a no-show rate or silently count it as attended.

### Billing exception completion

- Add Organization setting `unbilledAlertHours`, constrained to 1–168 and
  initially 24. Apply the threshold in SQL before a new bounded worklist result
  (50 rows by default, 200 maximum).
- Add **Refund due** for issued Invoices whose shared balance is negative after
  Credit Notes, Payments, and already-recorded Refunds.

Exception lists are oldest first. Each row links to the existing OPD Billing or
Invoice screen and disappears on the next invalidation or poll after resolution.

## Acceptance

- Partial and full Payment, Credit Note, recorded Refund, cancellation, and
  Organization-local Business Date boundaries produce correct totals.
- Outstanding and refund-due identities reuse the shared Invoice balance and
  filter in SQL before result caps.
- No-show reporting is correct without relying on a prior read of each OPD day.
- Every query uses verified Organization scope; every query and invalidation key
  includes `orgSlug`; another tenant's rows are denied.
- XLSX, print, desktop, and mobile output are inspected with representative
  data.
- Existing type, lint, integration, and production-build checks pass.

## Non-goals

Payment gateway, Advance Receipt implementation, WebSockets, a cashier-shift
entity, petty-cash expenses, speculative payment methods, filing-ready GST
output, or a general analytics platform. Add a handover entity only if the pilot
proves the report plus SOP insufficient.
