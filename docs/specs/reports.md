# Operational reports and billing worklists

**Status:** active; remaining pre-pilot work only.

Reception and billing staff must close a Business Date and resolve financial
exceptions without opening appointments one by one. Reports are
organization-scoped read models; clinical notes are excluded.

## Remaining slices

### Day-close reports

- **Daily collections:** Payments by method minus refunds, grouped by the
  Organization's Business Date. Invoice value is never presented as cash
  collected.
- **OPD register:** one row per OPD Appointment with token, Patient,
  Practitioner, Department, status, billed, paid, and outstanding amounts.
  Cancelled rows remain visible but do not count as completed.

Both accept an inclusive local-date range, use the Organization timezone, link
from `/$orgSlug/reports`, and support XLSX and print output. On-screen and export
totals must reconcile under identical filters.

### Billing exception completion

`billing.worklist` already ships oldest-first, SQL-filtered **Unbilled activity**
(pending Charges) and **Dues outstanding** (issued Invoices with positive
outstanding), capped at 50 by default and 200 maximum.

Still required:

- `unbilledAlertHours`, constrained to 1–168 and initially 24, applied before
  the row cap;
- **Refund due:** issued Invoices where Payments exceed remaining value after
  Credit Notes.

Each row links to the existing OPD Billing or Invoice screen and disappears on
the next invalidation/poll after resolution.

## Acceptance

- Partial/full Payment, Credit Note, refund, cancellation, and local Business
  Date boundaries produce correct totals.
- Outstanding/refund identities use the shared invoice-balance logic and filter
  in SQL before caps.
- Lists are oldest-first and resolved rows disappear.
- Every query uses verified Organization scope; every query/invalidation key
  includes `orgSlug`; foreign tenants are denied.
- XLSX, print, desktop, and mobile output are inspected with representative data.
- `bun run check-types`, `bun run check`, `bun run test`, and production web build
  pass.

## Non-goals

Payment gateway, Advance Receipt implementation, WebSockets, a cashier-shift
entity, petty-cash expenses, speculative payment methods, or filing-ready GST
output. Add a handover entity only if the pilot proves the report plus SOP is
insufficient.
