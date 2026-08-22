# The simplest durable OPD record

Date: 2026-08-22. Branch: reference architecture. Status: research input, not an accepted decision.
This investigation deliberately optimizes for operator and developer simplicity rather than standards
terminology. External mappings are adapters and do not shape the core record.

## Question

How do ERPNext Healthcare and OpenMRS/Bahmni divide Appointment, Visit and Encounter, and what is the
simplest model HMS can use without creating either a god table or unnecessary orchestration?

## Answer

Use **one Appointment row for the complete OPD operational lifecycle**, with an explicit
`arrivalMode: scheduled | walk_in`. The same row appears in the Appointments view before arrival and
the OPD Queue after arrival. Do not create a second Visit or Clinical Encounter row for OPD.

Keep the Appointment row operational only: identity, scheduling, arrival, queue, practitioner and
lifecycle timestamps. Notes, vitals, diagnoses, orders, files, Charges and financial documents remain
separate tables referencing the Appointment. That is not a god table; it is one aggregate root with
typed child records.

When IPD and Emergency ship, give them separate `admissions` and `emergencies` tables. Do not add those
as Appointment kinds. Introduce a shared care anchor later only if two live domains prove that the same
typed child table must reference both.

## What the references actually do

### ERPNext / Marley

ERPNext uses `Patient Appointment` as the front-desk work item. It supports scheduled slots and an
`appointment_based_on_check_in` mode, puts `position_in_queue` on the Appointment after check-in, and
runs one lifecycle across `Scheduled`, `Open`, `Confirmed`, `Checked In`, `Checked Out`, `Closed`,
`Cancelled`, and `No Show`. Its schema also mixes billing fields into Appointment.

Clinical data is separate: `Patient Encounter` holds symptoms, diagnoses, medications,
investigations, procedures and orders. IPD and Emergency use separate records.

This proves a single scheduled/walk-in OPD work item is operationally viable. The parts not worth
copying are the oversized status list, the separate giant Encounter form, billing fields on
Appointment, and framework-driven doctype coupling.

### OpenMRS / Bahmni

OpenMRS uses three layers:

1. Appointment is optional scheduling.
2. Visit is a period in which the patient is at the facility.
3. Encounter is a granular clinical contact or form inside the Visit.

A walk-in starts a Visit without an Appointment. One outpatient Visit may contain registration,
consultation and dispensing Encounters. Bahmni's current appointment module links Appointments to
fulfilling Encounters rather than making Appointment the actual-care record.

This is appropriate for a clinical platform where one attendance contains several independently
authored clinical interactions. It is more machinery than the current paper-first OPD workflow needs.

## Recommended OPD aggregate

```text
appointments
  id
  orgId
  arrivalMode: scheduled | walk_in
  serviceType: consultation | follow_up | procedure
  patientId?
  callerName?
  callerPhone?
  departmentId
  practitionerId
  scheduledStart?
  scheduledEnd?
  businessDate?
  tokenNumber?
  status
  arrivedAt?
  consultationStartedAt?
  completedAt?
  closedAt?
  closureReason?
  createdBy
  createdAt
  updatedAt
```

Keep the three axes separate:

- `arrivalMode`: how the patient entered (`scheduled | walk_in`);
- `serviceType`: what the OPD work is for;
- `status`: where the work currently is.

Scheduled lifecycle:

```text
booked -> waiting -> consulting -> completed
      \-> cancelled | no_show
               waiting -> left_unseen
```

Walk-in lifecycle:

```text
waiting -> consulting -> completed
       \-> left_unseen
```

Use `voided` only for an erroneous record, with reason and audit, not as a care outcome.

## Why this is not a god table

The Appointment contains only fields needed to schedule and operate the OPD queue. It does not contain:

- clinical note text;
- vitals;
- diagnoses;
- prescriptions or medication lines;
- orders or results;
- Charge or payment amounts;
- invoice status;
- file metadata;
- audit history.

Those are typed child tables with `appointmentId`. The parent answers one question: **what is happening
with this patient's OPD attendance?**

## Required invariants

- `scheduled` requires a booked time; `walk_in` cannot be `booked` or `no_show`.
- `waiting` or later requires Patient, arrival time, Business Date and token.
- `consulting` or `completed` requires `consultationStartedAt`.
- `completed` requires `completedAt`.
- `cancelled` and `no_show` cannot acquire clinical children or Charges.
- `(orgId, practitionerId, businessDate, tokenNumber)` is unique.
- Arrival/token allocation is idempotent.
- Clinical and billing state never share a status column.

Use explicit commands: `bookAppointment`, `registerWalkIn`, `checkInAppointment`,
`startConsultation`, `completeConsultation`, `markNoShow`, `markLeftUnseen`, `cancelAppointment`, and
`voidAppointment`. Avoid a generic `transition(to)` API.

## End-user surfaces

One table, two role-specific views:

- **Appointments**: future bookings, expected arrivals, cancellations and no-shows.
- **OPD Queue**: today's waiting, consulting, completed and left-unseen rows.

The user does not learn Appointment versus Visit. The rule is: **before arrival it is in
Appointments; after arrival it is in the OPD Queue.**

## What this proves / does not prove

ERPNext proves the combined scheduled/walk-in operational row is viable. OpenMRS proves the additional
Visit/Encounter layers become useful when one attendance contains multiple independently authored
clinical contacts. Neither proves that HMS needs those layers today.

This does not prove the target hospitals use the word Appointment for walk-ins. That is a copy choice,
not a schema blocker: the navigation remains Appointments and OPD Queue, while staff need not see the
row's developer noun.

## Next falsification

Prototype one table behind both screens and test five flows with reception and a doctor: scheduled
arrival, walk-in, no-show, left unseen after payment, and rescheduling after a token was mistakenly
issued. Add a second care domain only on paper. If Admission needs the same notes/charges without ugly
typed ownership, that is the trigger for a shared care anchor—not earlier.

## Sources

- Marley `Patient Appointment` [schema](https://github.com/earthians/marley/blob/develop/healthcare/healthcare/doctype/patient_appointment/patient_appointment.json),
  [controller](https://github.com/earthians/marley/blob/develop/healthcare/healthcare/doctype/patient_appointment/patient_appointment.py),
  and `Patient Encounter`
  [controller](https://github.com/earthians/marley/blob/develop/healthcare/healthcare/doctype/patient_encounter/patient_encounter.py).
- OpenMRS [Information Model](https://openmrs.atlassian.net/wiki/spaces/docs/pages/515899478/OpenMRS%2BInformation%2BModel).
- Bahmni appointment module [schema](https://github.com/Bahmni/openmrs-module-appointments/blob/master/api/src/main/resources/liquibase.xml).
