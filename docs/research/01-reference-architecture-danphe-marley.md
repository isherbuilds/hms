# Reference architecture: DanpheEMR and Marley Health vs this repo

Date: 2026-08-07. Follows [00-synthesis.md](./00-synthesis.md) (landscape pass); this is the
deep primary-source pass. Sources: direct raw-file reads of both repos plus four scout reports
(agent://MarleySpineScout, agent://MarleyOpsScout, agent://DanpheScout — partial, see limits;
two scouts died of context overflow on Danphe/Marley tree listings and were respawned narrower).

## Question

What should we adopt, reject, and fix — in the app and in `docs/` — based on how
DanpheEMR (`opensource-emr/hospital-management-emr`) and Marley Health (`earthians/marley`)
actually model a hospital, compared against our current code?

## Answer (lead)

1. **Our platform spine is ahead of both references; our clinical surface stops at the front
   desk.** Tenancy, permission-guarded procedures, audit, private files, MRN sequencing, and a
   catalog/staff layer exist with tests. Neither reference has first-class tenancy (Marley
   scopes by ERPNext `Company` and its `Patient` has no company field at all; Danphe is
   single-hospital-per-deployment). Everything from appointment onward — encounter, orders,
   results, charges, beds — has zero code here.
2. **Marley is the schema donor; Danphe is the scope checklist and the cautionary tale.**
   Marley's FHIR-shaped spine (generic `Service Request` order, `Observation` with typed
   result polymorphism, explicit status state machines, occupancy rows under a service-unit
   tree) ports cleanly to Drizzle. Danphe's ~40-module list defines what a 20–150-bed hospital
   buys, and its god-controllers/`VisitBL` cross-module billing sync show the coupling to avoid.
3. **Docs have drifted from the code.** `project-intent.md` still says the first real domain is
   `settings`; the live router exports `patient`, `catalog`, `staff`, `dashboard`
   (packages/api/src/routers/index.ts:12–21). The `/ai` endpoint is a second org-authorized
   surface outside the "single `/rpc` client" rule and is documented nowhere. No architecture
   doc covers the clinical domain layer. Concrete fixes listed below.

## Evidence

### A. What the references actually do

**Marley clinical spine** (all from `healthcare/healthcare/doctype/<name>/<name>.json`, branch
`develop`; field tables in agent://MarleySpineScout):

- `patient`: demographics + `status` (Active/Disabled), `blood_group`, `uid`, allergy /
  medical / surgical history text fields, relations child table; ERP links (`customer`,
  `customer_group`, price list). **No `company`/tenant field** — grep for
  `"fieldname": "company"` in patient.json matches nothing (agent://MarleyOpsScout).
- `patient_encounter`: required `patient`, `practitioner`, `appointment_type`, date+time;
  status `Open/Ordered/Completed/Cancelled`; child tables for symptoms, diagnosis, drug /
  lab / procedure prescriptions; links to `inpatient_record`, insurance policy/coverage.
- `service_request`: the generic order. `template_dt`/`template_dn` (dynamic pointer to the
  orderable's template), `order_group` (encounter), `status`/`intent`/`priority` as links to a
  `Code Value` terminology table, `billing_status`, read-only `item_code` → ERP `Item`.
  Controller gates execution on payment (`process_service_request_only_if_paid` in
  `healthcare_settings.json`) and materializes `Lab Test` / `Clinical Procedure` /
  `Observation` from the request (`service_request.py`).
- `observation`: template-driven (`observation_template` carries data type, unit, options) with
  typed value columns — `result_text/float/boolean/datetime/select/attach/period_*` — gated by
  `permitted_data_type`; status `Registered/Preliminary/Final/Amended/…`. Not EAV, not JSON.
- `patient_appointment`: status machine `Scheduled/Open/Confirmed/Checked In/Checked Out/
Closed/Cancelled/No Show`; practitioner/department/service-unit targeting; `billing_item`,
  `invoiced`, `paid_amount` billing fields on the appointment itself.
- Inpatient (`inpatient_record.json`, `inpatient_occupancy.json`,
  `healthcare_service_unit(_type).json`, agent://MarleyOpsScout): facility is a **tree** of
  service units (parent link + `company`); the unit's _type_ carries the billing shape
  (`inpatient_occupancy`, `is_billable`, `item`, `no_of_hours`, `rate`,
  `minimum_billable_qty`). Bed occupancy is a child table of rows
  `{service_unit, check_in, check_out, left, invoiced}`; a scheduled job
  (`add_occupied_service_unit_in_ip_to_billable` in `hooks.py`) turns open occupancies into
  billables.
- Orders→charges: one aggregator, `get_healthcare_services_to_invoice` in
  `healthcare/healthcare/utils.py`, enumerates appointments, encounters, labs, procedures,
  inpatient occupancies and service requests and normalizes them into Sales Invoice lines.
  Everything billable ultimately points at an ERP `Item`.
- Permissions: Frappe role × action matrices in each DocType JSON (Physician, Nursing User,
  Laboratory User, Healthcare Administrator); clinical docs are submittable (`docstatus`)
  which makes them append-only after submit.

**DanpheEMR** (agent://DanpheScout + prior pass; depth limits below):

- Module list ≈ the segment's purchase checklist: Registration, Appointment, Visit, Billing,
  Pharmacy, Lab, Radiology, Nursing, ADT, Inventory, Accounting, Emergency, Medical Records
  (README.md; controller inventory in `Code/Websites/DanpheEMR/DanpheEMR.csproj`).
- Separate controllers per domain: `AppointmentController` (`CheckClashingAppointment`,
  `UpdateAppointmentStatus`…), `VisitController` (`NewVisit`, `VisitFromOnlineAppointment`,
  visit context/history), `BillingController` (provisional/unpaid/settlement queries).
- `VisitBL.cs` hand-syncs requisition billing status across lab/radiology inside visit logic —
  the cross-module coupling Marley solves with one aggregator, and the strongest argument for
  a single charges table.

### B. What we have (local, verified)

- Routers: `dashboard, settings, audit, files, members, patient, catalog, staff`
  (packages/api/src/routers/index.ts:12–21). All through `orgProcedure(permission, input)`.
- Permissions: `member, patient, catalog, staff, settings, audit, storage, ai` —
  packages/auth/src/access.ts:16–28. No appointment/encounter/order/billing statements yet.
- `patients` table: `orgId NOT NULL`, per-org unique MRN, name/phone/sex/dob-or-age/address,
  keyset index (packages/db/src/schema/patients.ts:19–63). MRN from per-org `counter` table
  (packages/db/src/schema/counter.ts) inside the register transaction
  (packages/api/src/routers/patient.ts).
- `catalog_items` with category enum `consultation|procedure|lab|radiology|other` and price/tax
  constraints (packages/db/src/schema/catalog-items.ts); `departments` ("referenced by … and by
  visits" comment — visits already anticipated, packages/db/src/schema/departments.ts);
  `practitioners` with `memberUserId` and a consult-fee FK into catalog
  (packages/db/src/schema/practitioners.ts).
- `/ai`: hand-rolled Hono POST outside oRPC, manual `authorizeOrg(context, orgSlug,
{ ai: ["use"] })` and manual 401/403 mapping (apps/server/src/index.ts:119–163).
- Tests cover tenancy, patients, counters, catalog/staff, files, settings cache, request
  lifecycle, ai auth (tests/integration/_, tests/unit/_).

### C. Doc drift (each claim has both sides cited)

1. `docs/contributing/project-intent.md:20–21` — "The worked example (`todo`) has been replaced
   by the first real domain: `settings`. `files`, `members`, and `audit` are not examples."
   Code now ships `patient`, `catalog`, `staff`, `dashboard` routers
   (packages/api/src/routers/index.ts:12–21) and an `ai` permission
   (packages/auth/src/access.ts:27). The intent doc predates the HMS pivot and never mentions it.
2. AGENTS.md hard rule 2: org pages use "the single `/rpc` client". `/ai` is a second
   org-authorized HTTP surface (apps/server/src/index.ts:119–163) consumed by
   apps/web/src/routes/org/$orgSlug/ai.tsx. No ADR sanctions the exception —
   docs/contributing/decisions/index.md:22–37 lists 0001–0016, none about AI or non-oRPC
   endpoints.
3. `docs/contributing/architecture/` has no page for the domain layer: MRN/counter sequencing,
   catalog, staff/practitioner↔member linkage are undocumented. "patient" appears in docs only
   as a hypothetical in audit.md:44 and ADR 0005:16 (grep of docs/contributing for
   `patient|front-desk|practitioner|catalog`).
4. `docs/contributing/index.md` does not link `docs/research/` — this and 00-synthesis are
   undiscoverable from the docs entry point.

## What this proves / does not prove

- **Proves**: the schema shapes, state machines, and integration seams described above exist in
  both reference repos as of 2026-08-07 (`develop`/`master` branches); the local claims exist at
  the cited lines.
- **Does not prove**: anything about adoption, workflow fit, or operational quality of either
  reference; that Marley's shapes are FHIR-_conformant_ (its own API surface is one portal
  module, not a FHIR server — agent://MarleyOpsScout).
- **Not verified (blocked)** *(at the time of this pass)*: Danphe's field-level entity classes,
  its RBAC/audit tables, and tenancy columns. Its entity project lives outside
  `Code/Websites/DanpheEMR/` (no `ServerModel/` there — tree read 2026-08-07) and the repo's
  GitHub tree pages are too large for web-read recon; two scouts exhausted context on it.
  **Closed 2026-08-10** by the offline-clone pass in
  [04-danphe-marley-entity-deep-dive.md](./04-danphe-marley-entity-deep-dive.md): the entity
  layer is `Code/Components/DanpheEMR.ServerModel/`; RBAC, tenancy-column, and billing-entity
  claims are confirmed there (doc 04 E1–E8), superseding the [INFERENCE] markers here and in
  00-synthesis.

## What this means for us

### Docs improvements (do these now; they are drift, not new scope)

| #   | Fix                                                                                                                                                                                                      | Where                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| D1  | Rewrite "What it is not" to name the actual product direction (HMS) and current domains: patient, catalog, staff, dashboard, ai.                                                                         | docs/contributing/project-intent.md:15–23               |
| D2  | ADR for the `/ai` endpoint: a sanctioned second surface (streaming doesn't fit oRPC) with the same `authorizeOrg` guard — or a decision to fold it into oRPC. Today it silently contradicts hard rule 2. | docs/contributing/decisions/ (new 0017)                 |
| D3  | Architecture page for the domain layer: MRN generation (counter + settings prefix, in-transaction), catalog as the chargeable-item registry, practitioner↔member linkage, front-desk flow.               | docs/contributing/architecture/ (new page + index link) |
| D4  | Link `docs/research/` from the contributing index so research is discoverable.                                                                                                                           | docs/contributing/index.md                              |
| D5  | ADR for MRN strategy (org-scoped counter, prefix from settings, gapless-within-transaction) — it will be re-litigated otherwise.                                                                         | docs/contributing/decisions/                            |
| D6  | Update AGENTS.md's project map when D1–D3 land (it already lists commands/rules correctly; the "first real domain: settings" framing echoes there via project-intent).                                   | AGENTS.md, project-intent.md                            |

### App improvements (priority order; every shape references the donor)

1. **Appointment + visit/encounter with explicit status machines.** Adopt Marley's enums as
   Postgres text enums: appointment `scheduled → checked_in → closed/cancelled/no_show`
   (trim the 8-state list to what front desk needs day one), encounter
   `open → ordered → completed/cancelled`. Our own schema comments already promise visits
   (departments.ts, practitioners.ts consult-fee comment). Follow the org-scoped-feature skill;
   new `appointment`/`encounter` permission statements in access.ts.
2. **One generic `orders` table, not per-modality tables.** Marley's `service_request` maps to:
   `{id, orgId, encounterId, patientId, catalogItemId, category (from catalog enum),
status, billingStatus, orderedBy practitionerId, orderedAt}`. Danphe's `VisitBL`
   requisition-sync pain is the counter-example to per-module order tables.
3. **Charges as first-class rows.** Every billable event inserts a charge
   `{orgId, patientId, visitId, catalogItemId, sourceType, sourceId, qty, price, status}`.
   Marley needs a 6-doctype aggregator (`get_healthcare_services_to_invoice`) because charges
   are scattered; a single charges table makes invoicing one query. Consult fee auto-charge at
   visit creation (already hinted in practitioners.ts) is the first producer.
4. **Patient master, small additions on the next migration touching it**: `status`
   (active/disabled), optional `email`, `bloodGroup`, `allergies`/`medicalHistory` text,
   optional secondary identifier column (`uid`) reserved for national IDs (ABDM ABHA later).
   All present in Marley's patient.json; none require new infrastructure. Do **not** copy its
   ERP fields (customer, price list, territory).
5. **When lab lands: template + typed-value observation.** `observation_template` defining
   data type/unit/reference range, observation rows with typed `result_*` columns — reject EAV
   and reject JSON blobs; Marley proves the typed-column shape works at 130-doctype scale.
6. **When beds land: service-unit tree + occupancy rows.** Unit type carries billability
   (`isBillable`, `catalogItemId`, rate basis); occupancy `{serviceUnitId, checkIn, checkOut}`
   rows; bed-day charges computed at discharge or by a nightly job (Marley does the latter via
   scheduler hook).
7. **Finalization = immutability.** Marley's submittable docstatus ≙ status-guarded read-only:
   once an encounter is `completed`, mutations are rejected and the compliance audit entry is
   written inside the same transaction (AGENTS.md hard rule 3 already mandates the transactional
   variant for patient data).

### Rejects (decided; do not re-import)

- Frappe's dynamic metadata/DocType model and layout-mixed-with-schema fields — we are
  typed-SQL-first.
- ERP coupling (Customer/Item/Sales Invoice links inside clinical rows) — our catalog is the
  item registry; money stays in our own charge/invoice tables.
- Billing logic inside clinical lifecycle hooks (Marley `validate/on_submit`; Danphe `VisitBL`)
  — charges are produced at the seam, invoicing consumes the charges table.
- Danphe's god controllers and its desktop-era module sprawl as an architecture (keep it only
  as a scope checklist).
- `Company`-lookup tenancy — both references confirm our explicit `orgId NOT NULL` + guard
  approach is the stronger invariant (Marley's Patient has no tenant key at all).

## Next falsification

- ~~Shallow-clone Danphe (`git clone --depth 1`) and read `DanpheEMR.ServerModel`/DAL entities
  offline to confirm or kill the remaining [INFERENCE] claims (billing entity shape, RBAC
  tables, HospitalId columns). Web reads are not viable.~~ **Done 2026-08-10** — see
  [04-danphe-marley-entity-deep-dive.md](./04-danphe-marley-entity-deep-dive.md).
- Prototype the appointment+encounter slice (improvement 1) behind the org-scoped-feature
  skill and check whether the trimmed status machines survive contact with front-desk UX.
- If ABDM becomes the regulatory target, verify Marley's ABDM code actually lives in a separate
  Frappe app (scout found none in `earthians/marley` — contradicts 00-synthesis §1, which
  should be marked superseded on this point).

## Sources

- https://github.com/earthians/marley — DocType JSONs and controllers under
  `healthcare/healthcare/doctype/`, `healthcare/healthcare/utils.py`, `healthcare/hooks.py`,
  `patient_portal/` (branch `develop`, read 2026-08-07).
- https://github.com/opensource-emr/hospital-management-emr — README, `DanpheEMR.csproj`,
  `Controllers/Appointment/{Appointment,Visit}Controller.cs`, `Controllers/Appointment/VisitBL.cs`,
  `Controllers/Billing/BillingController.cs` (branch `master`, read 2026-08-07).
- Local: packages/api/src/routers/_, packages/auth/src/access.ts, packages/db/src/schema/_,
  apps/server/src/index.ts, apps/web/src/routes/org/$orgSlug/_, docs/contributing/_, tests/*.
- Scout reports: agent://MarleySpineScout, agent://MarleyOpsScout, agent://DanpheScout.
