# Operational reports and billing worklists

Status: ready

This spec contains only the remaining product work required before pilot OPD traffic. Business Date
handling and multi-terminal polling already exist and are not compatibility seams for this work.

## Outcome

Reception and billing staff can close a hospital day and resolve financial exceptions without
assembling information from individual OPD appointments. Accountants receive document-based exports;
clinical notes are outside these reports.

## Slice 1 — day-close reports

Add organization-scoped procedures and pages for:

- **Daily collections:** payment totals by method and refunds, grouped by the organization's
  Business Date. Net collections equal payments minus refunds; Invoice value is not presented as
  cash collected.
- **OPD register:** one row per OPD appointment with token, patient, practitioner, department, status,
  billed amount, paid amount, and outstanding amount read through its direct financial records. Cancelled
  OPD appointments remain visible and are excluded from completed totals.

Both reports accept an inclusive local-date range, use the organization timezone, support XLSX and
print output, and are linked from `/$orgSlug/reports`. Every query carries the verified organization
scope and every client query key includes `orgSlug`.

Acceptance coverage must include partial payment, full payment, Credit Note, refund, a cancelled
OPD appointment, Business Date boundaries, and cross-tenant denial.

## Slice 2 — exception worklists

> **Partly shipped.** `billing.worklist` and `/$orgSlug/billing` now serve the first two lists
> below, unthresholded and capped at 50 rows by default (200 maximum). Still to build:
> `unbilledAlertHours` and the refund-due list.

Add organization-scoped worklists for:

- **Unbilled activity:** OPD appointments holding pending Charges. _Shipped._ Cancellation needs no
  predicate of its own — cancelling voids the pending Charges, so the row leaves on the charge
  status alone. Keeping it to one condition is deliberate: research 12 §F3 records how the
  reference product's queue filter accreted payer exceptions until it silently hid insured
  patients.
- **Dues outstanding:** issued Invoices with a positive outstanding amount. _Shipped._ The
  outstanding predicate runs in SQL so the row cap cannot let a settled Invoice displace an unpaid
  one, while the amounts displayed still come from `invoiceBalancesFor` — one source of truth for
  money on screen.
- **Refund due:** issued Invoices whose payments exceed the remaining value after Credit Notes.
  _Not built._

The organization setting `unbilledAlertHours` is constrained to 1–168 and initially defaults to 24.
Each worklist is capped at oldest-first rows and links directly to the existing OPD billing or
Invoice screen. Recording the missing Invoice, payment, Credit Note, or refund removes the row on
the next successful invalidation/poll.

Acceptance coverage for the shipped lists proves amount identities, cancellation exclusion, row
removal after resolution, filtering before the cap, oldest-first ordering, and cross-tenant denial.
The alert-threshold boundary and refund-due identities remain acceptance gates for the unfinished
worklists.

## Non-goals

- No payment gateway or Advance Receipt implementation. Partial OPD payments remain supported.
- No WebSocket or sync platform; the existing conservative polling policy remains.
- No cashier shift-handover entity until the pilot confirms that a read-only day-close report plus
  SOP is insufficient.
- No cash-expense memo. If money leaves the drawer, either the SOP uses a separate petty-cash float
  or a later accounting decision adds a real balanced source document.
- No speculative payment methods or receipt-numbering change before the pilot confirms them.

## Verification

- Focused report and worklist integration tests against PostgreSQL.
- `bun run check-types`
- `bun run check`
- `bun run test`
- Production web build and desktop/mobile inspection of the report index and tables.
