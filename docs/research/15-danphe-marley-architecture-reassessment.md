# Danphe and Marley architecture reassessment

Date: 2026-08-21. Status: research input, not an accepted decision. The source comparison remains
useful, but [ADR 0023](../contributing/decisions/0023-charges-hang-off-the-clinical-encounter.md)
supersedes this note's former per-encounter Billing Account and `clinical_encounters.setting`
recommendations. Current-HMS conclusions below are aligned to that accepted decision.

## Question

How do Danphe EMR and Marley handle the complete patient journey—patient identity and search,
first and repeat attendance, appointments, outpatient, inpatient, emergency, clinical records,
billing, navigation, and backend ownership—and has HMS introduced unnecessary complexity by
separating these concepts?

## Answer

The current direction is mostly correct. The domain really does contain different records with
different owners and lifecycles:

```text
Patient (one durable identity)
  ├─ Appointment (a plan; may never become care)
  ├─ OPD Encounter (one outpatient attendance and queue workflow)
  ├─ Admission (one inpatient stay, beds, transfers, discharge)
  └─ Emergency Episode (arrival, triage, treatment, disposition)

Each actual-care record
  ├─ has or links to an internal Clinical Encounter
  └─ has charges and invoices pointing directly to that Clinical Encounter
```

The mistake would be to expose `Visit`, `Clinical Encounter`, or `Care Episode` as another staff
destination. The useful simplification is to make commands atomic and names precise, not to merge
genuinely different workflows into one table or screen.

The finance boundary needs exact language:

- A walk-in or checked-in patient gets an OPD Encounter plus its Clinical Encounter. The consultation can
  then be invoiced and paid partially or fully while the OPD Encounter is still `waiting`. Payment
  is a financial state; it is not the identity of the attendance.
- Money taken while merely booking an Appointment is not appointment revenue. It is a patient
  advance/deposit—a liability until service is provided—which staff may understand as **patient
  credit**. It is later allocated to the OPD invoice or refunded/reused after cancellation or
  no-show.
- `Credit` must not mean both a patient-owned advance and a hospital receivable. Use **Patient
  advance** in accounting/code and optionally **Available credit** in patient-facing UI; reserve
  **Credit sale / amount due** for money the patient or sponsor owes the hospital.

## Repository snapshots and limits

| Reference  | Snapshot inspected                                                                                                                        | Activity signal                                                          | Proper use                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Danphe EMR | [`99638225`](https://github.com/opensource-emr/hospital-management-emr/commit/99638225ba0876261c2c16c3bd2f9b83f4abbc19), default `master` | HEAD dated 2024-09-02; latest GitHub release found was v3.2              | Mature workflow counterexample, not a modern code-architecture donor        |
| Marley     | [`e24bc491`](https://github.com/earthians/marley/commit/e24bc491047212b86488cf203a3457236387ca1e), default `develop`                      | HEAD dated 2026-08-21; active v15/v16 releases                           | Current Frappe/ERPNext healthcare model, with framework-specific trade-offs |
| HMS        | Current working tree on 2026-08-21                                                                                                        | OPD is executable; Appointment, Admission and Emergency are future specs | Product being evaluated                                                     |

Read-only clones used for the audit:

- `/tmp/hms-reference-research/hospital-management-emr`
- `/tmp/hms-reference-research/marley`

Source code proves the behavior present at those commits. It does not prove production adoption,
operator satisfaction, regulatory correctness, or that every deployment enables every
configuration-gated feature. An absence below means “not found in the inspected active source,”
not “no fork has ever implemented it.”

## 0-to-100 patient flow comparison

### 1. Patient registration, search, and duplicate handling

All three systems use one durable Patient identity and create new operational records for repeat
care.

Danphe starts its Patient module at search and provides a multi-step registration flow. During
first-care entry it warns on possible demographic matches, lets staff select an existing patient,
and still permits a deliberate new record; repeat care reuses `PatientId` and creates another
Visit ([routes](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/patients/patients-routing.constant.ts#L23-L50),
[match flow](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/appointments/visit/visit-main.component.ts#L299-L327),
[backend branch](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Websites/DanpheEMR/Controllers/Appointment/VisitController.cs#L750-L791)).
This is candidate matching, not a hard demographic uniqueness rule.

Marley’s Patient holds longitudinal demographics and links to an accounting Customer. Ordinary
registration-level duplicate detection or merge was not found; its autonaming explicitly suffixes
duplicate names ([Patient controller](https://github.com/earthians/marley/blob/e24bc491047212b86488cf203a3457236387ca1e/healthcare/healthcare/doctype/patient/patient.py#L143-L165)).
That makes Marley a poor donor for identity resolution.

HMS already reuses Patient and creates another OPD Encounter for each attendance
(`tests/integration/opd.test.ts:306`). This change also closes two identity-quality findings from
the first review of this research:

1. MRN and UID remain hard unique, while name/phone are candidate matches shown before save rather
   than a demographic uniqueness rule that can reject legitimate relatives.
2. Quick registration requires an explicit age and stores no synthetic zero. DOB is canonical
   when present; recorded age remains the fallback when DOB is unknown.

### 2. First attendance, repeat attendance, and follow-up

First versus repeat is not a new Patient identity. Each actual attendance creates a new OPD
Encounter for the same Patient.

Danphe stores `new`, `followup`, `transfer`, and `referral` on its Visit and can link a parent Visit
([Visit model](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Components/DanpheEMR.ServerModel/AppointmentModels/VisitModel.cs#L28-L33)).
Marley does not classify its Patient Encounter as first/repeat. It infers “new patient” from prior
non-cancelled Appointments and implements free follow-ups through a time/counter-based Fee
Validity entitlement
([new-patient check](https://github.com/earthians/marley/blob/e24bc491047212b86488cf203a3457236387ca1e/healthcare/healthcare/doctype/patient_appointment/patient_appointment.py#L623-L629),
[fee validity](https://github.com/earthians/marley/blob/e24bc491047212b86488cf203a3457236387ca1e/healthcare/healthcare/doctype/fee_validity/fee_validity.py#L123-L188)).

The strongest model for HMS is:

```text
same Patient + new OPD Encounter every attendance
                  + optional previousEncounterId/reason when clinically relevant
                  + independently calculated fee entitlement
```

“Follow-up” should therefore not become a Patient type or a different encounter identity. HMS’s
current fee lookup is too permissive: any recent non-cancelled OPD Encounter—including a waiting
duplicate—qualifies (`packages/api/src/routers/opd.ts:117`). Eligibility should require a prior
completed consultation and use completion time. The desk should also warn when the same patient
already has an active matching OPD Encounter.

### 3. Appointment booking and check-in

Danphe’s Appointment is the cleaner booking boundary. `PatientId` is nullable, name/contact data
is snapshotted, and the row has no invoice, payment, token, or deposit fields
([Appointment model](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Components/DanpheEMR.ServerModel/AppointmentModels/AppointmentModel.cs#L10-L37)).
Check-in opens Visit creation with either the registered Patient or the caller’s captured details
([check-in UI](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/appointments/appt-list/appointment-list.component.ts#L176-L251)).
Patient, Visit and OPD invoice are created in one backend transaction, but Appointment is marked
checked-in by a second frontend call whose failure is only logged
([transaction](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Websites/DanpheEMR/Controllers/Appointment/VisitController.cs#L564-L606),
[race](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/appointments/visit/visit-main.component.ts#L744-L766)).

Marley requires an existing Patient for Appointment
([schema](https://github.com/earthians/marley/blob/e24bc491047212b86488cf203a3457236387ca1e/healthcare/healthcare/doctype/patient_appointment/patient_appointment.json#L77-L105)).
Check-in only changes status and queue position; staff separately creates Patient Encounter, whose
save then closes the Appointment
([check-in](https://github.com/earthians/marley/blob/e24bc491047212b86488cf203a3457236387ca1e/healthcare/healthcare/doctype/patient_appointment/patient_appointment.py#L1030-L1049),
[mapping](https://github.com/earthians/marley/blob/e24bc491047212b86488cf203a3457236387ca1e/healthcare/healthcare/doctype/patient_appointment/patient_appointment.py#L1079-L1104),
[closure](https://github.com/earthians/marley/blob/e24bc491047212b86488cf203a3457236387ca1e/healthcare/healthcare/doctype/patient_encounter/patient_encounter.py#L29-L54)).
That manual gap should not be copied.

HMS should accept a booking with optional `patientId` plus a name/phone snapshot. Check-in should be
one idempotent server command that resolves or creates Patient, creates Clinical Encounter + OPD
Encounter, links them to Appointment, allocates any advance, and transitions the
Appointment. A retry must return the same created records rather than minting another token.

### 4. OPD and outpatient clinical work

Danphe uses a generic Visit as the outpatient queue/billing anchor. Marley instead has an
`Outpatient` workspace composed of Patient Appointment, Patient Encounter, Patient, Sales Invoice,
Vital Signs and Patient History; it has no OPD-attendance table
([workspace navigation](https://github.com/earthians/marley/blob/e24bc491047212b86488cf203a3457236387ca1e/healthcare/workspace_sidebar/outpatient.json#L32-L168)).
Marley’s Patient Encounter owns symptoms, diagnoses, medications, investigations, procedures and
notes, and creates orders on submission
([Encounter schema](https://github.com/earthians/marley/blob/e24bc491047212b86488cf203a3457236387ca1e/healthcare/healthcare/doctype/patient_encounter/patient_encounter.json#L168-L200),
[order creation](https://github.com/earthians/marley/blob/e24bc491047212b86488cf203a3457236387ca1e/healthcare/healthcare/doctype/patient_encounter/patient_encounter.py#L201-L321)).

HMS’s explicit OPD Encounter is justified because it owns a real token and operational state
machine independently from future clinical notes/orders. Its current atomic creation of Clinical
Encounter, OPD Encounter and optional Charge is a sound boundary
(`packages/api/src/routers/opd.ts:146`). The internal Clinical Encounter should remain invisible
to staff; the staff URL and page remain the OPD Encounter.

The Patient detail page currently has no encounter history
(`apps/web/src/routes/$orgSlug/patients/$patientId.tsx:70`). A small Recent OPD Encounters list is
not a future “care episode” feature; it is necessary repeat-patient navigation. Later, a typed
longitudinal timeline can project OPD, Admission, Emergency, results and documents without owning
their source data. Marley’s Patient History uses the same projection idea
([history settings](https://github.com/earthians/marley/blob/e24bc491047212b86488cf203a3457236387ca1e/healthcare/healthcare/doctype/patient_history_settings/patient_history_settings.py#L75-L127)).

### 5. IPD, inpatient, and Admission

Both references treat inpatient care as a distinct workflow, not OPD with another label.

Danphe first creates an inpatient Visit, then attaches Admission and bed occupancy. Admission owns
admission/discharge fields and uses `PatientVisitId` as its key/foreign key
([creation](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Websites/DanpheEMR/Controllers/Admission/AdmissionController.cs#L1048-L1061),
[Admission model](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Components/DanpheEMR.ServerModel/AdmissionModels/AdmissionModel.cs#L12-L43)).
Marley’s Inpatient Record owns `Admission Scheduled → Admitted → Discharge Scheduled → Discharged`,
bed occupancy and transfer, and discharge checks for incomplete nursing/services/billing
([lifecycle](https://github.com/earthians/marley/blob/e24bc491047212b86488cf203a3457236387ca1e/healthcare/healthcare/doctype/inpatient_record/inpatient_record.json#L186-L215),
[occupancy](https://github.com/earthians/marley/blob/e24bc491047212b86488cf203a3457236387ca1e/healthcare/healthcare/doctype/inpatient_record/inpatient_record.py#L584-L645),
[discharge checks](https://github.com/earthians/marley/blob/e24bc491047212b86488cf203a3457236387ca1e/healthcare/healthcare/doctype/inpatient_record/inpatient_record.py#L450-L530)).

Use `IPD` for the compact staff destination and `/ipd` for its route. Use `Admission` as the code
and database domain noun because it precisely owns the inpatient stay, bed movements, discharge
and inpatient financial boundary. Use “Inpatient admissions and wards” as explanatory copy. Do not
create parallel `/inpatient` and `/admissions` routes.

### 6. Emergency

Emergency needs a dedicated workflow and may begin before reliable identity is available.

Danphe creates an emergency Visit plus a separate ER record holding triage, demographic snapshot
and disposition
([model](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Components/DanpheEMR.ServerModel/EmergencyModels/EmergencyPatientModel.cs#L13-L57),
[registration](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Websites/DanpheEMR/Controllers/Emergency/EmergencyController.cs#L996-L1079)).
Marley’s Emergency Record has `Registered → Triaged → In Treatment → Awaiting Disposition →
Closed/Cancelled`, supports an optional Patient at arrival, creates a provisional identity when
needed, and can later merge it or admit the patient
([schema](https://github.com/earthians/marley/blob/e24bc491047212b86488cf203a3457236387ca1e/healthcare/healthcare/doctype/emergency_record/emergency_record.json#L53-L103),
[provisional identity](https://github.com/earthians/marley/blob/e24bc491047212b86488cf203a3457236387ca1e/healthcare/healthcare/doctype/emergency_record/emergency_record.py#L23-L59),
[admission](https://github.com/earthians/marley/blob/e24bc491047212b86488cf203a3457236387ca1e/healthcare/healthcare/doctype/emergency_record/emergency_record.py#L201-L235)).

HMS should keep `/emergency` and `EmergencyEpisode`. It needs an explicit, prominent unidentified
patient state and an audited, transactional merge/reconciliation path. Emergency-to-Admission and
OPD-to-Admission should call one Admission-creation domain command so patient, orders, charges and
clinical identity are not duplicated.

### 7. Billing, OPD partial payments, and appointment advances

The references make different choices.

Danphe creates OPD Visit and BillingTransaction atomically. Ordinary cash OPD forces received
amount to total; organization/scheme credit makes it unpaid and can add co-pay. The inspected code
does not demonstrate arbitrary partial self-pay for OPD
([cash/credit behavior](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/appointments/visit/visit-billing-info.component.ts#L578-L623)).
Its deposits are separate In/Out transactions used particularly around inpatient admission, not
money owned by Appointment
([deposit model](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Components/DanpheEMR.ServerModel/BillingModels/POS/BillingDeposit.cs#L11-L68)).

Marley directly couples Appointment to `paid_amount`, `invoiced`, and Sales Invoice
([fields](https://github.com/earthians/marley/blob/e24bc491047212b86488cf203a3457236387ca1e/healthcare/healthcare/doctype/patient_appointment/patient_appointment.json#L260-L283),
[invoice creation](https://github.com/earthians/marley/blob/e24bc491047212b86488cf203a3457236387ca1e/healthcare/healthcare/doctype/patient_appointment/patient_appointment.py#L530-L597)).
Its cancellation handler must then cancel the invoice or route staff into manual review
([cancellation](https://github.com/earthians/marley/blob/e24bc491047212b86488cf203a3457236387ca1e/healthcare/healthcare/doctype/patient_appointment/patient_appointment.py#L647-L707)).
The patient portal path found takes the full fee; no Marley-owned appointment advance allocation or
partial portal payment workflow was found.

Neither repository proves that HMS should reject partial OPD payment. HMS already models multiple
payments capped to invoice outstanding (`packages/api/src/routers/billing.ts:479`), which is a
cleaner financial record than a mutable paid amount. The previously chosen counter flow can remain,
but “before confirmation” should describe the user-visible command boundary rather than impossible
accounting chronology:

```text
Reception submits check-in
  → server creates OPD Encounter + Clinical Encounter + consultation invoice
  → cashier records partial or full payment (or explicit amount due)
  → UI confirms check-in and reveals/prints the token
```

For cash/manual tender, these records can be committed as one server command so no half-created
state is visible. External payment gateways need an idempotent pending/retry workflow rather than a
long database transaction. Internally, the OPD Encounter and Clinical Encounter must be inserted
before their invoice/payment rows; otherwise there is no care context to own the money. This ordering
does not contradict a UX that confirms the check-in only after the partial/full payment choice.

If the desk takes money before submitting check-in, it is an advance and follows the same
allocation path as appointment money. “Pay later” is a deliberate credit sale/amount-due path, not
an accidental zero-payment success.

For appointments:

```text
Appointment booked
  → optional Advance Receipt (cash/bank received; patient advance liability)
  → check-in creates OPD Encounter + Clinical Encounter + Invoice
  → Allocation applies some/all advance to Invoice
  → unused balance remains patient credit or is refunded
```

This is not merely theoretical. IFRS 15 recognizes revenue when promised service transfers, not
when cash happens to arrive ([IFRS 15 summary](https://www.ifrs.org/issued-standards/list-of-standards/ifrs-15-revenue-from-contracts-with-customers/)).
The India-aligned implementation should be reviewed against
[Ind AS 115](https://www.mca.gov.in/Ministry/pdf/IndAS115_2020_10112020.pdf) with the pilot’s
accountant before release. These sources support the liability/revenue timing principle; they do
not by themselves specify HMS receipt, GST, cancellation-fee, or refund policy.

HL7’s Account is a central patient/period record against which charges, payments and adjustments
can be applied, and Encounter can link to Account
([HL7 Account](https://hl7.org/fhir/R4/account.html),
[HL7 Encounter](https://hl7.org/fhir/R4/encounter.html)). That supports a future patient-level
account for advances, insurer allocation, or cross-setting credit; it does not justify the deleted
one-to-one wrapper. Until that workflow exists, HMS money points to the Clinical Encounter.

### 8. Clinical Encounter and whether “Visit” is necessary

The references deliberately diverge:

- Danphe uses one `PAT_PatientVisits` spine across outpatient, inpatient and emergency. It carries
  setting, provider, billing status, queue and broad relationships
  ([Visit model](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Components/DanpheEMR.ServerModel/AppointmentModels/VisitModel.cs#L11-L80)).
- Marley has no universal Visit or Care Episode table. Patient Appointment, Patient Encounter,
  Inpatient Record and Emergency Record are separate, with optional links among them
  ([Patient Encounter links](https://github.com/earthians/marley/blob/e24bc491047212b86488cf203a3457236387ca1e/healthcare/healthcare/doctype/patient_encounter/patient_encounter.json#L469-L514)).
- HL7 Encounter itself allows outpatient, inpatient and emergency classification and explicitly
  distinguishes Appointment planning from actual care
  ([scope and boundary](https://hl7.org/fhir/R4/encounter.html)).

Therefore no reference proves that staff need a `Visit` module. The shared technical identity is
useful for notes, observations, orders, files, charges and cross-setting reports, but the word
`Visit` is too ambiguous for HMS. Keep internal `ClinicalEncounter`; keep setting-specific
workflow records and screens.

One legitimate simplification to test is using the Clinical Encounter ID as the primary key of a
strict one-to-one setting record instead of minting both `clinical_encounters.id` and an unrelated
`opd_encounters.id`. Danphe’s Admission shared-key relationship shows that this can work. It would
remove an identity and prevent mismatches, but it should be chosen only after Admission and
Emergency relationship requirements are walked through. This is a falsification candidate, not a
recommendation to migrate now.

The generic `clinical_encounters.setting` discriminator has no current reader and is deleted under
ADR 0023. It may return when the first cross-setting timeline or report needs it; until then, the
setting-specific child row owns the workflow without a duplicated classifier.

### 9. Navigation and words staff should see

Both references expose setting-oriented destinations. Danphe’s mixed `Visit`, `OPDRecord`,
`OutPatientDoctor`, `ADTMain`, and `InPatientDepartment` vocabulary is a maintenance warning
([routes](https://github.com/opensource-emr/hospital-management-emr/blob/99638225ba0876261c2c16c3bd2f9b83f4abbc19/Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/doctors/doctors-routing.constant.ts#L38-L68)).
Marley uses full `Outpatient`, `Inpatient`, and `Emergency` workspaces. Neither proves universal
user preference.

For HMS’s compact, all-day South Asian hospital console, use one vocabulary:

```text
Care
  Dashboard
  Appointments
  OPD          Outpatient department
  IPD          Inpatient admissions and wards
  Emergency
  Patients
  Orders / Diagnostics       when implemented

Finance
  Billing
  Payments                   when it has a real worklist
  Patient advances           when appointment collection ships
  Insurance                  later
  Reports
```

Canonical routes are `/appointments`, `/opd`, `/ipd`, `/emergency`, and `/patients`. There should
be no compatibility aliases in this pre-release product. Code nouns are `Appointment`,
`OpdEncounter`, `Admission`, `EmergencyEpisode`, and internal `ClinicalEncounter`. Use “Outpatient”
and “Inpatient” in subtitles, help, onboarding, and reports. Do not use bare `visit`, `IPD
Encounter`, or `care episode` as competing product nouns.

### 10. Backend and developer-experience implications

The maintainable model is not “fewer tables at any cost.” It is strong aggregate ownership plus a
small number of atomic domain commands:

- `createOpdEncounter` owns Clinical Encounter, OPD Encounter, initial Charge and
  token allocation.
- `checkInAppointment` owns identity resolution, the ordinary OPD creation command, advance
  allocation, Appointment transition and idempotency.
- `createAdmission` is shared by OPD and Emergency sources and owns the Admission/bed invariants.
- `mergeProvisionalPatient` is audited and updates every supported typed reference in one
  transaction.
- Billing mutations own immutable invoices, receipts, allocations, credit notes and refunds; they
  never mutate a clinical status as a side effect.

Danphe is a warning against large controller transactions, duplicated status fields, free-form
strings and route vocabulary drift. Marley is a warning against framework-generic polymorphic
links, cached “current episode” pointers on Patient, manual multi-step check-in, and appointment-
owned revenue. HMS should keep explicit `orgId` predicates, typed references, static routes and
central permission grants rather than copying either framework’s shortcuts.

## What the evidence proves and does not prove

### It proves

- One Patient should survive across many separate attendances.
- Appointment planning and actual care have different identities and failure outcomes.
- OPD, Admission/IPD and Emergency require different operational state machines.
- A shared internal encounter identity is viable, but a universal staff-facing Visit module is not
  required: Danphe has the former; Marley works without a universal Visit table.
- Direct appointment invoicing is implementable, but Marley demonstrates the cancellation coupling
  it creates.
- Emergency requires provisional identity and later reconciliation.
- A patient-level longitudinal read model is valuable even when source records stay typed.

### It does not prove

- That Danphe or Marley provides the best operator UX.
- That either reference’s billing behavior meets the pilot hospital’s GST, insurance, refund, or
  government-reporting requirements.
- That arbitrary partial self-pay is necessary or harmful. Danphe does not implement it in the
  inspected ordinary OPD path; HMS can support it cleanly if the pilot requires it.
- That `OPD`/`IPD` labels outperform their expanded terms for every region or role.
- That a patient-level Account is needed before an advance, insurer, or cross-setting credit
  workflow proves its lifecycle.

## What this means for HMS

### Keep

1. One Patient, many actual-care records.
2. Separate Appointment, OPD Encounter, Admission and Emergency Episode records and destinations.
3. Internal non-navigable Clinical Encounter for shared clinical context.
4. Charges and immutable invoice/payment/correction records attached to the Clinical Encounter.
5. OPD partial/full payment capability, provided the pilot confirms the policy and reports.
6. Appointment booking advances as liabilities allocated at actual care—not appointment revenue.
7. `/opd`, `/ipd`, `/emergency` routes with expanded subtitles; no legacy aliases.

### Remaining work before expanding the schema

1. **Guard duplicate active OPD check-ins.** Follow-up pricing now requires completed prior care,
   but the server should still reject or explicitly confirm a second matching active encounter.
2. **Add Patient → recent OPD history.** Today the patient page cannot reach previous attendances.
3. **Validate role grants with real staff.** Reception, cashier, accountant, nurse and doctor need
   different actions even when they share the same OPD workspace.

The clean OPD cutover, age and demographic matching, clinical/financial cancellation split,
unused setting discriminator removal, and Billing worklist are implemented in the reviewed change. Issued invoices
remain immutable after a clinical cancellation and continue through credit-note/refund handling.

These are higher-value corrections than adding Appointment, IPD or Emergency tables immediately.

## Next falsification

Before another schema redesign, walk the following scenarios end-to-end with reception, cashier,
accounting, nursing and a doctor. For every event, name exactly one owner for patient identity,
clinical status, queue/token, charge, invoice, receipt, advance allocation, correction and audit.

1. New walk-in: candidate search, quick registration, consultation invoice, partial payment,
   token, consultation completed, balance remains due.
2. Repeat patient: recent history is visible, prior completed care qualifies for a free/reduced
   follow-up, and an accidental second active check-in is caught.
3. Phone appointment without Patient ID: optional advance is received, patient is matched at
   arrival, check-in atomically creates OPD, and advance is allocated exactly once.
4. Appointment no-show/cancellation: advance becomes reusable patient credit or is refunded with a
   traceable reason; no fake consultation revenue exists.
5. Prepaid OPD patient leaves before consultation: clinical OPD cancels; invoice is credited and
   cash refunded or retained as advance without rewriting history.
6. Unidentified emergency patient: treatment and charges start immediately; later identity merge
   preserves orders, results, payments and audit exactly once; Admission uses the same source data.
7. Insured/co-pay patient: sponsor liability, patient payment, rejection, reassignment and aging
   remain reconcilable for accountant and government reports.

If any scenario needs the same money or status copied into two aggregates, the boundary is still
wrong. Clinical Encounter is the single shared identity; setting-specific operational rows remain
separate until a real cross-setting reader proves another projection.

## Sources

- Danphe EMR pinned tree:
  <https://github.com/opensource-emr/hospital-management-emr/tree/99638225ba0876261c2c16c3bd2f9b83f4abbc19>
- Marley pinned tree:
  <https://github.com/earthians/marley/tree/e24bc491047212b86488cf203a3457236387ca1e>
- HL7 FHIR R4 Encounter: <https://hl7.org/fhir/R4/encounter.html>
- HL7 FHIR R4 Account: <https://hl7.org/fhir/R4/account.html>
- IFRS 15 summary:
  <https://www.ifrs.org/issued-standards/list-of-standards/ifrs-15-revenue-from-contracts-with-customers/>
- India Ministry of Corporate Affairs, Ind AS 115:
  <https://www.mca.gov.in/Ministry/pdf/IndAS115_2020_10112020.pdf>
- Local delegated evidence reports (scratch only):
  `/tmp/hms-reference-research/hospital-management-emr-research.md` and
  `/tmp/hms-reference-research/marley-research.md`
