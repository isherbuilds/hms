# Research: Is the v0 Service Catalog flexible enough?

Date: 2026-08-07. Status: canonical conclusion for the Slice 4 catalog review.
Branch: reference architecture — compare two production HMS codebases against our
`catalog_items` model before approving Slice 4.

## Question

Our v0 catalog is one flat tenant table — `{ name, code, category enum, unitPrice,
taxRatePercent, taxCode, active }` — with a single optional `consultFeeItemId` per
practitioner, and Charges that snapshot price/tax at creation. Is that flexible enough for an
Indian OPD pilot's first year, judged against how mature HMS products model the same domain?

References studied (source code, default branches as of 2026-08-07):

- **Danphe EMR** — `opensource-emr/hospital-management-emr@master`
  (HEAD `9963822`), ASP.NET Core + SQL Server, deployed in South-Asian hospitals. Closest
  analog to the pilot.
- **Frappe Health** — `earthians/marley@develop` (HEAD `d737a93`), Frappe/ERPNext healthcare
  app widely deployed in India.

## Answer

**The flat catalog is the right v0 shape, with one real gap: follow-up consultation
pricing.** Both references treat "new consult vs follow-up" as first-class; our single
`consultFeeItemId` cannot express it, and it lands squarely in Slice 5's auto-charge path.
Everything else the references add (price categories/schemes, packages, per-line performers,
department revenue mapping) serves payer mixes and IPD we have explicitly excluded from v0 —
and our charge-snapshot design is exactly what makes each of them **additive later** rather
than a migration. Spec amended accordingly (follow-up fee in Slice 5; the rest recorded as
deliberate deferrals).

## Evidence

### 1. The item master itself is flat in both references too

- Danphe's `BillServiceItemModel` is identity + flags only: `ItemCode`, `ItemName`,
  `ServiceDepartmentId`, `ServiceCategoryId`, `IsActive`, `IsTaxApplicable`,
  `IsDoctorMandatory` — the price does **not** live on the item
  (`Code/Components/DanpheEMR.ServerModel/BillingModels/Config/BillServiceItemModel.cs:12-34`;
  a legacy price-on-item class survives as `BillItemPrice_Old_16thFeb_23`, same file :47-74).
- Frappe Health keeps only `is_billable` + `rate` + an ERPNext `Item` link on its service
  templates and delegates pricing to ERPNext `Item Price`/`Price List`
  (`healthcare/doctype/clinical_procedure_template/clinical_procedure_template.py`,
  `lab_test_template.py` — `update_item_and_item_price`).
- Both snapshot economics onto billed lines exactly as we do: Danphe's
  `BillingTransactionItemModel` stores `Price`, `TaxPercent`, `Tax`, `TotalAmount` per line
  (`BillingModels/POS/BillingTransactionItemModel.cs:16-48`); Frappe Health writes
  `item.rate = charge` at invoice creation (`patient_appointment.py`).

### 2. Follow-up consult pricing is first-class in both — our gap

- Danphe: **per-doctor** `OpdNewPatientServiceItemId`, `OpdOldPatientServiceItemId`,
  `FollowupServiceItemId` on the employee, with department-level fallbacks
  (`EmployeeModels/Employee.cs:97-101`; `MasterModels/DepartmentModel.cs:38-42`).
- Frappe Health: fee-validity — `enable_free_follow_ups`, `max_visits`, `valid_days` in
  `Healthcare Settings`, resolved per appointment (`healthcare_settings.json`;
  `healthcare/utils.py` charge resolution: practitioner → appointment type → settings).
- Ours: a single `consultFeeItemId`. A returning patient inside the follow-up window would be
  charged the full consult fee with no systemic recourse but a manual discount — the
  front-desk workflow both references consider table stakes.

### 3. Price categories / schemes — real, but built for payer mixes v0 excludes

- Danphe's pricing pivot is `(PriceCategoryId, ServiceItemId) → Price`
  (`BillMapPriceCategoryServiceItemModel.cs:9-15`), with payer Schemes mapped to price
  categories (`BillMapPriceCategorySchemeModel.cs:9-13`), per-item scheme discounts split
  OP/IP plus copay (`BillServiceItemSchemeSettingModel.cs:12-18`), and the visit carrying
  `PriceCategoryId` + `SchemeId` (`AppointmentModels/VisitModel.cs:75-80`).
- Frappe Health reaches the same via ERPNext Price Lists per `Appointment Type`, and payer
  behaviour only through `Patient Insurance Coverage` overrides (`healthcare/utils.py`).
- Our decision record excludes insurance/TPA from v0 and sequences it last in the expansion
  roadmap (`docs/01-mvp-decisions.md:34-35`, `:52-53`). A cash-price pilot has exactly one
  price category.

### 4. Price-change history

- Danphe keeps `BillItemPriceHistory` rows with `StartDate`/`EndDate`
  (`BillingModels/Logs/BillItemPriceHistory.cs:13-20`); Frappe Health gets dating from
  ERPNext `Item Price.valid_from`.
- Ours overwrote `unitPrice` in place with no record beyond the bare `catalog.update` audit
  action. Closed in this change: `catalog.update` now writes the new
  `unitPrice`/`taxRatePercent`/`active` into audit `meta`
  (`packages/api/src/routers/catalog.ts`), so successive entries reconstruct the timeline.
  Billed data was never at risk — charges snapshot.

### 5. Packages/panels, per-line performer, department mapping — deferred with evidence

- Packages: Danphe `BillingPackageModel` + `BillingPackageServiceItemModel`
  (`BillingPackageModel.cs:8-25`, `BillingPackageServiceItemModel.cs:9-15`); Frappe Health
  grouped lab templates (`lab_test_template.json`, `lab_test_template_type: Grouped`).
- Per-line performer for doctor-share payouts: Danphe stores `PerformerId`/`PerformerName`
  on every billed line (`BillingTransactionItemModel.cs:16-21`).
- Billing-department linkage on items: Danphe `ServiceDepartmentId` (distinct from clinical
  department, `ServiceDepartmentModel.cs:14-27`); Frappe templates carry
  `medical_department`.
- Category masters: Danphe categories are an org-editable table
  (`BillServiceCategoryModel.cs:8-18`); ours is a closed enum — deliberate, because consult
  ordering (Slice 7 restricts orders to lab/radiology/procedure) and Tally ledger mapping key
  off it. Adding a value later is one additive enum migration.

## What this proves / does not prove

- Proves: the reference systems' item masters are as flat as ours; their flexibility lives in
  **satellite tables keyed by item id** (price maps, scheme settings, package members) plus
  line-level snapshots — a topology our schema and charge-snapshot rule already support
  additively. Proves both references treat follow-up pricing as core OPD behaviour.
- Does not prove: that the pilot hospital will demand any specific satellite (schemes,
  packages) in year one — that is a `validate-idea`/pilot question, not a code question.
  Danphe runtime _guards_ (vs. model shapes) were read only at the model layer
  ([INFERENCE] runtime enforcement assumed from model design).

## What this means for us

1. **Amend Slice 5** (done, this change): practitioners gain nullable `followUpFeeItemId`;
   `organization_settings` gains `followUpValidityDays` (default 14, org-editable). Visit
   creation charges the follow-up item when the patient has a completed visit with the same
   practitioner inside the window; falls back to `consultFeeItemId` when unset. Additive
   columns — Slice 4 as built is unaffected.
2. **Keep the flat catalog.** Price categories/schemes, packages, per-line performer, and a
   billing-department column are recorded as deliberate deferrals in the spec; each is a new
   table (or nullable column) keyed by `catalogItems.id`, and charge snapshots mean no
   historical repricing on adoption.
3. **Price history** now rides the audit trail (`catalog.update` meta).
4. Registration/MRN-card fee, if the pilot charges one, is already expressible as a catalog
   item (`category: "other"`) added as a manual charge in Slice 6 — no schema change.

## Next falsification

Pilot onboarding questionnaire: (a) does the hospital run distinct cash tariffs (EHS/corporate
rates) today — if yes, the price-category map moves from deferred to scheduled; (b) actual
follow-up window and whether follow-ups are free or reduced-fee; (c) whether any health
package (e.g. master health check) is sold at the front desk today.

## Sources

- https://github.com/opensource-emr/hospital-management-emr (master @ `9963822`) — paths cited
  inline under `Code/Components/DanpheEMR.ServerModel/`.
- https://github.com/earthians/marley (develop @ `d737a93`) — paths cited inline under
  `healthcare/healthcare/`.
- `docs/01-mvp-decisions.md` — v0 non-goals and expansion sequence.
- Agent transcripts: `history://DanpheCatalog2`, `history://MarleyCatalog` (line-level
  excerpts).
