# Spec: OPD catalog-led intake classification

Status: ready
Authority: Current product decision to replace appointment-level `kind` with catalog-category discovery during OPD intake
Supersedes: The `consultation | procedure` appointment `kind` contract formerly recorded in this file and `docs/product.md`

## Problem

The OPD intake asks staff to classify an entire appointment as either a consultation or a procedure while separately adding billable services from the catalog. The two classifications are independent: a procedure appointment can contain no procedure service, and a consultation appointment can contain procedure, lab, or radiology services. The backend does not use appointment `kind` for pricing, queueing, lifecycle, permissions, or clinical state, so the stored value can disagree with the records that actually drive behavior.

The additional-service picker searches all eligible catalog items together. Staff need a compact way to narrow that picker by the catalog categories they already maintain, without turning one category into the identity of an OPD attendance.

## Solution

Remove appointment-level `kind` from OPD intake, API contracts, persistence, list displays, tests, and product documentation. Preserve `arrivalMode` as how the attendance entered OPD and `status` as its lifecycle state.

Keep consultation and follow-up pricing server-authoritative. The server continues to choose the configured practitioner or department catalog item using patient history; staff do not manually select ordinary consultation items from the additional-service picker.

Add an optional category filter to the additional-service picker. It narrows the existing active catalog by `procedure`, `lab`, `radiology`, or `other` before applying the current code/name/category text search. The default shows all eligible additional-service categories. Category filtering is local UI state over the catalog data already loaded for intake and does not alter selected lines, API query keys, billing semantics, or clinical state.

## User Stories / Scenarios

1. As front-desk staff, I create a walk-in or scheduled appointment without classifying the whole attendance as a consultation or procedure.
2. As front-desk staff, I see the server-selected consultation or follow-up fee in the walk-in quote and cannot accidentally replace it with an arbitrary consultation catalog item.
3. As front-desk staff, I filter additional services by procedure, lab, radiology, or other and then search within that category.
4. As front-desk staff, I can add services from multiple categories to the same walk-in; changing the filter never removes or reclassifies selected lines.
5. As an operator reading an appointment list or OPD record, I do not see a misleading singular appointment kind.
6. As the system, I continue treating billed service categories as financial facts only; they do not prove that clinical work was ordered, performed, or resulted.

## Implementation Decisions

### OPD record and lifecycle

- One `opd_appointments` row represents one scheduled or walk-in outpatient attendance. There is no second Visit, OPD Encounter, or Clinical Encounter row.
- `arrivalMode` remains `scheduled | walk_in`; it is independent of lifecycle state.
- Appointment `kind`, including the `OPD_KINDS` export and database column, is removed rather than hidden behind a permanent `consultation` default.
- Existing `kind` values are intentionally discarded by the generated migration. They are not backfilled into charges or another field because they never authoritatively represented billing or clinical work.
- Scheduled work starts `booked` and may hold caller details before a Patient is linked. Check-in atomically links or validates the Patient, records `arrivedAt`, allocates the daily practitioner token, and creates the configured attendance Charge.
- Walk-ins require a Patient and start `waiting` with arrival time, token, known Charges, itemized financial document, Payments or Receipts, and ledger posting created atomically.
- Active flow remains `waiting → in_consult → completed`. Waiting exits are `cancelled` and `left_unseen`; booked exits are `cancelled` and `no_show`.
- Check-in remains idempotent under concurrency: a booked row receives at most one token and configured attendance Charge.

### Catalog and billing

- Catalog item `category` remains `consultation | procedure | lab | radiology | other`.
- A completed same-Patient, same-Practitioner attendance inside the configured follow-up window may use the follow-up catalog item, including an intentional zero-price item.
- The server-selected consultation or follow-up item remains a `consult_fee` Charge and is not part of the editable additional-service selection.
- The additional-service picker continues excluding `consultation` category items. Its filter offers `All categories`, `Procedure`, `Lab`, `Radiology`, and `Other` only.
- The server enforces the same boundary. OPD quotes, walk-in creation, and
  `billing.addCharge` reject `consultation` category ids.
- Filtering is performed client-side against the already-prefetched active catalog. It adds no catalog endpoint call, server filter contract, loading state, or tenant cache key.
- Text search and category selection are conjunctive: an item must match the chosen category, when present, and the current code/name/category query.
- Search result ordering and the current result cap remain unchanged. Changing a filter does not mutate already-selected `ServiceLine` values.
- Only services known at intake belong on the initial itemized document. Later services become Charges on the same OPD Appointment.
- A catalog category and a billing line are not proof that a clinical procedure or test was ordered, performed, or resulted. Future clinical workflows use typed child records.

### API and schema contracts

- `opd.book` no longer accepts or defaults a `kind` field.
- `opd.createWalkIn` no longer accepts or defaults a `kind` field.
- OPD appointment outputs no longer contain `kind`, including `book`, `createWalkIn`, `checkIn`, `appointments`, `queue`, and `get` results that expose appointment columns.
- `opd_appointments.kind` is dropped through a migration generated by `bun run db:generate`; generated migration SQL and metadata are never hand-edited.
- No compatibility alias, inferred replacement field, or silent constant is introduced.
- Catalog and settlement API contracts do not change.

### Staff interface

- Navigation label and URL remain **OPD** and `/$orgSlug/opd`.
- **Queue** and **Appointments** remain compact views over the same record set.
- Primary actions remain **New walk-in** and **Book appointment**. Both use `/$orgSlug/opd/new`; the compact `Now | Later` field changes intake mode.
- Intake order remains Patient search or inline registration → Department/Practitioner → When → searchable known services → financial confirmation.
- The Kind control is removed. The remaining When row is reflowed without leaving an empty column.
- The scheduled Appointments table removes its Kind column and preserves useful density for time, patient or caller, practitioner, status, and actions.
- `ServicePicker` owns a compact `NativeSelect` category filter beside or immediately above its search input, following the existing catalog-settings filter vocabulary and the spacing, focus, and compact-control rules in `docs/design.md`.
- The filter is not persisted in the URL, appointment, local storage, or API input. It resets with a new intake form.
- Care team selection still precedes services so the server can quote the configured attendance price.
- After success, the interface still offers the itemized bill, each Payment Receipt, and **Open OPD** as separate actions.

### Lists and concurrency

- Queue ordering remains organization-wide `(arrivedAt, id)`; Appointment ordering remains `(scheduledFor, id)`.
- Operational pages continue polling every 10 seconds and refetching on focus. Existing exact invalidation remains unchanged.
- Removing `kind` does not add or remove an index because no query currently filters or orders by it.

### Documentation ownership

- `docs/product.md` describes `arrivalMode` and lifecycle `status` as the independent OPD dimensions and points here for catalog-led intake behavior.
- This file remains the durable OPD behavior contract after implementation. No ADR is needed because the change removes a non-authoritative field without changing D013's one-record care-setting decision.

## Test Seams

1. **Real-Postgres oRPC integration seam — `tests/integration/opd.test.ts`.** Book and create walk-in appointments without `kind`; assert their lifecycle, consultation/follow-up fee selection, settlement, check-in, and tenant behavior remain unchanged. Appointment responses must not expose a `kind` property. Remove tests whose only purpose was proving that procedure `kind` persisted while still receiving a consultation fee.
2. **Generated Drizzle migration seam — `packages/db/src/schema/opd-appointments.ts` plus generated migration metadata.** A clean migrated database has no `opd_appointments.kind` column, while existing OPD constraints and indexes remain intact.
3. **Typed client/API seam — `bun run check-types`.** The intake client compiles only after all `kind` request fields and response reads are removed; this proves the inferred oRPC contract changed end to end.
4. **UI behavior seam — production build plus browser inspection.** On desktop and mobile, the Kind control and appointment-list column are absent; category filtering intersects with text search; consultation items remain unavailable as additional services; selected lines survive filter changes; keyboard focus, light/dark themes, empty results, and narrow layouts remain usable. There is no existing component-test harness for this picker, so this focused interaction is verified visually rather than creating a new test framework.

## Task Plan

- [x] Slice 1: Remove appointment `kind` end to end
  - Acceptance: Walk-ins and scheduled appointments can be created and checked in without a `kind` input; all OPD appointment outputs omit `kind`; the generated migration drops the column without changing other lifecycle constraints or indexes; the intake form and scheduled Appointments table no longer display Kind; server-selected consultation/follow-up fees and additional-service charges behave exactly as before; product documentation no longer presents `kind` as an OPD dimension.
  - Verify: `bun run db:generate`; inspect the generated migration and metadata without hand-editing them; `bun run db:up`; `bun run db:migrate`; `bun test --max-concurrency 1 --timeout 15000 tests/integration/opd.test.ts`; `bun run check-types`.
  - Depends on: none.
  - Owns/Touches: `packages/db/src/schema/opd-appointments.ts`; generated files under `packages/db/src/migrations/`; `packages/api/src/routers/opd.ts`; `apps/web/src/components/opd-intake-form.tsx`; `apps/web/src/routes/$orgSlug/opd/index.tsx`; `tests/integration/opd.test.ts`; `docs/product.md`; `docs/specs/opd.md` completed task checkbox only.
  - Interfaces: removes `OPD_KINDS`, `opdAppointments.kind`, and the `kind` properties from `opd.book` and `opd.createWalkIn`; inferred appointment outputs lose `kind`; preserves every catalog, quote, settlement, lifecycle, and tenancy contract.

- [x] Slice 2: Add additional-service category filtering
  - Acceptance: `ServicePicker` defaults to all eligible additional services; staff can narrow results to Procedure, Lab, Radiology, or Other; category and text query filters intersect; consultation items remain excluded under every filter; selecting or changing a category never changes selected service lines; all categories can be combined on one walk-in; the compact control works with keyboard focus and at mobile width.
  - Verify: `bun run check-types`; `bun run check`; `bun run build`; browser-inspect `/$orgSlug/opd/new?mode=walk_in` in light and dark themes at desktop and mobile widths, covering keyboard operation, each category, no matches, changing filters after selection, and settlement review.
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

- Selecting, storing, or charging planned services while booking a scheduled appointment.
- A primary appointment service or replacement appointment classification field.
- Procedure duration, room or equipment allocation, preparation instructions, consent, worklists, orders, performance records, or results.
- Deriving clinical activity or completion from catalog categories or Charges.
- Changing practitioner, department, consultation, follow-up, discount, payment, invoice, receipt, or journal rules.
- Server-side catalog searching, pagination, or a new catalog endpoint.
- A separate procedure-billing destination.

## Explicitly Deferred

- Scheduled appointments continue recording patient or caller, care team, and time only. If real scheduling workflows need planned services, they will add typed appointment-planning records with an explicit policy for price changes and charge materialization; this change does not prebuild that model.
- Clinical procedures and tests continue needing future typed child records before the system can claim they were ordered, performed, or resulted.
- Catalog categories remain a coarse discovery and financial grouping vocabulary. This work does not attempt to create a richer service taxonomy.
- The picker keeps its existing client-side result cap and active-catalog preload until measured catalog size or latency justifies server-side search.

## Open Questions

None.
