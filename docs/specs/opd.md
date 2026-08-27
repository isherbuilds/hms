# Spec: OPD catalog-led intake classification

Status: ready
Authority: Current product decision to replace appointment-level `kind` with catalog-category discovery during OPD intake
Supersedes: The `consultation | procedure` appointment `kind` contract formerly recorded in this file and `docs/product.md`

## Problem

The OPD intake asks staff to classify an entire appointment as either a consultation or a procedure while separately adding billable services from the catalog. The two classifications are independent: a procedure appointment can contain no procedure service, and a consultation appointment can contain procedure, lab, or radiology services. The backend does not use appointment `kind` for pricing, queueing, lifecycle, permissions, or clinical state, so the stored value can disagree with the records that actually drive behavior.

The additional-service picker searches all eligible catalog items together. Staff need a compact way to narrow that picker by the catalog categories they already maintain, without turning one category into the identity of an OPD attendance.

## Solution

Remove appointment-level `kind` from OPD intake, API contracts, persistence, list displays, tests, and product documentation. Preserve `arrivalMode` as how the attendance entered OPD and `status` as its lifecycle state.

Keep consultation and follow-up pricing server-authoritative. For immediate intake, the server selects the configured practitioner or department item from patient history. The quote shows it in **Services** by default as an ordinary service line with the same row and remove control as any other service. The server still chooses the consultation or follow-up item, and the additional-service picker excludes consultation-category items. Reception may choose **Omit fee** by sending `omitConsultFee: true`; no reason is required or recorded. If no configured fee or selected service remains, the quote is an ordinary zero quote and walk-in creation produces no Invoice or Payment. Scheduled booking accepts optional selected services as pending price-snapshotted Charges; they remain outside cashier work until check-in. See D017.

Add an optional category filter to the additional-service picker. It narrows the existing active catalog by `procedure`, `lab`, `radiology`, or `other` before applying the current code/name/category text search. The default shows all eligible additional-service categories. Category filtering is local UI state over the catalog data already loaded for intake and does not alter selected lines, API query keys, billing semantics, or clinical state.

## User Stories / Scenarios

1. As front-desk staff, I use **New appointment** to create an immediate or scheduled appointment without classifying the whole attendance as a consultation or procedure.
2. As front-desk staff, I see the server-selected consultation or follow-up fee as a server-owned **Services** line in an immediate quote and cannot replace it with an arbitrary consultation catalog item.
3. As front-desk staff, I can keep the default fee for consultation-only and consultation-plus-procedure attendances.
4. As front-desk staff, I can choose **Omit fee** for a procedure-only or packaged attendance, send the boolean omission choice, and wait for the server to return the quote without the fee. No reason is required or recorded.
5. As front-desk staff, I can restore an omitted fee and receive a new server quote with the configured fee.
6. As front-desk staff, I filter additional services by procedure, lab, radiology, or other and then search within that category.
7. As front-desk staff, I can add services from multiple categories to the same walk-in; changing the filter never removes or reclassifies selected lines.
8. As an operator reading an appointment list or OPD record, I do not see a misleading singular appointment kind.
9. As the system, I keep the immutable invoice note for the existing settlement note and add no omission reason or invoice-note prefix; neither a category nor an omission proves that clinical work was ordered, performed, or resulted.

## Implementation Decisions

### OPD record and lifecycle

- One `opd_appointments` row represents one scheduled or walk-in outpatient attendance. There is no second Visit, OPD Encounter, or Clinical Encounter row.
- `arrivalMode` remains `scheduled | walk_in`; it is independent of lifecycle state.
- Appointment `kind`, including the `OPD_KINDS` export and database column, is removed rather than hidden behind a permanent `consultation` default.
- Existing `kind` values are intentionally discarded by the generated migration. They are not backfilled into charges or another field because they never authoritatively represented billing or clinical work.
- Scheduled work starts `booked` and may hold caller details before a Patient is linked. Booking may atomically snapshot selected non-consultation catalog services as pending Charges. Check-in links or validates the Patient, records `arrivedAt`, allocates the token, and adds the configured attendance Charge. Booked Charges are neither invoiceable nor visible as unbilled cashier/dashboard work until check-in; cancellation and no-show void them.
- Immediate intake requires a Patient and starts `checked_in` with arrival time, token, known Charges, itemized financial document, Payments or Receipts, and ledger posting created atomically.
- D016 defines the active statuses as `booked | checked_in | cancelled | no_show`. Check-in is the only happy-path transition. A booked or checked-in appointment can be cancelled; only a booked appointment can become `no_show`.
- Check-in remains idempotent under concurrency: a booked row receives at most one token and one configured attendance Charge.

### Catalog and billing

- Catalog item `category` remains `consultation | procedure | lab | radiology | other`.
- A prior `checked_in` attendance for the same Patient and Practitioner inside the configured follow-up window may use the follow-up catalog item, including an intentional zero-price item.
- For immediate intake, the server-selected consultation or follow-up item appears in **Services** by default as an ordinary service line with the same row and remove control as any other service and materializes as a `consult_fee` Charge. This supports three cases: consultation-only keeps the attendance fee with no added service; consultation plus procedure keeps the fee and adds the procedure service; procedure-only or packaged attendance sends `omitConsultFee: true` and includes at least one added service.
- **Omit fee** sends `omitConsultFee: true` and requires no reason. The client requests a new authoritative quote; it does not reprice the line or remove it optimistically. **Restore fee** sends `omitConsultFee: false` and requests another quote. This ordinary service-row behavior and boolean wire contract follow D017.
- The server reselects the configured consultation or follow-up item for every quote. When `omitConsultFee` is true, it skips the selected line. If no billable line remains, `quoteWalkIn` returns zero totals. `createWalkIn` creates the checked-in appointment and token but skips Invoice, Payment, Receipt, and journal creation; a zero walk-in cannot accept a discount or payment.
- `opd.createWalkIn` revalidates `settlement.omitConsultFee` inside the D015 transaction and omits the `consult_fee` Charge and consult invoice line when it is true. The server validates the original `settlement.note` independently for the existing discount and unpaid-balance rules and stores that note without an omission reason or invoice-note prefix. The client never constructs an omission note.
- A scheduled appointment uses the same optional Services picker but has no quote, consultation fee, omission choice, or settlement during booking. `opd.book` verifies active tenant-scoped non-consultation items and writes their pending Charge snapshots in the same transaction as the appointment. The current check-in flow retains its configured attendance fee.
- The additional-service picker continues excluding `consultation` category items. Its filter offers `All categories`, `Procedure`, `Lab`, `Radiology`, and `Other` only.
- The server enforces the same boundary. OPD quotes, walk-in creation, and
  `billing.addCharges` reject `consultation` category ids.
- `catalog.searchServices` applies tenant, active, non-consultation, optional category, and code/name/category text predicates in PostgreSQL and returns at most six display rows. Intake never preloads the full catalog. The picker debounces text and sends no all-category request for an empty query.
- Text search and category selection are conjunctive: an item must match the chosen category, when present, and the current code/name/category query.
- Search result ordering and the current result cap remain unchanged. Changing a filter does not mutate already-selected `ServiceLine` values.
- Only services known at intake belong on the initial itemized document. Later services become Charges on the same OPD Appointment.
- A catalog category and a billing line are not proof that a clinical procedure or test was ordered, performed, or resulted. Future clinical workflows use typed child records.

### API and schema contracts

- `opd.book` no longer accepts or defaults a `kind` field.
- `opd.createWalkIn` no longer accepts or defaults a `kind` field.
- `opd.quoteWalkIn` accepts `omitConsultFee: z.boolean().optional()`, defaulting to false. `opd.createWalkIn` accepts `settlement.omitConsultFee: z.boolean().optional()` with the same default. No omission reason field exists.
- `opd.quoteWalkIn` treats `omitConsultFee` as a claim, reselects the configured fee, and skips its line when the claim is true. If no fee is configured, that claim is a harmless no-op. `opd.createWalkIn` repeats the selection and omission check inside the atomic D015 transaction rather than trusting an earlier quote.
- The server validates the original `settlement.note` independently for discount and unpaid-balance requirements and stores it unchanged. Fee omission adds no reason and no invoice-note prefix.
- OPD appointment outputs no longer contain `kind`, including `book`, `createWalkIn`, `checkIn`, `day`, and `get` results that expose appointment columns.
- `opd_appointments.kind` is dropped through a migration generated by `bun run db:generate`; generated migration SQL and metadata are never hand-edited.
- No compatibility alias, inferred replacement field, or silent constant is introduced.
- The client selects `opd.createWalkIn` or `opd.book` from the explicit **When** value. `opd.createWalkIn` accepts no client time claim and stamps the fresh server time. `opd.book` accepts the entered organization-local future minute and validates it against a fresh server instant.

### Staff interface

- Navigation label and URL remain **OPD** and `/$orgSlug/opd`; the page title uses
  the expanded **Outpatient** label.
- The unified OPD day list remains the compact view over booked and checked-in work.
- The day page has one primary action labelled **New appointment**, with a leading plus icon. It opens `/$orgSlug/opd/new`. The dashboard queue does not repeat this action.
- The intake page and meta title use **Appointment**.
- A successful appointment opens its Clinical record, where the patient slip can
  be printed immediately. Billing remains one adjacent tab for invoice and receipt
  outputs. Intake renders no intermediate success page.
- Clinical contains patient, care-team and prescription facts only. Charges, invoices and receipts live in Billing; the Clinical header does not repeat the Billing tab as an action.
- Intake uses one screen with a compact **When** control: **Now** or **Later**. It adds no route or search state.
- **Now** calls `opd.createWalkIn`. The client sends no appointment minute; the server owns the fresh arrival instant and organization business date.
- **Later** reveals one `datetime-local` field labelled **Date and time · `<organization time zone>`**. `opd.book` rejects a value that is not later than the fresh server organization-local minute.
- If the operator cannot settle an immediate appointment, **Now** stays selected and the screen explains the permission block. It never silently schedules the appointment.
- Intake order remains Patient search or inline registration → Department/Practitioner → When → Date and time only for Later → optional searchable services for both modes → financial confirmation for a non-zero Now appointment.
- The Kind control remains removed.
- `ServicePicker` owns a compact `NativeSelect` category filter beside or immediately above its search input, following the existing catalog-settings filter vocabulary and the spacing, focus, and compact-control rules in `docs/design.md`.
- The filter is not persisted in the URL, appointment, local storage, or API input. It resets with a new intake form.
- Care team selection still precedes immediate services so the server can quote the configured attendance price. The consultation or follow-up line belongs to **Services**, not Care team or the additional-service picker. It uses the same row and remove control as any other service. **Omit fee** sends `omitConsultFee: true` and triggers a server requote without a reason; **Restore fee** sends false and requotes. Neither action mutates a quote line locally. See D017.
- After success, the interface still offers the itemized bill, each Payment Receipt, and **Open OPD** as separate actions.

### Lists and concurrency

- Queue ordering remains organization-wide `(arrivedAt, id)`; Appointment ordering remains `(scheduledFor, id)`.
- Operational pages continue polling every 10 seconds and refetching on focus. Existing exact invalidation remains unchanged.
- Removing `kind` does not add or remove an index because no query currently filters or orders by it.

### Documentation ownership

- `docs/product.md` describes `arrivalMode` and lifecycle `status` as the independent OPD dimensions and points here for catalog-led intake behavior.
- This file remains the durable OPD behavior contract after implementation. No ADR is needed because the change removes a non-authoritative field without changing D013's one-record care-setting decision.

## Test Seams

1. **Real-Postgres oRPC integration seam — `tests/integration/opd.test.ts`.** Pin immediate priced and zero-value creation, Later service persistence, booked-work exclusion from cashier/dashboard totals, check-in preservation, cancellation/no-show voiding, lifecycle, and tenancy. Assert that `omitConsultFee` is revalidated inside the transaction and that zero-value creation returns `invoice: null` and rejects any discount or payment.
2. **Generated Drizzle migration seam — `packages/db/src/schema/opd-appointments.ts` plus generated migration metadata.** A clean migrated database has no `opd_appointments.kind` column, while existing OPD constraints and indexes remain intact.
3. **Typed client/API seam — `bun run check-types`.** The intake client compiles only after all `kind` request fields and response reads are removed and both omission fields flow through quote and create inputs; this proves the inferred oRPC contract changed end to end.
4. **UI behavior seam — production build plus browser inspection.** On desktop and mobile, selected service rows add and remove immediately in both modes, search returns no more than six rows, stale quote data never owns editable selection, zero is rendered as a valid amount, and Later selections survive booking and check-in.

## Task Plan

The completed slices below record the earlier `kind` removal and category-filter work. The active attendance-fee omission contract above supersedes their historical assumption that the server-selected line was always non-removable; their completion history is not rewritten.

- [x] Slice 1: Remove appointment `kind` end to end
  - Acceptance: Walk-ins and scheduled appointments can be created and checked in without a `kind` input; all OPD appointment outputs omit `kind`; the generated migration drops the column without changing other lifecycle constraints or indexes; the intake form and scheduled Appointments table no longer display Kind; server-selected consultation/follow-up fees and additional-service charges behave exactly as before; product documentation no longer presents `kind` as an OPD dimension.
  - Verify: `bun run db:generate`; inspect the generated migration and metadata without hand-editing them; `bun run db:up`; `bun run db:migrate`; `bun test --max-concurrency 1 --timeout 15000 tests/integration/opd.test.ts`; `bun run check-types`.
  - Depends on: none.
  - Owns/Touches: `packages/db/src/schema/opd-appointments.ts`; generated files under `packages/db/src/migrations/`; `packages/api/src/routers/opd.ts`; `apps/web/src/components/opd-intake-form.tsx`; `apps/web/src/routes/$orgSlug/opd/index.tsx`; `tests/integration/opd.test.ts`; `docs/product.md`; `docs/specs/opd.md` completed task checkbox only.
  - Interfaces: removes `OPD_KINDS`, `opdAppointments.kind`, and the `kind` properties from `opd.book` and `opd.createWalkIn`; inferred appointment outputs lose `kind`; preserves every catalog, quote, settlement, lifecycle, and tenancy contract.

- [x] Slice 2: Add additional-service category filtering
  - Acceptance: `ServicePicker` defaults to all eligible additional services; staff can narrow results to Procedure, Lab, Radiology, or Other; category and text query filters intersect; consultation items remain excluded under every filter; selecting or changing a category never changes selected service lines; all categories can be combined on one walk-in; the compact control works with keyboard focus and at mobile width.
  - Historical verification used `/$orgSlug/opd/new?mode=walk_in`. The one-screen intake and removal of `mode` are superseded by [`core-screen-refinement.md`](./core-screen-refinement.md); this completed category-filter slice is not evidence for the new entry contract.
  - Depends on: Slice 1.
  - Owns/Touches: `apps/web/src/components/opd-intake-services.tsx`; `docs/specs/opd.md` completed task checkbox only.
  - Interfaces: `ServicePicker` keeps its existing props and `ServiceLine[]` output contract; it adds only private local category-filter state using the client-safe category vocabulary `procedure | lab | radiology | other`.

- [x] Slice 3: Run release-level regression validation
  - Acceptance: The complete repository checks pass after both slices; OPD integration behavior remains tenant-safe; no generated route tree or migration is hand-edited; the durable spec and completed task checkboxes reflect the validated implementation.
  - Verify: `bun run check-types`; `bun run check`; `bun run test`; `bun run build`; final desktop/mobile OPD intake and Appointments inspection.
  - Depends on: Slice 2.
  - Owns/Touches: fixes caused by Slices 1–2 within their listed files; `docs/specs/opd.md` completed task checkboxes only. Unrelated failures are reported, not repaired.
  - Interfaces: consumes the schema, inferred oRPC, and `ServicePicker` contracts from prior slices; produces no new interface.

## Out of Scope

- A primary appointment service or replacement appointment classification field.
- Procedure duration, room or equipment allocation, preparation instructions, consent, worklists, orders, performance records, or results.
- Deriving clinical activity or completion from catalog categories or Charges.
- Changing practitioner, department, consultation, or follow-up fee configuration and selection rules, except for the explicit attendance-fee omission after server selection.
- Changing discount allocation, invoice immutability, receipt numbering, or
  journal rules. The billing screen may batch existing Payment and Charge
  operations, and fee omission adds no invoice-note prefix.
- A new route, appointment kind, pricing table, separate procedure-billing destination, or procedure workflow.
- Giving catalog lines, Charges, fee omission, or invoice notes any clinical order, performance, result, or completion meaning.

## Explicitly Deferred

- Attendance-fee omission for a scheduled appointment is deferred to a separate check-in pricing and persistence spec. Until then, check-in retains the configured attendance fee.
- Clinical procedures and tests continue needing future typed child records before the system can claim they were ordered, performed, or resulted.
- Catalog categories remain a coarse discovery and financial grouping vocabulary. This work does not attempt to create a richer service taxonomy.

## Open Questions

None.
