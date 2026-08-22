# Patient flow end to end — registration → visit → token → charge → invoice → receipt, across OPD, IPD and ER

Date: 2026-08-21. Branch: reference architecture. Status: external flow evidence; its former
`visits`/financial-wrapper recommendations are superseded by
[ADR 0022](../contributing/decisions/0022-care-settings-are-separate-destinations.md) and
[ADR 0023](../contributing/decisions/0023-charges-hang-off-the-clinical-encounter.md).
Extends [11-appointment-vs-visit-boundary.md](11-appointment-vs-visit-boundary.md) and
[04-danphe-marley-entity-deep-dive.md](04-danphe-marley-entity-deep-dive.md) as source comparisons.
Use this document for the ordered operational flow, not as the current HMS schema authority.

Fresh primary-source pass against new shallow clones: Danphe @ `9963822`, Marley @ `ac8a300`
(2026-08-17 — **newer than every prior pass**, and it ships a module that did not exist before).

## Question

The user-facing flow is "patient → billing → receipt/token". What is actually written, in what
order, at each step — and how does that sequence change for OPD, IPD and emergency? Where does the
token attach, where does money attach, and what is the physical artifact the desk hands over?

## Answer (lead)

1. **There is no one flow. Each reference runs three intake pipelines that converge only at the
   money layer.** OPD, IPD and ER have separate entry documents, separate state machines and
   separate exit conditions in both products. Neither models IPD or ER as a _mode_ of the OPD
   flow. Our single `visits` table with `visitClass in ('opd','ipd','er')`
   (`packages/db/src/schema/visits.ts:33`) is one row shape for three flows, and it will break at
   the second one — the IPD "visit" has no token, no single practitioner and no same-day close;
   the ER "visit" may have no identified patient.

2. **Money direction reverses between OPD and IPD.** OPD: care first, money follows — payment
   gates neither the token nor the consult in either reference. IPD: money gates **both ends** —
   an advance against a costed plan before admission, and full billing before discharge. Frappe
   enforces the exit gate literally: `discharge_patient` calls `validate_inpatient_invoicing`,
   which throws on any unbilled service unless an explicit setting overrides it
   (`inpatient_record.py:450-491`).

3. **The token is an OPD-only artifact.** ER runs an acuity-ordered triage queue with no number;
   IPD has no queue at all. Danphe's queue query excludes inpatient visits outright
   (`QueueManagementService.cs:34-40`); Frappe's `position_in_queue` exists only on
   `Patient Appointment`, and its brand-new `Emergency Record` has no queue field.

4. **New since all prior research: Frappe Health now ships a first-class Emergency module.**
   `Emergency Record`, `Triage Level`, `Emergency Occupancy` — with provisional patient creation
   for the unidentified, its own bed occupancy, its own disposition machine and its own invoice.
   ER is a **fourth order context** alongside appointment / encounter / inpatient record, not a
   subtype of any of them. Doc 04 §E7 read ER only in Danphe and concluded we must "model it
   fresh"; there is now a donor shape.

5. **Neither reference numbers a receipt separately from the bill.** Danphe persists one
   fiscal-year `InvoiceNo` per bill and leaves `ReceiptNo` `[NotMapped]`
   (`BillingTransactionModel.cs:47-52, 84-85`); Marley has no receipt document at all — money is
   an ERPNext Sales Invoice plus Payment Entry. Our per-payment gapless `receipt:{fiscalYear}`
   series (`packages/api/src/routers/billing.ts:462-473`) is the outlier in both. This closes the
   doc 04 §E3 question with a two-reference answer, though not with a regulatory one.

6. **The artifact Danphe hands the patient at the desk is a sticker, not a receipt.** It carries
   MRN, visit code, department, performer, **queue number and ticket charge** on one slip, and its
   fields are toggled by a settings row keyed on visit type
   (`RegistrationStickerSettings_DTO.cs:12-33`, `VisitStickerData_DTO.cs:12-33`). Token and money
   proof are the same piece of paper, and OPD / IPD / ER each get a different layout.

## Evidence

### F1 — Danphe OPD: one transaction, five writes, token last

`VisitController.CreatePatientVisit` (`VisitController.cs:548-608`) runs inside one
`BeginTransaction()`: `AddPatientForVisit` → `AddPatientCareTaker` → `AddVisit` → (ER department
only) `AddEmergencyPatient` → `AddBillingTransactionForPatientVisit` → `SavePatientScheme` →
`Commit()`. The queue number is allocated **after** the commit, by
`VisitBL.CreateNewPatientQueueNo(...)` (`VisitController.cs:601`) via `SP_VISIT_SetNGetQueueNo`.

[INFERENCE] Token allocation outside the transaction means a crash between commit and token leaves
a visit with no queue number. Ours allocates the token _inside_ the transaction
(`packages/api/src/routers/visit.ts:141-142`) and is strictly safer.

Billing status is **decided** at creation, never enforced (`VisitController.cs:908-915`): credit
payment mode → `unpaid`, otherwise `paid`. Verified again this pass; see doc 11 §E3 for the quote.

### F2 — Danphe carries three orthogonal status axes on the visit row

`shared-enums.ts:40-43` — `ENUM_VisitStatus = initiated | cancel`. That is the whole lifecycle
axis. Clinical progress lives on a separate `QueueStatus` field (`pending` and free-form strings
set by `updateQueueStatus`, `QueueManagementService.cs:70-80`), and money lives on `BillingStatus`
(`paid | unpaid | provisional | cancel | returned | free`, `shared-enums.ts:1-8`).

Our `visits.status` (`waiting | in_consult | completed | cancelled`,
`packages/db/src/schema/visits.ts:52-55`) merges Danphe's lifecycle and queue axes into one column
and has no money axis at all. That merge is defensible for OPD-only. It is the column that will
not survive IPD, where "the patient is here" runs for days and the queue axis is meaningless.

### F3 — Danphe's queue query has two exclusions worth knowing

`QueueManagementService.GetAppointmentData` (`QueueManagementService.cs:34-40`) filters:
`VisitStatus == "initiated"`, today's date, `VisitType != inpatient`,
`BillingStatus != returned`, department must have `IsAppointmentApplicable`, **and
`visit.Ins_HasInsurance == null`**.

So inpatients never appear in the queue, unpaid patients do, and **insured patients are silently
dropped from the queue board**. The last one is a defect, not a pattern — do not copy it, but do
recognise the shape: a queue view is a filtered projection over visits, and every payer or class
exception someone adds becomes another `AND` in that filter. Gate on "not voided", nothing else.

### F4 — Danphe's desk artifact merges token and money proof, and is per-visit-type configurable

`VisitStickerData_DTO.cs:12-33` fields: `HospitalNumber` (MRN), `PatientName`, `Gender`, `DOB`,
`Address`, `Phone`, `VisitCode`, `VisitDateTime`, `VisitTypeFormatted`, `AppointmentType`,
`DepartmentName`, `PerformerName`, `TicketCharge`, `WardName`, `BedNumber`, `ClaimCode`,
`SchemeCode`, `MemberNo`, `QueueNo`.

`RegistrationStickerSettings_DTO.cs:12-33` is a stored config row per sticker: `VisitType`,
`IsDefaultForCurrentVisitType`, and booleans `ShowSchemeCode`, `ShowMemberNo`, `ShowClaimCode`,
`ShowIpdNumber`, `ShowWardBedNo`, `ShowRegistrationCharge`, `ShowPatContactNo`,
`ShowPatientDesignation`, `ShowQueueNo` — plus relabelable `VisitDateLabel`, `QueueNoLabel`,
`MemberNoLabel`, `PatientDesignationLabel`.

Separate sticker components exist for OPD, ADT/IPD, emergency and billing
(`wwwroot/DanpheApp/src/app/appointments/opd-sticker`, `adt/sticker`,
`shared/emergency-sticker`, `billing/bill-sticker`). Four artifacts, one data shape, a settings
row choosing which fields print.

### F5 — Danphe numbering: one numbered financial document per bill

`BillingTransactionModel.cs:47-52` persists `FiscalYearId` and `InvoiceNo`; `:84-85` marks
`ReceiptNo` `[NotMapped]` — computed for display, never stored. Re-verified this pass, confirming
doc 04 §E3.

### F6 — Marley OPD: booking and billing are independent axes, token comes at check-in

Unchanged at `ac8a300` from doc 11 §E4, re-verified: `set_status` (`patient_appointment.py:130-146`)
runs `Scheduled → Open/Confirmed → Checked In → Checked Out → Closed` plus `Cancelled`/`No Show`;
`set_position_in_queue` (`:467-498`) returns early unless status is exactly `Checked In`, then
takes `max + 1` within a practitioner/time/service-unit partition — payment appears nowhere in it.
Walk-ins set `appointment_based_on_check_in` (`:149-162, 275-276`), which drops the slot
requirement rather than adding a table.

Orders are the generic `Service Request`, and _execution_ — not the token, not the consult — is
what Healthcare Settings can gate on payment (`process_service_request_only_if_paid`).

### F7 — Marley IPD: an advance gate at the front and a billing gate at the exit

The admission path is a chain of five documents:

1. `Patient Encounter` sets an admission order; `create_treatment_counselling`
   (`inpatient_record.py:732`) opens a **Treatment Counselling**.
2. `Treatment Counselling` (`treatment_counselling.json`) costs a `Treatment Plan Template` against
   a price list into `amount` / `paid_amount` / `outstanding_amount`, carries
   `expected_length_of_stay` and `admission_service_unit_type`, and stamps
   `Patient Encounter.inpatient_status = "Treatment Counselling Created"`
   (`treatment_counselling.py:52-59`). It is **submittable** — append-only after submit.
3. `create_payment_entry` (`treatment_counselling.py:171-188`) raises an ERPNext Payment Entry for
   the full `outstanding_amount`. This is the admission advance.
4. `create_ip_from_treatment_counselling` (`:161-168`) creates the Inpatient Record and flips the
   counselling to `Completed`. Record status runs
   `Admission Scheduled → Admitted → Discharge Scheduled → Discharged` (plus `Cancelled`).
5. Bed time is interval rows in `Inpatient Occupancy`; a scheduled job
   `add_occupied_service_unit_in_ip_to_billables` (`inpatient_record.py:793-803`) converts open
   occupancies of `Admitted`/`Discharge Scheduled` records into billables nightly.

Exit is gated. `discharge_patient` (`:450-462`) calls, in order, `validate_nursing_tasks`,
`validate_inpatient_invoicing`, `validate_incomplete_service_requests`, and only then checks out
beds and sets `Discharged`. `validate_inpatient_invoicing` (`:464-491`) throws with a table of
unbilled documents unless `Healthcare Settings.allow_discharge_despite_unbilled_services` is on.

Two clinical gates and one money gate stand between "doctor says go home" and "bed is free".

### F8 — Marley ER: a fourth first-class context (new module, not in any prior pass)

`Emergency Record` (`emergency_record.json`, controller `emergency_record.py`, 367 lines):

- **Unidentified intake is the default path, not an exception.** `before_insert` calls
  `create_provisional_patient` (`:36-45`) when `patient` is empty: a real Patient row named from
  `patient_description` or "Unidentified Patient", sex defaulting to "Other", under its own
  `ER-.YYYY.-` naming series. `merge_patient` (`:52-62`) later renames-and-merges it into the real
  record via `frappe.rename_doc(..., merge=True)`.
- **Status machine:** `Registered → Triaged → In Treatment → Awaiting Disposition → Closed`, plus
  `Cancelled` — read-only, moved only by whitelisted methods.
- **Disposition machine:** `Discharged | Admitted | Transferred | Left Without Being Seen |
Deceased`. `set_disposition` (`:202-212`) stamps the disposition, calls `admit_to_inpatient` when
  it is `Admitted`, releases the bed, and closes the record — one method, one transition.
- **Triage is a table, not strings.** `Triage Level` carries `code`, `color`, `priority` (int) and
  `target_reassessment_mins`. `record_triage` (`:92-98`) stamps `triage_datetime` and lifts
  `Registered → Triaged`. This is the direct fix for the "four mutable strings" caution in doc 04 §E7.
- **Beds:** `Emergency Occupancy` interval rows; `occupy_service_unit` (`:117-129`) reads
  `Healthcare Service Unit.occupancy_status` `for_update=True` and throws if not `Vacant` — a real
  row lock, which is the pattern our bed work should copy.
- **Billing:** `create_sales_invoice` (`:238-268`) refuses a second invoice, then bills the
  consultation item plus each occupancy at `ceil(hours / no_of_hours)` blocks floored at
  `minimum_billable_qty` (`occupancy_qty`, `:324-326`). Money runs **after** care, and admission
  from ER (`admit_to_inpatient`, `:213-237`) inserts the Inpatient Record with
  `ignore_permissions=True` and no advance-payment step — the IPD money gate of F7 is bypassed on
  the emergency path.
- **The "patient is currently in ER" flag is a pointer on the patient row.** `after_insert` sets
  `Patient.emergency_record = self.name` (`:47-50`); it is cleared on `Closed`/`Cancelled`
  (`:64-68`). `Patient Encounter`, `Service Request`, `Observation`, `Lab Test`,
  `Medication Request`, `Diagnostic Report`, `Sample Collection` and `Inpatient Record` all carry
  an `emergency_record` field with `fetch_from: patient.emergency_record`, so anything ordered
  while the patient is in ER is automatically stamped with the episode.
  [INFERENCE] Nothing enforces one active ER episode per patient; the pointer simply holds the
  most recent write. `get_active_triage` (`:347-366`) papers over this by querying
  `order_by arrival_datetime desc, limit 1`.
- **No token.** The ER queue is the `Emergency Triage Queue` report
  (`report/emergency_triage_queue/emergency_triage_queue.py`): open records, columns acuity,
  patient, chief complaint, status, bed, attending, **minutes in department**. Ordering is by
  acuity and wait, never by arrival number.

Contrast with Danphe, whose ER registration persists billing with
`BillingType`/`VisitType = outpatient` (doc 04 §E7) — provenance lost. Frappe keeps ER provenance
on every downstream row. Frappe is the better donor here.

### F9 — What ours already does, for the comparison

- `visit.create` (`packages/api/src/routers/visit.ts:141-183`): one transaction — `nextCounter`
  token → insert visit `status: 'waiting'` → insert `consult_fee` charge `status: 'pending'`.
  Same shape as Danphe F1, with the token allocated _inside_ the transaction.
- `billing.issueInvoice` (`billing.ts:330-341`): `nextCounter('invoice:{fiscalYear}')`, immutable
  invoice header with org and patient print fields snapshotted
  (`packages/db/src/schema/invoices.ts`), charges flipped `pending → invoiced`.
- `billing.recordPayment` (`billing.ts:453-487`): `nextCounter('receipt:{fiscalYear}')`, payment
  row with its own `receiptNumber`, journal narration written in the same transaction.
- Corrections are credit notes and refunds, each with its own fiscal-year series
  (`billing.ts:637, 761`). No invoice mutation path exists.

The OPD money tail is complete and, on immutability and numbering discipline, ahead of both
references. The gaps are all upstream and sideways: no appointment, no queue board, no ER
document, no bed.

## What this proves / does not prove

**Proves.** The write sequences, status machines, gate conditions and printed-artifact shapes above
exist at the pinned commits (Danphe `9963822`, Marley `ac8a300`). Every file:line was read directly
this pass — no subagent findings are carried in this document. The OPD/IPD/ER divergence and the
money-direction reversal hold in both products independently.

**Does not prove.** Nothing about what our pilot hospital does. Two South Asian OPD-heavy systems
share a bias; doc 11's FHIR and OpenMRS legs are the independent check and were not re-read here.
Marley's Emergency module is dated 2026 in its own copyright header and may be young — no evidence
was sought about whether anyone runs it. Danphe's last commit here is 2024-09.

**Not determined.** Whether Frappe's Emergency module has a UI beyond the workspace and the triage
report. Whether either product reconciles a patient who is simultaneously an open ER record and an
open OPD appointment. Danphe's IPD advance/deposit flow was not re-traced this pass — doc 04 §E3
and §E6 remain the source for it.

## What this means for us — deltas, not new scope

> **Δ1 decided 2026-08-21** — accepted as
> [ADR 0022](../contributing/decisions/0022-care-settings-are-separate-destinations.md),
> after prototyping it against doc 10's position and checking the UX evidence in
> [13-operational-ui-for-non-technical-staff.md](13-operational-ui-for-non-technical-staff.md).

1. **Do not build IPD or ER as `visitClass` values on `visits`.** This is the load-bearing
   conclusion. Both references give each pipeline its own document because the exit conditions
   differ: OPD closes same-day on consult completion, IPD closes on a billing gate after days, ER
   closes on a disposition. One status column cannot carry three machines. Keep `visits` as the OPD
   spine; when IPD lands, it is an `admissions` table referencing the patient, not a visit row with
   a different class. Revisit the `visits_class_check` constraint
   (`packages/db/src/schema/visits.ts:49`) at that point rather than growing into it.

2. **Add the money axis to the queue read model before adding a billing status column.** Doc 11
   §"Three real deltas" deferred `visits.billingStatus` correctly. F3 sharpens _why_: Danphe's
   queue filter accreted a payer exception and now silently hides insured patients. Gate the queue
   on "a non-voided charge exists", which we can already express over `charges.status`
   (`packages/db/src/schema/charges.ts:57`), and never add a second predicate to it.

3. **Settle receipt granularity now — the answer from both references is per-bill, ours is
   per-payment.** F5 plus Marley's total absence of a receipt document is two independent votes.
   Ours is not wrong (a gapless per-payment series is a stronger control), but it is a decision
   with no reference cover, and it is baked into printed paper. It needs an ADR, or the pilot's
   accountant's answer, before the first live receipt. Doc 04 §E3 raised this; nothing has settled
   it.

4. **The token slip should be one configurable artifact, not four hard-coded prints.** F4 is the
   cheapest transferable idea in this pass: one data shape, one settings row per visit type
   choosing which fields print and how they are labelled. We already snapshot print fields onto the
   invoice; the same discipline applied to the desk slip avoids the four-component sprawl Danphe
   ended up with.

5. **When ER lands, Frappe's `Emergency Record` is the donor and Danphe is the counter-example.**
   Take: provisional patient with a distinct naming series plus an explicit merge path; `Triage
Level` as a table with `priority` and `target_reassessment_mins`; the five-state status machine
   separate from the five-state disposition; occupancy rows with a `for_update` lock on the bed;
   the episode pointer stamped onto every downstream clinical row so ER provenance survives.
   Reject: Danphe's ER-billed-as-outpatient provenance loss, and Frappe's unenforced
   single-active-episode pointer — make ours a partial unique index on
   `(orgId, patientId) where status not in ('closed','cancelled')`.

6. **When IPD lands, the two gates are the spec.** A costed pre-admission estimate with an advance
   payment before the bed is assigned, and a billing check before discharge that is overridable by
   an explicit setting and writes an audit entry when overridden. Frappe's ordering matters too:
   clinical gates (nursing tasks, incomplete orders) run _before_ the money gate, so the desk never
   sees "unbilled services" when the real blocker is a pending nursing task.

7. **Copy Frappe's ER→IPD bypass deliberately or reject it deliberately.** `admit_to_inpatient`
   skips Treatment Counselling entirely: an emergency admission gets a bed with no advance. That is
   almost certainly correct clinically and it is a real revenue exposure. Whichever way we go, it
   should be a written decision, not an omission.

## Next falsification

- Ask the pilot: is the receipt number per payment or per bill, and does the printed OPD slip carry
  the token, the charge, or both? Two questions, one conversation, and they unblock deltas 3 and 4.
- Before any IPD schema: check whether the pilot admits patients without an advance, and what
  actually blocks a discharge today. If the answer is "nothing blocks it", delta 6's exit gate is a
  setting defaulted off, not an invariant.
- Not read this pass: whether Frappe's Emergency module ships a desk UI, and Danphe's deposit flow
  end to end (doc 04 §E3/§E6 stand).
- Re-check Marley at a later commit before building ER — the module is new enough that its shapes
  may still move.

## Sources

- `https://github.com/earthians/marley` @ `ac8a3006ca37ab66d07ae776f83104eb331ac695`
  (2026-08-17, shallow clone read 2026-08-21):
  `healthcare/healthcare/doctype/emergency_record/{emergency_record.py,emergency_record.json}`,
  `.../triage_level/triage_level.json`, `.../emergency_occupancy/emergency_occupancy.json`,
  `.../inpatient_record/inpatient_record.py`, `.../inpatient_record/inpatient_record.json`,
  `.../treatment_counselling/{treatment_counselling.py,treatment_counselling.json}`,
  `.../patient_appointment/patient_appointment.py`,
  `.../healthcare_payment_record/healthcare_payment_record.json`,
  `.../service_request/service_request.json`, `.../patient_encounter/patient_encounter.json`,
  `healthcare/healthcare/report/emergency_triage_queue/emergency_triage_queue.py`.
- `https://github.com/opensource-emr/hospital-management-emr` @
  `99638225ba0876261c2c16c3bd2f9b83f4abbc19` (2024-09-02, shallow clone read 2026-08-21):
  `Code/Websites/DanpheEMR/Services/QueueManagement/QueueManagementService.cs`,
  `Code/Websites/DanpheEMR/Controllers/Stickers/DTOs/{VisitStickerData_DTO.cs,RegistrationStickerSettings_DTO.cs}`,
  `Code/Components/DanpheEMR.ServerModel/BillingModels/POS/BillingTransactionModel.cs`,
  `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/shared/shared-enums.ts`,
  `Code/Websites/DanpheEMR/Controllers/Appointment/VisitController.cs` (quoted via doc 11 §E3,
  line references not re-read this pass).
- Local @ working tree: `packages/db/src/schema/{visits,charges,invoices,payments,counter}.ts`,
  `packages/api/src/routers/{visit,billing}.ts`.
- Prior research, cross-referenced not restated:
  [04-danphe-marley-entity-deep-dive.md](04-danphe-marley-entity-deep-dive.md) (§E3 tenders and
  numbering, §E6 IPD/ADT, §E7 Danphe ER, §E9 queue mechanics),
  [11-appointment-vs-visit-boundary.md](11-appointment-vs-visit-boundary.md) (appointment/visit
  boundary, FHIR and OpenMRS legs),
  [03-client-hms-production-sitemap.md](03-client-hms-production-sitemap.md) (incumbent OPD money
  receipt, O19).
