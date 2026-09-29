# Reports and billing worklists

Reports are Organization-scoped read models over source records. They never
become a second write model, and clinical notes are excluded. GST, Trial
Balance, Balance Sheet, Daily Collections, and the OPD Register ship; the
billing worklists below are the shipped exception lists.

## Billing exceptions

- `billing.worklist` returns tenant-scoped pending Charges for `checked_in` OPD
  appointments whose oldest pending Charge is older than the Organization's
  `unbilledAlertHours` (1–168, initially 24, editable in Organization settings).
  The threshold is a `HAVING` on the grouped appointment, so a newer Charge never
  hides an eligible visit. Results are oldest first, 50 rows by default and 200
  at most, with `hasMore`; the summary totals count every match, not the page.
  The dashboard's unbilled figures apply the same threshold.
- `billing.openInvoices` returns issued Invoices with a positive outstanding
  balance, filtered in SQL before keyset pagination (25 default, 100 maximum).
- `billing.refundDue` returns issued Invoices whose shared balance is negative
  after Credit Notes, Payments, and recorded Refunds, filtered in SQL before the
  cap, oldest first, and linked to the Invoice screen.

- `billing.advancesHeld` returns one row per Advance Receipt with unused credit,
  keyset-paged by `(createdAt, id)`, with the receipt's printed purpose and its
  plan's status.

Invoice balances share one calculation over Invoice value, Credit Notes,
Payments, Advance Allocations, and recorded Refunds.

## Day-close reports

**Daily collections** (`report.dailyCollections`, at most 92 days) aggregates
Payments, Advance Receipts, Refunds, and advance Refunds by stored Business Date
and method — never a date re-derived from `createdAt` — and returns per-day rows,
per-method totals, and net collections: payments plus advances less both kinds of
refund. Invoice value is never presented as cash collected, and advance money is
shown as received, not as revenue.

**OPD register** (`report.opdRegister`, at most 31 days) returns one row per OPD
Appointment with token, Patient or caller, Practitioner, Department, arrival
mode, stored status, and billed, paid, credit, refund, and outstanding amounts
from correlated per-appointment sums. `booked`, `checked_in`, `cancelled`, and
`no_show` remain distinct; the report never invents a completed state.

Both reports accept an inclusive Organization-local date range, link from
`/$orgSlug/reports`, and offer XLSX export and printing. Their tables remain
horizontally scrollable on narrow screens. Cashiers and pharmacists can read
Daily Collections to close a shift. The patient-level OPD Register and the statutory and ledger reports remain restricted to accountants,
administrators, and owners.

## Financial reports and exports

**GST outward register** reads issued Invoice and Credit Note snapshots across
billing streams. It shows documents and summaries by rate and HSN/SAC. Its
CGST/SGST split assumes intra-state supply; it is not a filing-ready export.

**Trial Balance** reads journals for opening balances, period debits and credits,
and closing balances by account. **Balance Sheet** reads the same billing ledger
as of the selected date. Both cover HMS billing activity only; they omit expense,
payroll, inventory valuation, and manual journal accounting.

All five report pages offer **Print / PDF** and **Export Excel**. Report reads
use the report's permission and verified organization scope. Refresh the page
and check the date range before handover. Export implementation changes and
remaining browser checks belong in the work registry.

## No-show reconciliation

Before selecting a range that includes a past Business Date, the OPD register
runs the same `closeExpiredBookings` reconciliation as `opd.day`: every `booked`
row older than the current Business Date becomes `no_show`, its pending Charges
are voided, and each closure is audited after commit. The helper is idempotent
and tenant-scoped, so the register reports the same statuses whether or not any
OPD day was previously opened ([OPD](./opd.md)).

## Non-goals

Payment gateway, WebSockets, a cashier-shift
entity, petty-cash expenses, filing-ready GST output, or a general analytics
platform. Add a handover entity only if the pilot proves the report plus SOP
insufficient.
