# OPD appointments

Status: implemented

OPD is the staff-facing destination. Internally, one `opd_appointments` row represents one planned
or walk-in outpatient attendance from booking/arrival through consultation outcome. There is no
second Visit, OPD Encounter, or Clinical Encounter row.

## Boundary

- `arrivalMode` is `scheduled` or `walk_in`. It answers how this OPD appointment entered the system.
- `kind` is `consultation` or `procedure`. It answers what work was requested and is independent of
  arrival mode and lifecycle status.
- A scheduled appointment starts `booked`, may exist with caller details before a Patient is linked,
  and receives a Patient, daily token, configured attendance charge, and `arrivedAt` at check-in.
- A walk-in requires a Patient and starts `waiting` with its token and configured attendance charge
  already created. Consultation and procedure kinds use the same pricing policy; kind never silently
  makes attendance free.
- Queue lifecycle is `waiting -> in_consult -> completed`. A waiting patient may become `left_unseen`
  or `cancelled`; a booked appointment may become `cancelled` or `no_show`.
- Check-in is atomic and idempotent under concurrency: one booked row receives at most one token and
  one configured attendance charge. A completed same-practitioner attendance inside the follow-up
  window may select the configured follow-up price, including a zero-price catalog item.
- Money never changes OPD workflow state. Pending charges are voided when a waiting appointment is
  cancelled or marked left unseen; issued documents use credit-note/refund flows.
- Charges, invoices, and prescription attachments reference the OPD appointment directly. Shared
  cross-setting identity is not introduced before a second implemented care setting proves a real
  query or record that needs it.

## Staff interface

- Navigation label and URL remain **OPD** and `/opd`.
- OPD has two compact views: **Queue** and **Appointments**. They are views of the same records, not
  separate domains.
- Both views load stable keyset pages. The combined queue follows organization-wide arrival order;
  practitioner token numbers remain display identifiers and are not treated as globally unique.
- Queue indexes follow tenant/day/order and deliberately avoid department/practitioner variants until
  representative plans prove those optional filters need their own write-cost budget.
- The primary queue action is **New walk-in**. The appointment view action is **Book appointment**.
- Staff copy uses “OPD”, “appointment”, “walk-in”, “check in”, and “token”; it does not expose table
  names or invented umbrella terms.
- IPD remains the staff label for future `admissions`; Emergency remains the staff label for future
  `emergency_cases`.

## Task plan

- [x] Slice 1 — Replace the encounter schema with `opd_appointments`, direct financial/file links,
      generated migration, and schema checks.
- [x] Slice 2 — Replace the OPD API with explicit book, walk-in, check-in, reschedule, consultation,
      completion, cancellation, no-show, and left-unseen commands; prove lifecycle, fees, tokens,
      concurrency, attachments, and tenancy through public API tests.
- [x] Slice 3 — Ship the OPD Queue and Appointments views, booking/check-in controls, direct record
      routes, and self-explanatory staff copy using the existing compact console design.
- [x] Slice 4 — Remove obsolete encounter language and files, reconcile billing/dashboard/reporting
      reads, regenerate routes, and update accepted architecture/product documentation.
- [x] Slice 5 — Run typecheck, format/lint, the full integration suite, and rendered UI verification.
- [x] Slice 6 — Charge procedure walk-ins and check-ins through the same configured consultation-fee
      policy as consultation appointments; prove procedure charging and free follow-ups through the
      public API integration seam. Depends on the existing fee and charge transaction boundary.
- [x] Slice 7 — Replace bounded-but-truncating OPD lists with stable keyset pages, page before joining
      display data, and add matching tenant/date/order indexes. Prove complete traversal, stable
      ordering, tenant isolation, and bounded query plans through integration tests and
      `EXPLAIN (ANALYZE, BUFFERS)`. Owns the OPD list API, schema indexes, migration, and list UI.
- [x] Slice 8 — Confirm bookings on their created appointment route, expose direct date selection,
      make cache invalidation exact, keep routine lifecycle transitions outside the audit trail, and
      overlap independent cold reads. Prove the affected unit/integration seams and typecheck.
- [x] Slice 9 — Split the OPD billing route along existing behavior boundaries without introducing a
      framework or compatibility layer. Prove no behavior/type/lint regressions.
- [x] Slice 10 — Run the full repository verification and a fresh-context review of the final diff.

## Verification

- `bun run check-types`
- focused OPD, billing, accounting, dashboard, and tenancy tests after their owning slice
- `bun run check`
- `bun run test`

## Non-goals

- Patient self-service, reminders, recurring appointments, waitlists, capacity engines, or online
  payments.
- Implementing IPD or Emergency before their own accepted workflow slices.
- Compatibility aliases for `opdEncounter`, `clinicalEncounter`, old database tables, or old URLs.
