# Appointment vs Visit — the entity boundary, the conversion point, and where money attaches

Date: 2026-08-20. Status: external reference research; its HMS `visits` recommendations are
superseded by [ADR 0022](../contributing/decisions/0022-care-settings-are-separate-destinations.md)
and [ADR 0023](../contributing/decisions/0023-charges-hang-off-the-clinical-encounter.md).
Branch: reference architecture — compare Danphe, Frappe Health, OpenMRS/Bahmni and HL7 FHIR
against our `visits` model before adding any appointment schema.

> Historical warning: preserve the source comparison, but do not implement the former `visits`
> spine or its financial wrapper. The current model is setting-owned operational records with
> charges and invoices pointing directly to the shared Clinical Encounter.
> Fires the "if appointments trigger fires" falsification named in
> [04-danphe-marley-entity-deep-dive.md](04-danphe-marley-entity-deep-dive.md#next-falsification).

## Question

Is a scheduled appointment (booked by phone or online, for later) the same entity as a visit
(patient physically at the front desk)? One table or two? At what moment does one become the
other, and where do billing and the queue token attach?

## Answer (lead)

**Two entities, always.** All four references model them separately and none of them collapses
the two. OpenMRS is the strongest evidence: it tried a hard appointment→visit foreign key, and the
module that survived dropped it. The conversion point is **check-in at the desk**, and check-in means _create the visit_,
not _update the appointment_.

Four rules hold across every reference:

1. **The appointment is a thin, optional, pre-patient stub.** It may carry no patient record at
   all, it carries no money, and it carries no token. It can die as `cancelled` or `noshow` and
   never become anything.
2. **The visit/encounter is the spine.** Charges, token, clinical records and tenancy all hang
   off it. A walk-in is a visit with a null appointment link — the appointment side is skipped
   entirely, not faked.
3. **Payment gates neither one.** Both Danphe and Frappe create the charge at intake and carry a
   _billing status_ on the row. Unpaid patients still get a token and still enter the queue.
4. **The token belongs to the visit.** Danphe puts `QueueNo` on the visit row; OpenMRS stores it
   as a `VisitAttribute` and throws without a visit. Frappe is the outlier, putting
   `position_in_queue` on the appointment — and it can only do that because it made walk-ins a
   _mode_ of the same doctype.

Supersedes nothing. Extends doc 04 §E9 (queue/token), which stays canonical for queue mechanics.

## Evidence

### E1 — Danphe: two tables, and the appointment may have no patient

`Code/Components/DanpheEMR.ServerModel/AppointmentModels/` holds **both**
`AppointmentModel.cs` and `VisitModel.cs`.

`AppointmentModel.cs` (38 lines total) — `PatientId` is `int?` **nullable**, beside loose
`FirstName`, `MiddleName`, `LastName`, `Gender`, `Age`, `ContactNumber`. So a phone booking can
exist for a person with no patient record. The model has **no billing field and no queue field**.

`VisitModel.cs` — `VisitCode`, `VisitType`, `VisitStatus`, `BillingStatus`, `QueueNo`,
`ParentVisitId`, and `public int? AppointmentId` (`vm.cs:28`). Nullable, so a walk-in is simply
`AppointmentId = null`.

[INFERENCE] The nullable direction is one-way by design: visit → appointment. There is no
`AppointmentModel.VisitId`.

### E2 — Danphe: "checkin is 'add visit'"

`wwwroot/DanpheApp/src/app/appointments/appt-list/appointment-list.component.ts:178`, verbatim
source comment directly above the `case "checkin":` branch:

```ts
//checkin is 'add visit'--for reference
case "checkin":
```

The branch splits on whether the appointment has a patient yet:

- `if (selAppt.PatientId)` — fetch the full patient by id, prefill, then
  `this.router.navigate(['/Appointment/Visit'])`.
- `else` — prefill name/gender/age/phone straight from the _appointment's own_ loose fields, then
  the same `this.router.navigate(['/Appointment/Visit'])`.

Both land on `/Appointment/Visit`, the identical screen a walk-in uses. Check-in is not a status
patch; it is a redirect into visit creation with the form pre-filled.

Reconciliation runs the other way afterwards.
`Controllers/Appointment/AppointmentController.cs:1114-1120`:

```csharp
dbAppointment.AppointmentStatus = status.ToLower();
if (status == "checkedin")
{
    dbAppointment.PatientId = _appointmentDbContext.Visit
                            .Where(a => a.AppointmentId == appointmentId)
                            .Select(a => a.PatientId).ToList().FirstOrDefault();
}
```

The appointment learns its `PatientId` **from the visit**. The visit is the source of truth.

### E3 — Danphe: intake is one transaction, and payment does not gate it

`VisitController.cs:548-608`, `CreatePatientVisit`, whose own doc comment reads _"Handles logic to
Post New Patient (if patientId=0), Post Visit, and Post BillingTransaction and Update
IsContinuedVisit status."_ Inside one `BeginTransaction()`:

`AddPatientForVisit` → `AddPatientCareTaker` → `AddVisit` → (if department is ER)
`AddEmergencyPatient` → `AddBillingTransactionForPatientVisit` → `SavePatientScheme` → `Commit()`
→ then `VisitBL.CreateNewPatientQueueNo(...)` (`VisitController.cs:601`).

Billing status is decided at creation, not enforced (`VisitController.cs:908-915`):

```csharp
if (billTxn != null && billTxn.PaymentMode == ENUM_BillPaymentMode.credit)
    currVisit.BillingStatus = ENUM_BillingStatus.unpaid;
else
    currVisit.BillingStatus = ENUM_BillingStatus.paid;
```

`shared-enums.ts:1-8` — `ENUM_BillingStatus = paid | unpaid | provisional | cancel | returned |
free` (`free` commented _"needed for free-followups"_).

The queue admits unpaid visits.
`Services/QueueManagement/QueueManagementService.cs:36-37` filters on
`visit.VisitStatus == "initiated"` and `visit.BillingStatus != ENUM_BillingStatus.returned`.
Only a _reversed_ bill removes a patient from the queue — never an unpaid one.

Note `ENUM_AppointmentType = New | followup | Transfer | Referral` (`shared-enums.ts:34-39`) is a
field on the **visit**, classifying why this visit exists. It is not the scheduled-appointment
concept and should not be confused with it.

### E4 — Frappe Health: one doctype, two modes, token on check-in

Frappe Health keeps `Patient Appointment` and `Patient Encounter` as separate doctypes, and
handles walk-ins by switching off the scheduling half of Appointment rather than adding a table.

`healthcare/healthcare/doctype/patient_appointment/patient_appointment.py`:

- Statuses (`set_status`, `:130-146`): `Scheduled` (future) → `Open`/`Confirmed` (today) →
  `Checked In` → `Checked Out` → `Closed`, plus `Cancelled` and `No Show`. Past-dated
  appointments auto-flip to `No Show` but stay check-in-recoverable (the guard at `:134` returns
  early once a terminal-ish status is set).
- **Token = `position_in_queue`, assigned only at check-in** (`set_position_in_queue`, `:467-498`):

  ```python
  if self.status != "Checked In" or self.position_in_queue:
      return
  ```

  then `max(position_in_queue) + 1` partitioned by practitioner + appointment_time +
  service_unit, or by date + service_unit + department. Payment is nowhere in this function.

- **Walk-in mode:** the `appointment_based_on_check_in` flag (`:149-162`, `:275-276`) drops the
  slot requirement — overlap validation collapses to "one per patient per day" and returns before
  any practitioner-schedule check.
- **Billing is an independent axis:** `invoice_appointment` / `create_sales_invoice` (`:531-593`)
  fire from the `show_payment_popup` setting and `fee_validity`, with an explicit source comment
  at `:576`: _"Add payments if payment details are supplied else proceed to create invoice as
  Unpaid"_. `on_payment_authorized` (`:73`) handles the online-prepay case separately.

Healthcare Settings gates _registration_, not the appointment: **"Collect Fee for Patient
Registration"** disables a new patient until the registration fee is invoiced, with
**"Registration Fee"** and **"Registration Validity (Days)"** beside it; **"Automate Appointment
Invoicing"** creates (and on cancel, cancels) the sales invoice at booking.

Encounters do not require an appointment. Marley's Patient Encounter docs: select an appointment
and _"Patient details, Department and Healthcare Practitioner, etc will be fetched
automatically"_; **"Otherwise, you can separately select a Patient."**

### E5 — HL7 FHIR: the boundary is service start, and money hangs off Encounter

Two resources, two modules. R4 Encounter §8.11.2, verbatim:

> "The Encounter resource is not to be used to store appointment information, the Appointment
> resource is intended to be used for that. … **Appointment is used for establishing a date for
> the encounter, while Encounter is applicable to information about the actual Encounter, i.e.,
> the patient showing up.** … **Patient arrival at a location does not necessarily mean the start
> of the encounter** (e.g. a patient arrives an hour earlier than he is actually seen)."

R4 Appointment §12.10.2.2:

> "**Appointments can be considered as Administrative only, and the Encounter is expected to have
> clinical implications.** … **The encounter is typically created when the service starts, not
> when the patient arrives.** … **In an Emergency Room context, the appointment Resource is
> probably not appropriate to be used. In these cases, an Encounter should be created.**"

**Two arrival codes, and the gap between them is the administrative window:**

- `arrived` — _"The patient/patients has/have arrived and is/are waiting to be seen."_
- `checked-in` — _"When checked in, **all pre-encounter administrative work is complete, and the
  encounter may begin**."_

Registration, insurance verification, consent and OPD fee collection sit precisely between those
two codes. `checked-in` is the gate that licenses encounter creation.

`Encounter.appointment` is **`0..*` — optional and repeating** (widened from `0..1` in R4). There
is **no `Appointment.encounter`**. A walk-in is an Encounter with the reference omitted; no
invariant requires it.

Billing attachment:

| Resource   | → Encounter                                 | → Appointment                       |
| ---------- | ------------------------------------------- | ----------------------------------- |
| ChargeItem | Yes (`context` R4 / `encounter` R5, `0..1`) | No                                  |
| Claim      | Yes (`item.encounter` `0..*`)               | No                                  |
| Invoice    | No — transitive via ChargeItem              | No                                  |
| Account    | No — Encounter points _at_ Account          | R5 only: `Appointment.account 0..*` |

The lone R5 `Appointment.account` covers deposits and pre-payment against a booking. Everything
that becomes revenue flows ChargeItem → Encounter.

**Queue tokens are unmodelled, and HL7 says so.** Zero hits for `queue`, `token-number`,
`waiting`, `wait-time` across the full FHIR Extensions Registry. R4/R5 Appointment carries an
implementation note:

> "**Consideration should be given to situations where scheduling needs to be handled in more of a
> queue-like process.** … **This type of clinical appointment scheduling has not been specifically
> covered with this definition of the Appointment resource.**"

Nearest neighbours are not tokens: `Appointment.priority` is clinical urgency (and R5 moves it
from `unsignedInt` to `CodeableConcept`, further from a number); `status = waitlist` is a list,
not a position; R5's `Encounter.subjectStatus` (`arrived | triaged | receiving-care | on-leave |
departed`) is a state with no ordinal.

One R4 invariant constrains any "timeless appointment" idea: _"Only proposed or cancelled
appointments can be missing start/end dates."_ You cannot model "arrived, unscheduled, awaiting a
slot" as a timeless `arrived` Appointment.

Schedule and Slot are supply-side capacity only. Slot is reachable **only** through Appointment —
there is no `Encounter.slot` — so an appointment-less Encounter is structurally disconnected from
them. Slot's "walk-in" note describes _reserved capacity_ a clinic holds back, which still
produces a real Appointment; it is not a model for an unbooked arrival.

### E6 — OpenMRS/Bahmni: the visit is the spine, and the appointment→visit FK was tried and abandoned

**Visit is explicitly a grouper.** `openmrs-core@99a8134`
`api/src/main/java/org/openmrs/Visit.java:33-36` class Javadoc: _"A 'visit' is a contiguous time
period where encounters occur between patients and healthcare providers. This can function as a
grouper for encounters."_ It holds `Set<Encounter> encounters` (`:69-72`) and
`addEncounter()` sets the back-reference (`:253-264`).

Only four columns are business-required on `visit` (`liquibase-schema-only-2.9.x.xml:3299-3333`):
`patient_id`, `visit_type_id`, `date_started`, `uuid`. `location_id` is nullable. **An open visit
is `date_stopped IS NULL`** — that single predicate is the entire "patient is here" signal.

`Encounter.visit` is **nullable** — `Encounter.java:104-107` has no `optional = false`, and the
column is `<column defaultValueComputed="NULL" name="visit_id" type="INT"/>`. The 1.9 design page
states both directions plainly: _"A visit may exist without any encounters"_ and _"An encounter
may exist without a visit."_

**Appointment is not core.** There is no `Appointment` class in `openmrs-core` at all. Two rival
add-on modules exist, and the difference between them is the finding:

- **Legacy `openmrs/openmrs-module-appointmentscheduling`** — `PatientAppointment.java:112` holds
  `private Visit visit;` with a constructor taking a `Visit`. A hard FK.
- **Current `Bahmni/openmrs-module-appointments`** (shipped in the O3 reference application as
  `org.bahmni.module:appointments-omod`) — the `patient_appointment` table
  (`api/src/main/resources/liquibase.xml:158-183`) has **no `visit_id` column**, and the entity
  (`model/Appointment.java:22-55`) links to `Set<Encounter> fulfillingEncounters` instead.
  `grep -rn "Visit"` over the module's sources returns only `LocationTag "Visit Location"` lookups.

**The design that survived is the one without the FK.** `changeStatus`
(`service/impl/AppointmentsServiceImpl.java:273-282`) validates, sets the enum, saves, writes an
audit row, and touches no visit.

Statuses are eight, not five, with a monotonic forward-only sequence
(`model/AppointmentStatus.java:3-4`): `Requested(0), WaitList(0), Scheduled(1), Arrived(2),
CheckedIn(3), Completed(4), Cancelled(4), Missed(4)`.
`DefaultAppointmentStatusChangeValidator:14-22` rejects any transition where
`toStatus.getSequence() <= currentStatus.getSequence()`, except back to `Scheduled` — the
"Reset Appointment Status" privilege. Two more enums worth copying:
`AppointmentKind = Scheduled | WalkIn | Virtual` and
`AppointmentPriority = AsNeeded | Routine | Emergency`.

**Bahmni registration does not know appointments exist.**
`grep -rni "appointment" ui/app/registration/` over `openmrs-module-bahmniapps` returns **zero
hits**; the same grep over `Bahmni/bahmni-core` Java sources also returns zero. The "Start OPD
visit" split button (`ui/app/registration/views/patientAction.html:17-24`, label
`"REGISTRATION_START_VISIT": "Start {{ visitType }} visit"`) calls `createVisitOnly`
(`ui/app/common/models/visitControl.js:34-38`), which POSTs **three fields** to core's
`/ws/rest/v1/visit`: `patient`, `visitType`, `location`. The only precondition is "no active visit
already exists at this location" (`ui/app/registration/directives/patientAction.js:114-186`).

**Where the two do meet, a UI orchestrates two independent writes.** O3's
`esm-appointments-app/src/appointments/common-components/checkin-button.component.tsx:52-80`: if
the patient already has an active visit, flip the appointment status only; otherwise launch the
start-visit workspace and check in once the visit exists. The domain model never joins them. The
Queues functional spec says it outright: _"Appointments — Any action done within the queues app
should have no effect on appointments."_

**The token hangs off the Visit, and this is the most transferable snippet in the report.**
`openmrs/openmrs-module-queue`, `api/.../impl/QueueEntryServiceImpl.java:225-251`,
`generateVisitQueueNumber`: takes `(Location, Queue, Visit, VisitAttributeType)`, **throws if any
is null**, counts today's queue entries for that queue+location, adds one, left-pads to 3, and
prefixes the first three letters of the service name → `TRI-001`. It is stored as a
**`VisitAttribute`**, not a column, then `visitService.saveVisit(visit)`.

Two defects to not copy: generation is `count(*) + 1` with **no uniqueness constraint and no
sequence**, so two clerks registering at the same instant collide. Our `nextCounter` is already
the correct fix.

`queue_entry.visit_id` is nullable but was **added later** (`liquibase.xml:399-408`), and
`grep -rni "appointment"` over the queue module returns zero. O3's `postQueueEntry`
(`queue-fields.resource.ts:23-60`) takes `visitUuid` as its **first positional argument,
unconditionally required**. The queue README: _"Users can add patients to the service queue by
starting visits for them."_

**Money is kept out of the EMR entirely.** Bahmni's registration fee is an OpenMRS **observation**
inside a `REG` encounter (`default-config` `openmrs/apps/registration/app.json`:
`"REGISTRATION FEES": { "required": true, "label": "Fee" }`), and clinicians never see it —
`openmrs/apps/clinical/app.json:128-132` lists `"obsIgnoreList": ["REGISTRATION FEES", ...]`.
`grep -rni "receipt"` over all of bahmniapps returns **zero hits**. Invoices are Odoo documents
synced over an atom feed (`Bahmni/odoo-modules`, `Bahmni/openerp-atomfeed-service`). This is the
opposite of our design and of Danphe's, and it is a warning, not a model: the "fee" is a reporting
artifact with no accounts-receivable behaviour behind it.

**`visit_type` is a bare label — the class field was specced and never built.** `VisitType.java`
declares one field beyond the base metadata. The 1.9 design page proposed a visit **"class"**
_"allows for categorization of visit types into INPATIENT vs. OUTPATIENT vs. EMERGENCY"_,
providing _"something similar to HL7's PV1-2 'Patient Class'"_. `grep -rn
"visitTypeClass\|visit_type_class"` over `openmrs-core` → **zero hits**. It was dropped.
`OPD`/`IPD`/`Emergency` appear only in Bahmni **test fixtures**, never in seed data. Urgency lives
on the queue entry (a priority Concept driving `sortWeight`) or on the appointment
(`AppointmentPriority`, `AppointmentKind`) — never on the visit type.

[INFERENCE] Our `visits.visitClass` check constraint (`opd | ipd | er`) is the field OpenMRS
specced and abandoned, and FHIR ships as `Encounter.class`. Keeping it is right; OpenMRS's gap is
a story about a 2010 module that never landed, not an argument against the column.

**Operational warning: open visits need a janitor.** Because `date_stopped IS NULL` is the only
"patient is here" flag and nothing forces a clerk to close it, Bahmni ships
`org.openmrs.module.emrapi.adt.CloseStaleVisitsTask`, documented as closing visits _"open and
inactive for more than 24 (configurable) hours"_, and warning that it _"does not allow us to
choose which visit types should be closed. It works on ALL visit types."_ OpenMRS core's
auto-close _"will automatically set the end date to the start date, and the end time to 23:59."_

## What this proves / does not prove

**Proves.** The two-entity split is unanimous across an Indian/Nepali production HMS (Danphe), a
FHIR-derived HIS (Frappe/Marley), the largest open-source EMR platform and its distribution
(OpenMRS/Bahmni), and the standard itself. The conversion point is check-in. Charges attach to the
visit/encounter, never to the appointment. Payment does not gate token issuance in any of them.

The OpenMRS evidence is the strongest single data point, because it is a _reversal_: the legacy
`appointmentscheduling` module held a `Visit` FK, the current `appointments` module deleted it,
and the community shipped the latter in O3. That is a design that was tried and rejected in
production, not merely a design that was never attempted.

**Does not prove.** Nothing here says our pilot hospital _wants_ phone bookings — that is a
demand question, not a modelling one, and it remains open in
[03-client-hms-production-sitemap.md](03-client-hms-production-sitemap.md). Reference breadth is
an inventory, not permission to build. Danphe and Frappe both being OPD-heavy South Asian systems
is a shared bias; FHIR and OpenMRS/Bahmni are the independent legs. Bahmni's keep-money-out-of-the-EMR
stance is a _counter_-example to our design, not support for it — see the caveat below.

**Not determined.** Whether any system reconciles a `No Show` appointment against a same-day
walk-in visit by the same patient. Not searched in any of the four. Also unresolved: whether a
downstream Bahmni fork wires appointment check-in into registration via a `forwardUrl` — only
Bahmni-org repos and `Bahmni/default-config` were read.

## What this means for us — deltas, not new scope

Our `visits` table (`packages/db/src/schema/visits.ts`) is already the correct spine and already
matches the reference intake pattern more closely than my first read suggested:

- `visit.create` (`packages/api/src/routers/visit.ts:140-175`) runs **one transaction**:
  `nextCounter` for the token → insert visit → insert consultation charge. Same shape as Danphe's
  `CreatePatientVisit`.
- `tokenNumber` is a per-practitioner, per-business-day counter keyed
  `token:{practitionerId}:{businessDate}` — Frappe's `position_in_queue` partition, done better
  (ours is a real counter, not a `max+1` race).
- The follow-up fee lookup (`visit.ts:110-131`, `followUpValidityDays` window → `followUpFeeItemId`)
  is Frappe's `fee_validity` and Danphe's `ENUM_BillingStatus.free`, already shipped.

Three real deltas:

1. **No `billingStatus` on `visits`.** Both references carry it on the row. Ours is derivable by
   joining charges/invoices/payments, which is correct normalisation but makes the queue query and
   the "who owes money" view expensive. A denormalised status column (`paid | unpaid | credit |
provisional | free`) is the reference pattern. Defer until the collections view exists — do not
   add a second source of truth before there is a reader for it.
2. **`visits.patientId` is `NOT NULL`.** Correct for a visit. It is what makes a _separate_
   appointment table necessary rather than optional if phone bookings ever ship, since the
   appointment must accept an unregistered caller (Danphe's nullable `PatientId` + loose name
   fields).
3. **No appointment entity, and that is currently fine.** Every reference treats appointment as an
   optional pre-step. Walk-in-only is a coherent, standards-aligned configuration, not a gap —
   Bahmni's entire registration module has zero references to appointments and ships that way.
4. **No janitor for stale visits.** Our `status` starts at `waiting` and nothing closes it if the
   patient walks out. Bahmni ships `CloseStaleVisitsTask` (24h, configurable) precisely because
   nothing forces a clerk to close a visit; OpenMRS core auto-close sets the end to 23:59 of the
   start day. Our queue query and any future collections view both inherit this. **This is a real
   operational gap today, independent of the appointment question.**

**If appointments ship, the shape is fixed by all four references:** a thin table with nullable
`patientId`, loose contact fields, requested slot, status
(`scheduled | confirmed | checked_in | cancelled | no_show`), and **no money and no token**.
Steal Bahmni's two extra enums — `kind` (`scheduled | walk_in | virtual`) and `priority`
(`as_needed | routine | emergency`) — since they are how every reference expresses urgency without
polluting the visit type.

Check-in becomes a mutation that calls the existing `visit.create` path and stamps `appointmentId`
on the resulting visit. Do not move `tokenNumber` or charges onto the appointment — FHIR, Danphe,
OpenMRS and our own code all put them on the visit.

**Follow O3's check-in branch, not a status machine.** If the patient already has an open visit,
flip the appointment status only and reuse the visit; otherwise create the visit and then flip.
Two independent writes orchestrated by the caller. That is what lets a walk-in need no appointment
and an appointment need no visit.

**One reference to deliberately ignore.** Bahmni keeps money out of the EMR entirely: the
registration fee is an observation hidden from clinicians, and invoicing lives in Odoo behind an
atom feed. We already made the opposite call (ADR 0020, doc 04 §E1) and it is the right one for a
single-tenant-per-org HMS. Cite Bahmni for the visit/appointment split, never for the money split.

**Do not gate the queue on payment.** Danphe's queue filters on `BillingStatus != returned`, so
unpaid and credit patients stay in line. Gating on paid would force a bypass for ER, a second
bypass for credit/insurance, and a third for free follow-ups. Gate on "a charge exists and is not
voided" instead. ER is then `provisional`, not an exception path.

## Next falsification

- Ask the pilot hospital whether phone/online booking exists today and who takes the call. If the
  answer is "the receptionist writes it in a book", the appointment table stays unbuilt.
- Before adding `visits.billingStatus`, build the org-wide outstanding-invoices view first
  (research 04 §E9 "Token Display" gap, and the missing `/$orgSlug/billing` list route) and
  measure whether the join is actually slow.
- Not read: whether any reference reconciles a `No Show` appointment against a same-day walk-in
  by the same patient.
- Before the pilot: decide the stale-visit policy (auto-close at end of business day vs. leave
  open). Cheap to add now, expensive to backfill once the queue view has months of orphaned
  `waiting` rows.

## Sources

- `https://github.com/opensource-emr/hospital-management-emr` @ master (read 2026-08-20 via
  GitHub API + raw): `Code/Components/DanpheEMR.ServerModel/AppointmentModels/AppointmentModel.cs`,
  `.../VisitModel.cs`, `Code/Websites/DanpheEMR/Controllers/Appointment/VisitController.cs`,
  `.../AppointmentController.cs`, `Code/Websites/DanpheEMR/Services/QueueManagement/QueueManagementService.cs`,
  `wwwroot/DanpheApp/src/app/shared/shared-enums.ts`,
  `wwwroot/DanpheApp/src/app/appointments/appt-list/appointment-list.component.ts`.
- `https://github.com/frappe/health` @ develop (read 2026-08-20):
  `healthcare/healthcare/doctype/patient_appointment/patient_appointment.py`.
- Marley Health docs (Frappe Health distribution), read 2026-08-20:
  `https://marleyhealth.io/patient-appointment`,
  `https://marleyhealth.io/docs/v13/user/manual/en/healthcare/healthcare_settings`,
  `https://marleyhealth.io/docs/v13/user/manual/en/healthcare/patient_encounter`,
  `https://marleyhealth.io/wiki/emergency`.
- HL7 FHIR R4 v4.0.1 and R5 v5.0.0, read 2026-08-20: `hl7.org/fhir/R4/encounter.html`,
  `R4/appointment.html`, `R4/valueset-appointmentstatus.html`, `R4/valueset-encounter-status.html`,
  `R4/chargeitem.html`, `R4/invoice.html`, `R4/account.html`, `R4/claim.html`, `R4/slot.html`,
  `R4/schedule.html`, `R5/appointment.html`, `R5/encounter.html`, `R5/chargeitem.html`,
  `R5/valueset-encounter-subject-status.html`, `hl7.org/fhir/extensions/extension-registry.html`.
- `openmrs/openmrs-core` @ `99a8134` (read 2026-08-20): `api/src/main/java/org/openmrs/Visit.java`,
  `Encounter.java`, `VisitType.java`, `Patient.java`, and the Liquibase schema snapshot
  `liquibase-schema-only-2.9.x.xml`.
- `Bahmni/openmrs-module-appointments` @ `b5d30b2`: `model/Appointment.java`,
  `model/AppointmentStatus.java`, `model/AppointmentKind.java`, `model/AppointmentPriority.java`,
  `validator/impl/DefaultAppointmentStatusChangeValidator.java`,
  `service/impl/AppointmentsServiceImpl.java`, `api/src/main/resources/liquibase.xml`.
- `Bahmni/openmrs-module-bahmniapps` @ `b565d1c`: `ui/app/registration/`, `ui/app/common/models/visitControl.js`,
  `ui/app/adt/controllers/adtController.js`. `Bahmni/bahmni-core` @ `64d7fe4`:
  `bahmni-emr-api/.../VisitIdentificationHelper.java`.
- `openmrs/openmrs-module-queue` @ `04895c3`: `model/QueueEntry.java`,
  `api/src/main/java/.../impl/QueueEntryServiceImpl.java`, `omod/.../Legacy1xRestController.java`,
  `api/src/main/resources/liquibase.xml`. `openmrs/openmrs-esm-patient-management` @ `main`
  (2026-08-20, not permalinked): `esm-appointments-app/.../checkin-button.component.tsx`,
  `esm-service-queues-app/.../queue-fields.resource.ts`.
- OpenMRS/Bahmni docs: "Support for Visits (Design Page)" (Confluence content id `25520865`;
  renders only via `/wiki/rest/api/content/25520865?expand=body.view`),
  `guide.openmrs.org/getting-started/openmrs-information-model/`,
  `guide.openmrs.org/configuration/configuring-visits/`, "Queues App Functional Spec",
  and `bahmni.atlassian.net/wiki` pages for Manage Appointments, Configure Patient Registration,
  Configure Visit Types, Configure Patient Lists / Queues, Auto expiry of Visits.
  **Dead/hijacked, do not use:** `wiki.bahmni.org` (now gambling spam), `docs.bahmni.org`
  (NXDOMAIN), `wiki.openmrs.org/display/docs/Visits` (404).
- Our repo @ working tree: `packages/db/src/schema/visits.ts`, `packages/api/src/routers/visit.ts`.
- Two subagent reports (FHIR Appointment vs Encounter; OpenMRS/Bahmni visit model), both
  citation-gated. Re-verified inline against primary sources: the Danphe and Frappe code quotes,
  the FHIR boundary text, status definitions and billing table. **Not independently re-verified:**
  the OpenMRS/Bahmni file:line citations, which come from the subagent's shallow clones at the
  commits listed above.
