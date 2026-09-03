# Reference HMS: financial idempotency, roles, no-show, worklists, and the catalog primitive

Pinned 2026-09-03. Bahmni `bahmni-core@04a5299` (+ `openerp-modules@420cf5d`,
`openmrs-module-appointments@2e8cef8`, OpenMRS core `44dbfc1`, emrapi `99437ae`,
Odoo 7 `0127935`); Danphe `hospital-management-emr@9963822`; Marley
`earthians/marley@f8f07f9` (+ `frappe@cd0eadc`, `erpnext@f895103`). Snapshots age;
re-verify before reusing for a new decision.

## Questions

1. How do the references prevent a duplicate financial document when a request is
   retried after a lost response (D023)?
2. How do they gate corrections (credit note, refund, cancel) relative to ordinary
   billing?
3. How do stale scheduled appointments become no-show, and do reports share that
   boundary?
4. Is a single `catalog_items` table the right billable-item primitive once
   pharmacy, lab, IPD, and OT arrive, and how do the references keep that table
   from becoming a god table or a duplicated master?
5. What do their unbilled, refund-due, day-close, and OPD-register read models
   look like?

## Answers

1. **None of the three has a client-supplied operation key for financial writes.**
   Each has only partial guards: Frappe row-locks its naming counter and rejects
   re-submission of a source already flagged `invoiced`, but the flag check is
   check-then-set; Danphe allocates numbers with `MAX()+1` at ReadUncommitted and
   retries only the number collision; Bahmni's only real replay guard is the Odoo
   atom-feed consumer deduplicating by source event id. The D023 design (client
   operation id + scoped unique constraint + replay of the stored result) is
   stronger than every reference; there is no donor implementation to copy.
2. **Corrections are gated above collection everywhere they are gated at all.**
   ERPNext lets Accounts User create/submit invoices and payments but reserves
   Sales Invoice (and therefore credit-note) cancellation to Accounts Manager;
   Danphe names separate cancel/return/settlement permissions but does not
   enforce them at the API. No reference splits refund from credit note. HMS's
   single `billing:creditNote` grant covering both is consistent with the
   strictest reference.
3. **Both references with a mechanism write stored state on a daily scheduler and
   let reports read stored status only.** Neither reconciles lazily on read.
   Marley excludes `Confirmed` from its sweep, so confirmed-then-missed rows never
   become No Show — a trap HMS's four-state model does not have.
4. **Yes, a flat billable-item table is the right primitive — provided domain
   masters link to it rather than extend it.** Marley (ERPNext `Item`) and Danphe
   (`BillServiceItem`) both keep one thin billing identity and hang drug, lab, bed,
   procedure, and package semantics off separate masters that _reference_ it.
   Nobody stores drug strength, batch/expiry, lab reference ranges, or per-day bed
   rules on the billing item, and nobody duplicates price on the domain master.
5. **All references compute worklists and day-close from source documents in SQL,
   never from the general ledger.** Marley's `get_healthcare_services_to_invoice`
   is the strongest donor for a cross-domain unbilled list. ERPNext's Sales
   Payment Summary is the donor shape for Daily Collections (date × mode × sales,
   returns, payments). No reference ships a refund-due list; Danphe computes
   patient refund lazily per patient.

## Evidence

### Q1 Idempotency

| Reference      | What exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | What does not                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frappe/ERPNext | `naming_series` counter `SELECT … FOR UPDATE` ([naming.py#L428-L446](https://github.com/frappe/frappe/blob/cd0eadcd91a4c487db9f21919a2e5b2af7fc4da9/frappe/model/naming.py#L428-L446)); optimistic `modified` check on the document being saved ([document.py#L1384-L1412](https://github.com/frappe/frappe/blob/cd0eadcd91a4c487db9f21919a2e5b2af7fc4da9/frappe/model/document.py#L1384-L1412)); `insert(ignore_if_duplicate=…)` exists but callers do not use it ([document.py#L699-L749](https://github.com/frappe/frappe/blob/cd0eadcd91a4c487db9f21919a2e5b2af7fc4da9/frappe/model/document.py#L699-L749))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | No request key.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Marley         | Appointment invoicing checks `invoiced`, creates+submits Sales Invoice, then sets the flag ([patient_appointment.py#L529-L600](https://github.com/earthians/marley/blob/f8f07f919d8da2e47400a40d546b64c12e180260/healthcare/healthcare/doctype/patient_appointment/patient_appointment.py#L529-L600)); submit hook rejects an already-invoiced source ([utils.py#L1029-L1045](https://github.com/earthians/marley/blob/f8f07f919d8da2e47400a40d546b64c12e180260/healthcare/healthcare/utils.py#L1029-L1045)); Emergency has an active-reference guard ([emergency_record.py#L237-L299](https://github.com/earthians/marley/blob/f8f07f919d8da2e47400a40d546b64c12e180260/healthcare/healthcare/doctype/emergency_record/emergency_record.py#L237-L299))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Gateway payment record: `payment_id` unique, target not; each capture creates a new invoice ([healthcare_payment_record.py#L34-L84](https://github.com/earthians/marley/blob/f8f07f919d8da2e47400a40d546b64c12e180260/healthcare/healthcare/doctype/healthcare_payment_record/healthcare_payment_record.py#L34-L84)); claim `create_payment_entry` has no existing-payment guard ([insurance_claim.py#L299-L428](https://github.com/earthians/marley/blob/f8f07f919d8da2e47400a40d546b64c12e180260/healthcare/healthcare/doctype/insurance_claim/insurance_claim.py#L299-L428)). [INFERENCE] check-then-set races duplicate under concurrency.                                                                                                                                                                                                                                                                                                                                                                                                              |
| Danphe         | Retry on SQL 2627 invoice-number collision ([BillingTransactionBL.cs#L587-L610](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Websites/DanpheEMR/Controllers/Billing/BillingTransactionBL.cs#L587-L610))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Invoice/deposit/receipt numbers are `MAX()+1` at ReadUncommitted ([BillingBL.cs#L49-L115](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Websites/DanpheEMR/Controllers/Billing/BillingBL.cs#L49-L115)); credit note and settlement likewise ([BillReturnController.cs#L488-L573](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Websites/DanpheEMR/Controllers/Billing/BillReturnController.cs#L488-L573), [BillingSettlementBL.cs#L451-L460](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Websites/DanpheEMR/Controllers/Billing/BillingSettlementBL.cs#L451-L460)); models carry no request key or version token ([BillingTransactionModel.cs#L12-L80](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Components/DanpheEMR.ServerModel/BillingModels/POS/BillingTransactionModel.cs#L12-L80)). |
| Bahmni/Odoo    | Clinical: `BahmniEncounterTransaction` forwards a caller `encounterUuid` and emrapi's matcher upserts within the visit ([BahmniEncounterTransaction.java#L65-L72](https://github.com/Bahmni/bahmni-core/blob/04a5299ed6be35f40fdaebb1f17e3c19cc052742/bahmni-emr-api/src/main/java/org/openmrs/module/bahmniemrapi/encountertransaction/contract/BahmniEncounterTransaction.java#L65-L72), [DefaultEncounterMatcher.java#L28-L42](https://github.com/openmrs/openmrs-module-emrapi/blob/99437ae2317c6748ec87d954c4a16e20bd8665b5/api/src/main/java/org/openmrs/module/emrapi/encounter/matcher/DefaultEncounterMatcher.java#L28-L42)). Billing feed consumer dedups by `external_order_id` and processed-order markers ([order_save_service.py#L54-L75](https://github.com/Bahmni/openerp-modules/blob/420cf5d0e69198f39611423ac110dd2ccf21921e/bahmni_atom_feed/order_save_service.py#L54-L75), [#L109-L123](https://github.com/Bahmni/openerp-modules/blob/420cf5d0e69198f39611423ac110dd2ccf21921e/bahmni_atom_feed/order_save_service.py#L109-L123)). Odoo invoice numbers come from a locked sequence and move creation skips invoices with `move_id` ([account_invoice.py#L892-L910](https://github.com/odoo/odoo/blob/01279359b9e5340d5ecb15f0fee186f039356374/addons/account/account_invoice.py#L892-L910)). | Refund wizard calls `invoice.refund` on every execution ([account_invoice_refund.py#L91-L117](https://github.com/odoo/odoo/blob/01279359b9e5340d5ecb15f0fee186f039356374/addons/account/wizard/account_invoice_refund.py#L91-L117)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

HMS already has what the references use for numbering: a row-locked counter
(`packages/db/src/counter.ts:5-23`) and a journal unique on
`(orgId, sourceType, sourceId)` (`packages/db/src/schema/journal-entries.ts:22`).
It lacks the source-event key that makes Bahmni's consumer replay-safe.

### Q2 Roles

- ERPNext: Accounts User creates/submits Sales Invoice but cannot cancel; Accounts Manager cancels ([sales_invoice.json#L2409-L2458](https://github.com/frappe/erpnext/blob/f8951034bef98c20c363ca9b774269b5d9517e33/erpnext/accounts/doctype/sales_invoice/sales_invoice.json#L2409-L2458)); credit note is `is_return`/`return_against` on the same doctype ([#L343-L350](https://github.com/frappe/erpnext/blob/f8951034bef98c20c363ca9b774269b5d9517e33/erpnext/accounts/doctype/sales_invoice/sales_invoice.json#L343-L350)). Marley clinical matrices are per-DocType JSON ([patient_appointment.json#L586-L626](https://github.com/earthians/marley/blob/f8f07f919d8da2e47400a40d546b64c12e180260/healthcare/healthcare/doctype/patient_appointment/patient_appointment.json#L586-L626)).
- Danphe: DB-backed RBAC ([RbacDbContext.cs#L19-L43](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Components/DanpheEMR.Security/RbacDbContext.cs#L19-L43)); separate cancel/return/settlement _view_ permissions ([BillingViewController.cs#L1-L130](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Websites/DanpheEMR/Controllers/Billing/BillingViewController.cs#L1-L130)); API permission checks explicitly disabled ([DanpheActionFilter.cs#L117-L218](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Websites/DanpheEMR/Controllers/DanpheActionFilter.cs#L117-L218)).
- Bahmni: OpenMRS roles inherit and aggregate privileges ([Role.java#L21-L24](https://github.com/openmrs/openmrs-core/blob/44dbfc1c345a6c2a2ddb27c9dcc729903394ee59/api/src/main/java/org/openmrs/Role.java#L21-L24)); resetting an appointment to Scheduled needs a distinct privilege ([PrivilegeConstants.java#L3-L12](https://github.com/Bahmni/openmrs-module-appointments/blob/2e8cef8b5037b397da796374e2d8edaf8c5ba099/api/src/main/java/org/openmrs/module/appointments/PrivilegeConstants.java#L3-L12)); Odoo refund uses `base.group_user` ([account_invoice_view.xml#L296-L307](https://github.com/odoo/odoo/blob/01279359b9e5340d5ecb15f0fee186f039356374/addons/account/account_invoice_view.xml#L296-L307)).

### Q3 No-show

- Marley: `set_status` on every save marks past non-terminal rows No Show ([patient_appointment.py#L130-L146](https://github.com/earthians/marley/blob/f8f07f919d8da2e47400a40d546b64c12e180260/healthcare/healthcare/doctype/patient_appointment/patient_appointment.py#L130-L146)); daily scheduler ([hooks.py#L142-L150](https://github.com/earthians/marley/blob/f8f07f919d8da2e47400a40d546b64c12e180260/healthcare/hooks.py#L142-L150)) excludes Closed/Cancelled/**Confirmed** ([#L1240-L1260](https://github.com/earthians/marley/blob/f8f07f919d8da2e47400a40d546b64c12e180260/healthcare/healthcare/doctype/patient_appointment/patient_appointment.py#L1240-L1260)); analytics reads stored status only ([patient_appointment_analytics.py#L107-L137](https://github.com/earthians/marley/blob/f8f07f919d8da2e47400a40d546b64c12e180260/healthcare/healthcare/report/patient_appointment_analytics/patient_appointment_analytics.py#L107-L137)).
- Bahmni: `MarkAppointmentAsMissedTask` daily, off by default ([MarkAppointmentAsMissedTask.java#L15-L37](https://github.com/Bahmni/openmrs-module-appointments/blob/2e8cef8b5037b397da796374e2d8edaf8c5ba099/api/src/main/java/org/openmrs/module/appointments/scheduler/tasks/MarkAppointmentAsMissedTask.java#L15-L37), [liquibase.xml#L269-L289](https://github.com/Bahmni/openmrs-module-appointments/blob/2e8cef8b5037b397da796374e2d8edaf8c5ba099/api/src/main/resources/liquibase.xml#L269-L289)).
- Danphe: free-form status string, no no-show state or job ([AppointmentController.cs#L1106-L1128](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Websites/DanpheEMR/Controllers/Appointment/AppointmentController.cs#L1106-L1128)).

### Q4 Catalog primitive

**Marley / ERPNext — one `Item`, many templates that link to it.**
Clinical Procedure Template creates a non-stock service Item + Item Price when none is linked ([clinical_procedure_template.py#L77-L110](https://github.com/earthians/marley/blob/f8f07f919d8da2e47400a40d546b64c12e180260/healthcare/healthcare/doctype/clinical_procedure_template/clinical_procedure_template.py#L77-L110)); Lab Test Template does the same and owns sample/components/ranges ([lab_test_template.py#L103-L144](https://github.com/earthians/marley/blob/f8f07f919d8da2e47400a40d546b64c12e180260/healthcare/healthcare/doctype/lab_test_template/lab_test_template.py#L103-L144)); Therapy Plan Template is a package: one Item priced at the summed components ([therapy_plan_template.py#L10-L54](https://github.com/earthians/marley/blob/f8f07f919d8da2e47400a40d546b64c12e180260/healthcare/healthcare/doctype/therapy_plan_template/therapy_plan_template.py#L10-L54)); procedure consumables are child Item rows with qty/UOM/batch and an invoice-separately flag ([clinical_procedure_item.json](https://github.com/earthians/marley/blob/f8f07f919d8da2e47400a40d546b64c12e180260/healthcare/healthcare/doctype/clinical_procedure_item/clinical_procedure_item.json#L1-L91)); Healthcare Service Unit Type (bed/room) links an Item and defines UOM, hours-per-unit, minimum qty, rate, and inpatient billing derives qty from occupancy hours ([healthcare_service_unit_type.json](https://github.com/earthians/marley/blob/f8f07f919d8da2e47400a40d546b64c12e180260/healthcare/healthcare/doctype/healthcare_service_unit_type/healthcare_service_unit_type.json#L1-L100), [utils.py#L472-L594](https://github.com/earthians/marley/blob/f8f07f919d8da2e47400a40d546b64c12e180260/healthcare/healthcare/utils.py#L472-L594)). ERPNext `Item` owns stock/sales flags, batch/expiry, UOM, and per-company income/expense accounts via Item Default ([item.json#L243-L278](https://github.com/frappe/erpnext/blob/f8951034bef98c20c363ca9b774269b5d9517e33/erpnext/stock/doctype/item/item.json#L243-L278), [item_default.json#L300-L350](https://github.com/frappe/erpnext/blob/f8951034bef98c20c363ca9b774269b5d9517e33/erpnext/stock/doctype/item_default/item_default.json#L300-L350)); payer tariffs are Price List overrides plus Item Insurance Eligibility, not columns on Item ([item_insurance_eligibility.json](https://github.com/earthians/marley/blob/f8f07f919d8da2e47400a40d546b64c12e180260/healthcare/healthcare/doctype/item_insurance_eligibility/item_insurance_eligibility.json#L1-L190)).

**Danphe — one `BillServiceItem`, domain masters integrate into it.**
`BillServiceItem` carries identity, department, and `IntegrationName/Id` ([BillServiceItemModel.cs#L8-L44](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Components/DanpheEMR.ServerModel/BillingModels/Config/BillServiceItemModel.cs#L8-L44)); price/tax/discount resolve through a price-category map ([BillingMasterService.cs#L245-L286](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Websites/DanpheEMR/Controllers/Billing/BillingMasterService.cs#L245-L286)). Saving a bed feature auto-creates a linked `BillServiceItem` with `IntegrationName='Bed Charges'` ([ADTSettingsController.cs#L789-L863](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Websites/DanpheEMR/Controllers/Settings/ADTSettingsController.cs#L789-L863)); lab tests own components ([LabTestModel.cs#L16-L77](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Components/DanpheEMR.ServerModel/LabModels/LabTestModel.cs#L16-L77)); packages are compositions of service items ([BillingPackageServiceItemModel.cs#L9-L20](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Components/DanpheEMR.ServerModel/BillingModels/Config/BillingPackageServiceItemModel.cs#L9-L20)). **The duplication to avoid:** pharmacy has its own `PHRM_ItemMaster` with its own price map and its own invoice document ([PHRMItemMasterModel.cs#L13-L59](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Components/DanpheEMR.ServerModel/PharmacyModels/PHRMItemMasterModel.cs#L13-L59), [PharmacyBL.cs#L846-L853](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Websites/DanpheEMR/Controllers/Pharmacy/PharmacyBL.cs#L846-L853)), so pharmacy sales bypass the billing document, its worklists, and its ledger mapping.

**Bahmni — clinical catalog and commercial catalog are different systems.**
OpenMRS `Concept`/`Drug`/`OrderSet` are the clinical primitives ([Concept.java#L84-L130](https://github.com/openmrs/openmrs-core/blob/44dbfc1c345a6c2a2ddb27c9dcc729903394ee59/api/src/main/java/org/openmrs/Concept.java#L84-L130), [Drug.java#L28-L54](https://github.com/openmrs/openmrs-core/blob/44dbfc1c345a6c2a2ddb27c9dcc729903394ee59/api/src/main/java/org/openmrs/Drug.java#L28-L54)); a `saleable` concept attribute marks what is sold ([liquibase.xml#L12-L29](https://github.com/Bahmni/bahmni-core/blob/04a5299ed6be35f40fdaebb1f17e3c19cc052742/reference-data/omod/src/main/resources/liquibase.xml#L12-L29)); Odoo `product.product` is the commercial item, synced by UUID ([reference_data_service.py#L12-L48](https://github.com/Bahmni/openerp-modules/blob/420cf5d0e69198f39611423ac110dd2ccf21921e/bahmni_atom_feed/reference_data_service.py#L12-L48), [drug_service.py#L14-L38](https://github.com/Bahmni/openerp-modules/blob/420cf5d0e69198f39611423ac110dd2ccf21921e/bahmni_atom_feed/drug_service.py#L14-L38)). Two catalogs kept in sync by a feed is the cost of that split.

**HMS today.** `catalog_items` is already the thin billing identity: name, code, category, price, tax, active (`packages/db/src/schema/catalog-items.ts:36-69`). `charges` snapshot price/tax/`revenueCategory` and carry `sourceType in ('consult_fee','catalog')` + `sourceId` (`charges.ts:29-37,52`); `revenueAccountFor(category)` routes revenue (`packages/api/src/lib/ledger.ts:60-74`); practitioners/departments reference fee items by composite tenant FK (`practitioners.ts:45-52`, `departments.ts:21-24`). D024 already forbids billing lab/radiology at the OPD desk.

### Q5 Worklists and day-close

- Marley: one aggregator, `get_healthcare_services_to_invoice`, to which every domain contributes rows filtered by `invoiced = 0` ([utils.py#L31-L50](https://github.com/earthians/marley/blob/f8f07f919d8da2e47400a40d546b64c12e180260/healthcare/healthcare/utils.py#L31-L50), [#L67-L185](https://github.com/earthians/marley/blob/f8f07f919d8da2e47400a40d546b64c12e180260/healthcare/healthcare/utils.py#L67-L185)). ERPNext Sales Payment Summary: date × owner × mode × sales/returns/payments ([sales_payment_summary.py#L290-L374](https://github.com/frappe/erpnext/blob/f8951034bef98c20c363ca9b774269b5d9517e33/erpnext/accounts/report/sales_payment_summary/sales_payment_summary.py#L290-L374)); POS Closing Entry: per-mode opening/expected/closing/difference ([pos_closing_entry.py#L268-L369](https://github.com/frappe/erpnext/blob/f8951034bef98c20c363ca9b774269b5d9517e33/erpnext/accounts/doctype/pos_closing_entry/pos_closing_entry.py#L268-L369)). No refund-due or OPD register.
- Danphe: `SP_Report_BIL_DailySales` split into invoices/returns/deposits/settlements/user collection/payment mode ([BillingReportsController.cs#L408-L440](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Websites/DanpheEMR/Controllers/Reporting/BillingReportsController.cs#L408-L440)); patient refund computed lazily from documents ([BillingController.cs#L5831-L5980](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Websites/DanpheEMR/Controllers/Billing/BillingController.cs#L5831-L5980)); `CounterDay` recorded but no close command ([BillingTransactionItemModel.cs#L35-L45](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Components/DanpheEMR.ServerModel/BillingModels/POS/BillingTransactionItemModel.cs#L35-L45)).
- Bahmni/Odoo: seed filters for today's/yesterday's collections by journal ([filters.xml#L46-L78](https://github.com/Bahmni/openerp-modules/blob/420cf5d0e69198f39611423ac110dd2ccf21921e/bahmni_seed_setup/data/filters.xml#L46-L78)); a standalone IPD/OPD SQL aggregate ([bahmni_sale_ipd_opd_report.sql#L4-L37](https://github.com/Bahmni/openerp-modules/blob/420cf5d0e69198f39611423ac110dd2ccf21921e/bahmni_sale_ipd_opd_report.sql#L4-L37)).

### Q6 Tenancy

None of the three has an `orgId` tenant model; Danphe's accounting has a
session-selected hospital partition, Odoo has company record rules. Not
comparable to HMS's explicit per-request claim (D001).

## What this proves / does not prove

- Proves: no mature open-source HMS in this set solves lost-response retry with a
  request key; the guards that exist are numbering locks and check-then-set flags.
  HMS's D023 plan is not over-engineering relative to peers — it is ahead of them.
- Proves: the "one thin billable item + domain masters that link to it" shape is
  the convergent design in two independent codebases, and the one place a
  reference duplicated the master (Danphe pharmacy) it also forked the invoice,
  worklist, and ledger path.
- Does not prove: how these designs behave under Indian pharmacy pricing (MRP per
  batch) or GST at scale — none of the references was read for tax handling here.
- Does not prove: operational fit. Source code shows shape, not how a cashier
  reconciles a shift.

## What this means for HMS

1. **Idempotency (item 2 of the pending plan).** Build the operation-id design as
   specified in D023; widen it to `settleCharges` and `createWalkIn`, which also
   mint documents. Replay must return stored document numbers, not reallocate —
   Frappe's counter lock and Odoo's `move_id` skip are the analogues. No reference
   offers a copyable implementation.
2. **Roles.** Keep one correction grant (`billing:creditNote` covering credit note
   and refund) and give it to accountant/administrator, not cashier. This matches
   ERPNext's user/manager split; a separate refund grant has no reference support.
3. **No-show.** Lazy reconciliation before authoritative reads (D016 + reports
   spec) is a legitimate substitute for the references' daily job, on the
   condition the report path calls the same helper. Do not copy Marley's
   `Confirmed` exclusion.
4. **Catalog — keep `catalog_items` thin and make domain masters point at it.**
   - `catalog_items` stays the billable identity: name, code, category, price,
     tax, active. Nothing domain-specific is added to it — no `kind` discriminator,
     no nullable drug/lab/bed columns, no `details jsonb`.
   - Each future domain owns its master with a **required** composite tenant FK
     `(orgId, catalogItemId) → catalog_items(orgId, id)` and a unique on that pair
     so one billable item has at most one domain identity: `drugs` (generic,
     strength, form, schedule, HSN) with `drug_batches` (batch, expiry, MRP, qty);
     `lab_tests` (sample, TAT, components/panels, reference ranges); `bed_types`
     (per-day/hour, minimum units); `packages` with `package_components`
     (`packageItemId`, `componentItemId`, qty). The link direction is domain →
     catalog, as in both references, so `catalog_items` never grows polymorphic
     columns.
   - `charges.sourceType/sourceId` is already the extension point:
     `drug_dispense`, `lab_order`, `bed_day`, `package` join `consult_fee` and
     `catalog`; `charges.catalogItemId` stays NOT NULL because every billable
     event has a billable identity. Price _source_ becomes domain-specific (batch
     MRP for drugs, occupancy × rate for beds) but the snapshot on the Charge is
     unchanged — no second money record.
   - `category` remains the routing key for `revenueAccountFor`; a domain master's
     category is constrained by its domain (`drugs` → `pharmacy`, `lab_tests` →
     `lab`), which is how D024's "bill where the work is ordered" extends without
     a desk-side rule per domain.
   - Payer tariffs and price lists are additive satellites keyed by
     `catalogItemId` (already the ledger's position), never columns on the item.
   - Anti-pattern to refuse explicitly: a second items table with its own
     name/price/tax and its own invoice type. That is Danphe's pharmacy fork and
     it splits worklists, day-close, and the ledger.
5. **Worklists.** Generalise `billing.worklist` as Marley does — one list, each
   domain contributing rows for its own pending Charges — rather than one list
   per domain. Daily Collections takes ERPNext's Sales Payment Summary shape
   (date × method × payments/refunds/net). A cashier-closing entity stays a
   non-goal until the pilot proves the report plus SOP insufficient (reports spec).

## Next falsification

- Idempotency: write the concurrency test first (two identical operation ids in
  flight against `createWalkIn`); if the unique constraint plus `23505` handling
  does not make the loser return the winner's result, the design needs a
  pre-insert marker row, not a post-hoc lookup.
- Catalog: before the first pharmacy table, model one real drug with two batches
  at different MRPs through Charge → Invoice → GST register on paper. If the
  Charge snapshot cannot carry batch identity without a new money column, the
  "price source is domain-specific" claim is wrong.
- Roles: walk the cashier/accountant split with the pilot shift lead against real
  end-of-day corrections; if the cashier must issue credit notes unsupervised,
  the ERPNext-shaped split does not fit this hospital.

## Sources

Repositories and pins are listed in the header; every claim above links to the
owning file at that pin. Internal references are `file:line` in this repository
at the working tree of 2026-09-03.
