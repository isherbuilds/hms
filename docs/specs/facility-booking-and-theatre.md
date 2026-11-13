# Facility booking, theatre and care-setting handoffs

Owner: facility scheduling. Planning contract requested 2026-11-13. Bed reservations shipped on 2026-11-13
([D064](../decisions.md#d064--bed-reservations-holds-expire-by-time-occupied-beds-are-never-promised-and-displacement-is-explicit));
the theatre slices have not.
Work status lives in the [registry](../README.md#work-lifecycle).

## Boundaries

A reservation is a future claim on capacity; occupancy records allocated accommodation; actual location is tracked separately. Neither creates delivered Charges. IPD owns ward admission and bed
stays; Emergency owns triage, urgent assessment and disposition; OT owns a surgical
case and its room/team/equipment schedule. Surgery can accompany an inpatient or
day-care episode. A bed or stretcher alone does not determine the care setting.
Do not turn an OPD Appointment into an Admission or a theatre booking into care.

Emergency arrival → triage/assessment/stabilisation → home, referral, observation,
or admission. A patient may go directly to OT or critical care; ward arrival is
not a prerequisite. Record the clinical handoff and actual receiving location.
Elective surgery can follow planned admission → OT → recovery → ward → discharge,
or day-care arrival → OT → recovery → same-day discharge. Unexpected overnight
care requires an explicit inpatient handoff, not an automatic timer conversion.
These are software boundaries, not clinical triage or discharge instructions.

## Bed reservations: IPD slice 2

A tenant-owned reservation links Patient, requested category, optional specific
Bed, planned arrival/departure, hold expiry, status, revision and attribution.
Use half-open intervals with end after start; store instants and show the facility
timezone. A category request is a waitlist request, not guaranteed capacity.
A confirmed hold requires a specific bed and is distinct from actual occupancy.
Stored states: requested → confirmed → converted; requested/confirmed →
cancelled; confirmed → disrupted when an authorized block or displacement prevents
fulfilment. Expired is an effective status judged at read time from the hold
expiry, never stored. Disrupted
holds make no capacity promise and require explicit re-confirmation on a ready bed
or cancellation. Effective expiry is derived from time, without requiring a cleanup job.
Expired holds cannot convert. Extensions and reschedules recheck all conflicts.

Confirm/reschedule/convert under Patient and stable Bed locks, with current
revision checks and tenant predicates. Confirmed unexpired holds cannot overlap;
blocked/inactive beds fail. An occupied bed cannot be promised from an estimated
departure alone. Show expected release as provisional; confirm after actual release
and cleaning. This first-release promise is conservative: occupied beds support
tentative requests only, even for future dates. No forecast capacity is sold. Arrival atomically rechecks readiness, creates the Admission/open
stay and marks the hold converted; failure leaves both unchanged. Admission takes
optional reservation id; walk-ins remain supported. Arrival outside the held window
requires a reviewed reschedule first. No-show expiry frees only the hold.

Every occupancy writer (walk-in admission, reservation conversion and bed transfer)
and every readiness/configuration writer (block, maintenance or deactivation)
checks confirmed holds under the same Bed locks. Lock order extends D040 as
Patient when needed → OPD Appointment when needed → Admission when present → Beds
by id → reservation rows by id → existing downstream domain/financial locks.
Never acquire a Patient lock after a Bed lock. Ordinary conflicting commands return
CONFLICT without writes. Actual open occupancy has no promised end: any later hold
it could disrupt must be resolved explicitly before that command succeeds; the
converted hold itself is consumed atomically. Urgent displacement requires
owner/admin authority and a reason, and marks the affected holds disrupted in the
same transaction; they stay visible for reassignment or cancellation and are not
cancelled or reassigned by it. A safety block must still be recorded promptly;
authorized staff mark affected holds disrupted and put them on the resolution
worklist in that same transaction rather than suppressing the block or hiding the
holds. Actual overstay remains authoritative and raises disruption without eviction.

Longer real stays never force discharge or silently move a patient to satisfy a
booking. Surface the affected reservation for reassignment/cancellation. An urgent
walk-in may displace a future hold only through an authorized, reasoned resolution;
never override physical occupancy or hide the displaced reservation. Cancellation
never refunds money automatically. The first release accepts deposits after
admission through existing Advance Receipts; pre-admission booking payments and
cancellation fees are excluded until their liability/refund contract is defined.

Reception uses existing IPD create/update grants; owner/admin manages facility
configuration and reasoned displacement. Sensitive changes are audited. The board
shows occupancy, readiness blocks and future holds separately, with arrival,
expiry, waitlist and disruption worklists. No patient details cross organizations.

## Theatre, rooms and equipment: separate delivery slices

Keep the existing six IPD slices in order. These slices follow working IPD and the
OT product gate; reservations do not imply that OT is clinically operational.

1. **Resource schedule.** Tenant-owned rooms and individually identified reusable
   equipment have type, active status, availability and dated maintenance blocks.
   A surgical case links Patient, responsible consultant, procedure,
   planned interval, preparation/cleanup buffers and required room/equipment.
   Before arrival it has no care-episode parent; an optional bed reservation is
   planning context only. Before actual use, attach and verify the typed Admission
   under scope. First execution release is inpatient-only, including planned cases
   booked before admission; direct Emergency/day-care execution remains blocked
   until its episode/handoff contract exists. Booking itself needs no Admission.
   Draft requests do not promise availability; confirmation reserves every required
   resource atomically, including the named consultant's time. Consultant references
   use existing tenant-scoped Practitioner identities. Additional staff are named
   on the signed clinical roster, without a claim of automated availability checks;
   a schedulable staff identity/availability contract must precede that extension. Reject conflicts under stable locks
   and revisions; adjacent intervals are allowed only after buffers. No partial
   confirmation. Consumables are stock, not reusable calendar resources. Initial
   release books concrete units for surgical cases. Standalone room/equipment
   bookings, pooled capacity, additional staff calendars and recurring bookings
   are deferred; their owners and conflicts must be settled before adding them.
2. **Changes and actual use.** Reschedule/cancel with reason, notify an assigned
   staff worklist, and retain history. Emergency priority flags do not bypass
   conflicts: an authorized coordinator explicitly moves/cancels affected cases.
   Record actual start/end, overruns, recovery arrival/departure and room cleaning;
   future cases become visibly disrupted when actual use overruns. Scheduled end
   never frees an in-use room. Completion and cleaning explicitly restore readiness.
   Record recovery capacity separately from the ward bed; going to OT does not
   implicitly release a retained ward bed. Reserving a machine does not record use.
3. **Safety handoff and delivered billing.** A named clinical owner approves consent,
   anesthesia assessment, checklist, team credentials, infection/isolation needs,
   equipment readiness and recovery/discharge handoffs before operational release.
   The desk tracks signed document references; it does not certify clinical safety.
   Record performed/cancelled/aborted work separately from scheduling. Delivered
   services and batch consumables use the episode's existing Charge/stock paths,
   explicit package inclusion and returns; booking creates no revenue and no second
   Invoice. Inpatient cases bill their Admission; day-care/Emergency cases wait for
   their owned parent and transfer contract rather than borrowing OPD or IPD debt.

Introduce explicit permissions in access.ts for scheduling and exceptional
rescheduling, with minimum receptionist/coordinator visibility; do not grant
clinical sign-off to reception or infer it from booking permission. All records,
resources, references, commands and query keys are org-scoped. Sensitive booking,
override and actual-use corrections are audited; accounting remains transactional.
No public/self-service booking, automatic SMS, clinical decision engine or full
anesthesia/nursing chart is implied by this plan.

## Missing contracts and release evidence

| Area                  | Required acceptance before that workflow ships                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Emergency             | Named clinical owner; triage/reassessment, unidentified patient identity reconciliation, observation, referral/transfer, death/LAMA and downtime policy. Emergency beds/stretchers have their own occupancy and charging rule; IPD noon billing must not leak into observation.                                                                                                                                                                                                                                                                   |
| Cross-setting handoff | Link origin and destination episodes; record accepting clinician, effective time and location. Close the origin handoff once; keep pre-transfer supply and its issued/unissued billing with the origin episode. Link both episodes without copying Charges or stock movements; new supply belongs to the destination. Settle issued origin Invoices there. Unused tagged advances remain with the origin for allocation/refund; no cross-episode spend without a separately approved transfer document. Preserve source identity and attribution. |
| Day care              | Own episode/typed billing parent, same-day tariff/packages, recovery capacity, readiness and discharge; explicit conversion to IPD preserving original supply and unused deposits. No invented 24-hour classification rule.                                                                                                                                                                                                                                                                                                                       |
| Nursing and recovery  | Named staff and signed paper chart/MAR/handoff remain authoritative under D056; capture document references and unresolved tasks. Digital MAR/orders/results require their own approved scope.                                                                                                                                                                                                                                                                                                                                                    |
| Operational readiness | Housekeeping and maintenance blocks, isolation/suitability checks, patient communication ownership, cancellation/no-show/displacement history and manual outage register.                                                                                                                                                                                                                                                                                                                                                                         |
| Billing and claims    | Distinguish reservation, occupied time and delivered work; preserve Claims gate, package exclusions, advance liabilities and correction documents. No automatic cancellation fee.                                                                                                                                                                                                                                                                                                                                                                 |

Verification uses existing tests: concurrent hold/arrival or multi-resource
confirmation has one winner; a stale or conflicting conversion leaves no Admission,
occupancy or partial resource booking. Prove one reservation-to-admission happy
path and one hold-versus-walk-in conflict path without a new test framework; the losing
command leaves neither displaced holds nor partial occupancy. Walk through waitlist,
no-show, overstay, maintenance, urgent displacement and day-care-to-IPD handoff with
the named owners. UI checks cover desktop/phone, light/dark, keyboard and denied
roles. Reconcile one complete surgical stay to occupancy, issues, package and final
Invoice. A scheduling demo cannot substitute for clinical operational approval.

## Reference evidence and departures

[Frappe scheduled admission and ADT](https://frappehealth.com/docs/v13/user/manual/en/healthcare/inpatient_record)
separate scheduled arrival from vacant-bed allotment. Our confirmed date-range
bed holds add an explicit promise/conflict contract beyond that documented flow.
[Bahmni surgical blocks](https://bahmni.atlassian.net/wiki/spaces/BAH/pages/703660044/Surgical%2BBlock)
prevent theatre/principal-surgeon overlap; its
[patient surgery workflow](https://bahmni.atlassian.net/wiki/spaces/BAH/pages/703594508/Managing%2BSurgeries%2Bin%2Ba%2BSurgical%2BBlock)
records estimated duration, cleaning, changes and actual times. Our individually
booked equipment conflict checks are deliberate extensions;
the reference's free-text team fields do not prove those constraints exist.
[Frappe procedures](https://frappehealth.com/docs/v13/user/manual/en/healthcare/clinical_procedure)
separate appointments, execution, consumed stock and unbilled services. We retain
HMS's own immutable billing and departure-independent-of-payment rules.

[WHO emergency triage](https://www.who.int/tools/triage) and its
[disposition algorithm](https://cdn.who.int/media/docs/default-source/integrated-health-services-%28ihs%29/csy/iitt/triage-and-treatment_adult.pdf)
distinguish triage from admission/discharge/referral, including theatre or ward
admission. [NHS hospital admission guidance](https://www.nhs.uk/nhs-services/hospitals/going-into-hospital/going-into-hospital-as-a-patient/)
describes same-day care with a bed and overnight inpatient care. These illustrate
care pathways; they do not establish Indian clinical policy or payer tariffs.
