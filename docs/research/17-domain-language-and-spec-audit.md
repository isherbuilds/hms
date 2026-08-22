# Domain language and specification audit

Date: 2026-08-22. Branch: reference architecture and internal model review. Status: **research
input, not an accepted decision.** This note deliberately challenges the current product blueprint
and ADRs; it does not authorize a rename, migration, route, permission, or new domain.

## Question

After reviewing the supplied Frappe Healthcare lessons, the current schema, specifications, prior
research, HL7 FHIR R4, and OpenMRS terminology, should HMS standardize around Appointments, rename
`opd_encounters` to Visits or Patient Encounters, or otherwise change its product language and domain
boundaries?

## Answer

**Keep Appointment separate from actual attendance, keep `ClinicalEncounter` as the shared internal
identity, and do not rename the whole actual-care model to `Visit` or `PatientEncounter`.** Those are
the strongest parts of the current model.

The current model still needs changes. In priority order:

1. reverse the proposed Appointment relationship so the actual OPD record points to the optional
   Appointment;
2. decide whether an Appointment is a real capacity reservation or merely a booking request;
3. collapse the two IDs in the strict Clinical Encounter ↔ setting-record relationship;
4. store immutable OPD Business Date and enforce token uniqueness in the database;
5. replace ambiguous timestamps with arrival/consultation/closure timestamps;
6. define abandonment and closure reasons instead of treating every uncompleted arrival as
   cancellation;
7. fix patient identity fields that encode missing data as fake values or make a patient's own phone
   mandatory;
8. reconcile contradictory delivery labels and stale superseded research before adding more specs.

Renaming `opd_encounters` is **not** a high-confidence improvement. `OPD Attendance` is marginally more
precise for the operational row, but it is not yet proven staff language. `Visit` has incompatible
meanings across systems, and Frappe's `Patient Encounter` is a clinical-document form rather than the
queue-and-arrival record HMS currently owns. The better pre-pilot simplification is a shared primary
key and a precise glossary, not a vocabulary migration.

## Evidence and recommendations

### 1. Keep Appointment separate; do not force walk-ins through it

Frappe separates `Patient Appointment` from `Patient Encounter`, although its walk-in configuration
uses Appointment as an intake shortcut. FHIR defines Appointment as a booking that may result in one
or more Encounters, while Encounter owns the actual interaction. HMS already states that a no-show
creates no actual-care record and a walk-in needs no Appointment
([appointment spec](../specs/appointments.md#accepted-boundary)).

**Recommendation: keep this boundary.** Creating synthetic same-day Appointments for walk-ins would
add rows with no scheduling meaning, blur no-show reporting, and make queue creation depend on a domain
that the walk-in workflow does not need.

### 2. Reverse the Appointment → OPD link in the spec

The current spec puts `opdEncounterId` on `appointments`
([appointments.md:24-29](../specs/appointments.md#first-implementation-after-the-trigger)). Earlier
reference research recommends the opposite, and FHIR R4 puts `appointment 0..*` on Encounter as “the
appointment that scheduled this encounter”; Appointment has no reverse Encounter field. A booking may
produce no actual care, while an actual-care record may optionally cite its plan.

**Recommendation: add nullable `appointmentId` to the OPD setting record with a tenant-scoped unique
constraint.** Check-in creates the OPD/Clinical Encounter, writes its provenance link, and transitions
the Appointment in one idempotent transaction. Do not persist the same relationship in both
directions. The Appointment page can query the linked OPD row.

For the first slice, deliberately narrow FHIR's one-to-many possibility to at most one OPD record per
Appointment. If a future booking can schedule a multi-service sequence, introduce an explicit
fulfilment join instead of weakening this invariant accidentally.

### 3. Specify whether “Appointment” guarantees capacity

The proposed first slice stores a booked time but excludes resource scheduling and overbooking rules
([appointments.md:42-47](../specs/appointments.md#non-goals-for-the-first-slice)). Frappe's course,
by contrast, derives available slots from practitioner schedules, duration, department and service
unit. FHIR Appointment also models start/end, duration, participants and optional Slot.

A timestamp with no collision or availability contract is not necessarily an Appointment; it may be a
request, callback commitment, or handwritten diary copied into software.

**Recommendation: make the trigger investigation choose one of two products before the schema:**

- **Appointment:** a confirmed reservation with `scheduledStart`, `scheduledEnd` or snapshotted
  duration, practitioner or service, and a stated collision/capacity rule. Recurring availability and
  dated exceptions can be added behind it.
- **Booking Request:** requested time/window and caller details, with no promise that capacity is held.
  Confirmation creates an Appointment later.

Do not call an unconstrained timestamp a confirmed Appointment. Do not build Frappe's full schedule
configuration until real booking volume proves it is needed.

### 4. Keep `ClinicalEncounter`; do not standardize on `Visit`

There is no universal standards answer:

- FHIR Encounter is the actual interaction, spans outpatient/inpatient/emergency classes, links to an
  optional Appointment, and may be part of another Encounter.
- OpenMRS defines Visit as a period of interaction that contains more granular Encounters; one day can
  have several clinical Encounters inside one Visit.
- Danphe calls its shared operational/billing spine Visit.
- Frappe has no universal Visit; its Patient Encounter contains symptoms, diagnoses, medications and
  orders, while Inpatient and Emergency have separate records.

HMS's `clinical_encounters` row is a stable shared reference for clinical records, files and money,
while OPD, Admission and Emergency own incompatible operational state machines
([blueprint:49-61](../product-blueprint.md#the-internal-clinical-encounter)). That is coherent and
does not require a staff-facing generic destination.

**Recommendation:** retain `ClinicalEncounter` as the internal base identity. Do not rename it to
`Visit`, `PatientEncounter`, or `CareEpisode`. Add a standards-mapping appendix that says HMS combines
the Clinical Encounter base plus its setting record to emit one FHIR Encounter; do not imply that one
table alone is FHIR-conformant.

The blueprint's absolute ban on the spoken word “visit” is too strong. Keep it banned as a schema and
route noun, but permit it in contextual staff copy if pilot language testing shows staff naturally say
“OPD visit.” A glossary should prevent model ambiguity without policing ordinary speech.

### 5. Keep `opd_encounters` for now; test `opd_attendances` only as an internal rename

The current OPD row owns practitioner, department, token and the queue lifecycle
([opd-encounters.ts:9-41](../../packages/db/src/schema/opd-encounters.ts)). It is not Frappe's clinical
Patient Encounter form. Renaming it `patient_encounters` would therefore make the name less accurate.
Renaming it `visits` would erase the OPD scope and invite IPD/Emergency fields back into one generic
table.

`opd_attendances` is the only credible alternative because the row begins at physical arrival and owns
the operational queue. But “attendance” is not yet evidenced as the term used by the target hospitals,
and a rename would touch schema, API, tests, URLs and reports without changing behavior.

**Recommendation: no rename before pilot language testing.** Keep the UI and route simply `OPD`. If
developers repeatedly confuse `opdEncounters` with `clinicalEncounters`, first adopt the shared-ID
change below and strengthen comments. Rename only if confusion survives that simplification.

### 6. Use one ID for a strict base/subtype pair

OPD creation currently mints unrelated `opdEncounterId` and `clinicalEncounterId` values, then enforces
one Clinical Encounter per OPD row with a unique index
([opd.ts:149-180](../../packages/api/src/routers/opd.ts),
[opd-encounters.ts:58-61](../../packages/db/src/schema/opd-encounters.ts)). The two rows describe one
actual interaction; every charge and attachment must translate between their IDs.

**Recommendation: make the setting row's primary key also a foreign key to
`clinical_encounters.id`.** `opd_encounters.id`, future `admissions.id`, and future
`emergency_episodes.id` become the Clinical Encounter ID for their primary interaction. This preserves
separate tables and state machines while removing an identity and preventing mismatched pairs.

Before accepting this change, walk through IPD ward rounds and Emergency → Admission handoff. The
expected shape is one primary Encounter/Admission shared ID, with any later child encounters linked by
`partOf` rather than given another Admission row.

### 7. Store Business Date and enforce token uniqueness

The blueprint says an OPD token is practitioner-and-Business-Date scoped and Business Date must use the
Organization timezone ([product-blueprint.md:218-226](../product-blueprint.md#facility-and-operations--target-vocabulary)).
The implementation puts the derived Business Date only inside the counter key and stores neither it nor
a matching uniqueness constraint. The OPD table contains only `tokenNumber`, practitioner and
`createdAt` ([opd-encounters.ts:24-41](../../packages/db/src/schema/opd-encounters.ts)).

**Recommendation:** add immutable `businessDate date NOT NULL` and a unique index on
`(orgId, practitionerId, businessDate, tokenNumber)`. Use it for queue, register, reconciliation and
follow-up reports. This protects historical meaning if the Organization timezone changes and makes the
token invariant database-verifiable instead of merely counter-conventional.

### 8. Replace ambiguous time fields with domain timestamps

At creation, `clinical_encounters.startedAt` means arrival/check-in. `opd_encounters.startedAt` is null
until consultation starts ([opd.ts:157-180](../../packages/api/src/routers/opd.ts)). Two fields named
`startedAt` therefore mean different events in the same aggregate, while OPD arrival is otherwise
represented only by `createdAt`.

**Recommendation:** define and store these semantics explicitly:

- `arrivedAt` on the OPD operational row;
- `consultationStartedAt` and `consultationCompletedAt` on OPD;
- `periodStart` / `periodEnd` or equally explicit names on the shared Clinical Encounter;
- `createdAt` only as persistence metadata, never as a business event.

Specify which timestamp drives wait-time reporting, follow-up eligibility, queue date, printed token,
and FHIR `Encounter.period`. Do not infer operational events from audit timestamps.

### 9. Add explicit abandonment and closure semantics

The live state machine allows only `waiting → in_consult → completed` or `waiting → cancelled`
([product-blueprint.md:102-114](../product-blueprint.md#opd-encounter--live)). A patient who receives a
token and leaves without consultation is neither a cancelled booking nor a completed encounter. A
machine or network outage can also leave rows waiting indefinitely.

**Recommendation:** keep one operational status axis for now, but add an explicit terminal outcome such
as `left_without_being_seen` (or `closed` plus required `closureReason`) and a reviewed stale-row
worklist. Do not silently auto-cancel clinical rows. Appointment `no_show` remains separate because it
means the booked person never arrived.

Billing remains derived from Charges/Invoices/Payments. Do not add a mutable `billingStatus` to OPD.

### 10. Define follow-up eligibility precisely

The blueprint says a prior **completed** OPD encounter inside the follow-up window qualifies. Code
filters `status = completed` but compares `createdAt` with an absolute millisecond cutoff
([opd.ts:113-139](../../packages/api/src/routers/opd.ts)). A long wait or a changed timezone can move
the effective window, and “N days” is not defined as elapsed hours or Business Dates.

**Recommendation:** the spec should state whether the rule is `N × 24 hours after completion` or
through the end of the Nth Organization Business Date. Query `completedAt`, not `createdAt`, and
snapshot the fee decision and qualifying prior encounter on the Charge for auditability.

### 11. Harden Patient identity before adding more clinical fields

The Patient table requires the patient's own phone, requires address while using empty string for
missing data, stores age without an as-of date, uses ambiguous `uid`, and labels free text as
`allergies` ([patients.ts:30-51](../../packages/db/src/schema/patients.ts)). These shortcuts are more
important than adding the rest of Frappe's demographic form.

**Recommendation:**

- make Patient phone optional and model a caller/caregiver contact separately when that workflow is
  needed;
- make address nullable instead of encoding unknown as `""`;
- replace `ageYears` with `ageAtRegistration` plus `ageRecordedAt`, or derive an estimated birth year
  with an explicit estimated flag;
- replace `uid` with typed patient identifiers (`system/type`, value, issuer), keeping MRN as the
  Organization-local primary identifier;
- rename current text to `allergyNote` and `medicalHistoryNote` so nobody mistakes it for structured,
  verified clinical data; later Allergy/Intolerance and Condition records remain authoritative;
- add patient status and a merge/duplicate-resolution workflow before assuming demographic uniqueness.

Do not copy Frappe's accounting Customer link into Patient. Do not make Patient registration depend on
a registration invoice.

### 12. Repair documentation contradictions before another domain spec

The blueprint headings call Admission/IPD and Emergency “Planned,” while the delivery map calls both
“Evidence-gated” ([product blueprint](../product-blueprint.md#care-access-records-and-lifecycles),
[delivery map](../product-blueprint.md#0-to-100-delivery-map)). The Appointment spec's link direction
also contradicts its own earlier reference research. Research documents 11 and 12 retain large
superseded recommendation sections that are easy to copy accidentally.

**Recommendation:**

1. Rename the IPD and Emergency headings to “Target boundary — Evidence-gated,” or split “boundary
   accepted” from “implementation status.”
2. Amend the Appointment spec's link direction and scheduling semantics before its trigger fires.
3. Add one compact entity matrix to the blueprint with: staff label, code noun, table, owner, lifecycle,
   parent/provenance link, FHIR mapping, and delivery status.
4. Move superseded prescriptions in research 11 and 12 under a clearly marked historical appendix;
   preserve their evidence, but stop presenting obsolete `visits` deltas beside current conclusions.
5. Require every future domain spec to state: source of truth, state transitions, business timestamps,
   correction path, idempotency key, tenant-scoped uniqueness, audit events, and what is derived.

## Decision matrix

| Proposal                                                | Recommendation          | Confidence  | Reason                                                                                             |
| ------------------------------------------------------- | ----------------------- | ----------- | -------------------------------------------------------------------------------------------------- |
| Make every arrival an Appointment                       | Reject                  | High        | Walk-ins have no scheduling lifecycle; synthetic rows corrupt no-show and booking semantics.       |
| Separate Appointment from actual care                   | Keep                    | High        | Frappe, FHIR, Danphe and OpenMRS converge on the boundary even when implementations differ.        |
| Store `opdEncounterId` on Appointment                   | Change                  | High        | Actual care should cite its optional scheduling provenance; avoid two-way links.                   |
| Rename all actual care to `visits`                      | Reject                  | High        | “Visit” is a grouper in OpenMRS, a universal spine in Danphe, and absent in Frappe.                |
| Rename OPD to `patient_encounters`                      | Reject                  | High        | Frappe uses that term for the clinical form; HMS's row owns arrival and queue operations.          |
| Rename `opd_encounters` to `opd_attendances`            | Test with staff         | Medium      | More operationally precise, but unproven local language and low functional payoff.                 |
| Keep internal `clinical_encounters`                     | Keep                    | High        | Stable typed target for notes, orders, files, charges and cross-setting export.                    |
| Share IDs between Clinical Encounter and setting record | Change before expansion | Medium-high | Removes identity translation without merging workflows; IPD child-encounter shape must be checked. |
| Store Business Date on OPD                              | Change                  | High        | Required to enforce and reproduce the documented token scope.                                      |
| Copy Frappe's full configurable masters now             | Reject                  | High        | Breadth is parity; schedules/service units should follow observed workflow.                        |

## What this proves / does not prove

This proves that Appointment and actual care have different lifecycles; that FHIR's relationship points
from Encounter to Appointment; that Visit and Encounter are not standardized at the same aggregation
level across FHIR, OpenMRS, Danphe and Frappe; and that the current HMS spec/schema contain concrete
relationship, timestamp, token and documentation inconsistencies.

It does **not** prove what receptionists at the target hospitals call an OPD attendance, whether they
need arrival separate from check-in, whether appointment capacity must be guaranteed, or whether one
Admission needs child clinical Encounters. Those are workflow questions, not terminology questions.

## What this means for us

Do not start with a broad rename. First fix invariants and make the model's time and provenance
explicit. If the product is still pre-deployment, the highest-leverage design review is:

1. shared Encounter/setting IDs;
2. persisted OPD Business Date plus token uniqueness;
3. explicit arrival/consultation/closure timestamps and outcomes;
4. corrected Appointment provenance direction and reservation semantics;
5. patient identity cleanup.

Only then test `OPD Encounter` versus `OPD Attendance` with actual reception, doctor, billing and
nursing staff. Standardize the code noun after observing their distinctions; do not choose it by
copying the incumbent or by chasing FHIR resource names.

## Next falsification

Run a 45-minute terminology and lifecycle walkthrough with two receptionists and one clinician from a
target hospital. Give them six cards—Appointment, OPD arrival, consultation, Admission, ward round and
Emergency—and ask which can exist without the others, what they call each one, and which timestamps
matter. Then simulate:

1. booked patient arrives early, pays, waits and leaves unseen;
2. walk-in is registered twice concurrently;
3. doctor changes after token issuance;
4. appointment schedules two services but produces one arrival;
5. OPD converts to Admission;
6. Organization timezone changes after historical tokens exist.

The answers decide the low-confidence naming questions and test the high-confidence invariants.

## Sources

- User-supplied Frappe School transcripts: [Master data](https://www.youtube.com/watch?v=52QYSeGVcVc),
  [Patient management](https://www.youtube.com/watch?v=VgBVX944kNw),
  [Consultation management](https://www.youtube.com/watch?v=ObeguwheZeM),
  [Inpatient management](https://www.youtube.com/watch?v=EeKzUazeT0I), and
  [Introduction](https://www.youtube.com/watch?v=a6x8uXg-0VM).
- HL7 FHIR R4 [Appointment](https://hl7.org/fhir/R4/appointment.html) and
  [Encounter](https://hl7.org/fhir/R4/encounter.html).
- OpenMRS [Information Model](https://openmrs.atlassian.net/wiki/spaces/docs/pages/515899478/OpenMRS%2BInformation%2BModel)
  and [Reference Application glossary](https://openmrs.atlassian.net/wiki/spaces/projects/pages/27009151).
- Internal: [product blueprint](../product-blueprint.md), [Appointments spec](../specs/appointments.md),
  [ADR 0022](../contributing/decisions/0022-care-settings-are-separate-destinations.md),
  [ADR 0023](../contributing/decisions/0023-charges-hang-off-the-clinical-encounter.md),
  [appointment/visit boundary](11-appointment-vs-visit-boundary.md), and
  [Danphe/Marley reassessment](15-danphe-marley-architecture-reassessment.md).
