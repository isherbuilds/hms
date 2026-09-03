# Outpatient (OPD)

This page is the current behavior contract for outpatient desk work. Product
vocabulary lives in [`product.md`](./product.md); the reasons behind the record,
lifecycle, pricing, billing-desk, and concurrency choices are recorded in
[`decisions.md`](./decisions.md), D013–D020.

## Record and lifecycle

One `opd_appointments` row represents one scheduled or walk-in outpatient
attendance. There is no separate Visit, Encounter, or Billing Account wrapper.
`arrivalMode` (`scheduled | walk_in`) records how the attendance entered OPD;
`status` records its observable desk lifecycle.

Statuses are exactly `booked | checked_in | cancelled | no_show`:

- scheduled work starts `booked`;
- check-in is the only normal transition and produces `checked_in`;
- `booked` or `checked_in` work may be cancelled with a reason;
- only `booked` work may become `no_show`.

Check-in links or validates the Patient, stamps the fresh server arrival time,
allocates one practitioner/day token, and creates the configured attendance
Charge. It is idempotent under concurrency: one booking receives at most one
token and one automatic attendance Charge. Cancellation and no-show void pending
Charges but never issue a Credit Note or Refund automatically; those remain
separate authorized finance actions.

A read of a past Business Date lazily closes that date's remaining `booked` rows
to `no_show`. Same-day reads do not write, and there is no background sweep.
Reports must therefore reconcile stale bookings independently rather than assume
that somebody previously opened every past OPD day.

Follow-up pricing uses a prior `checked_in` attendance for the same Patient and
Practitioner whose `arrivedAt` falls inside the configured follow-up window. A
cancelled or no-show attendance is not follow-up evidence.

## Day desk

`/$orgSlug/opd` is one searchable day register over booked and checked-in work.
`opd.day` is tenant-scoped, keyset-paged, and ordered newest first by
`(dayOrderAt, id)`, where `dayOrderAt = coalesce(arrivedAt, scheduledFor)`.

Search is temporary client state and matches Patient name, MRN, phone, caller
name, caller phone, or an exact numeric token. The selected date and
`includeClosed` filter are validated URL state. The register polls every 10
seconds, refetches on focus, and includes cancelled and no-show rows only when
requested.

The page has one **New appointment** entry. A booked row offers **Check in**;
clicking or pressing Enter on a row opens the full OPD record. Cancel and no-show
actions live on that record. The Clinical tab owns Patient, care-team,
prescription, and printable-slip facts; Billing is an adjacent tab and does not
appear as a duplicate Clinical action.

## Intake

`/$orgSlug/opd/new` is one Patient-first form with an explicit **When** choice.
The current UI always links a persisted Patient before creating either path;
older or direct caller-only bookings remain valid and require a Patient at
check-in.

Both paths use the same optional, server-searched Services picker. The picker
returns at most six active tenant-scoped catalog matches. Selected rows are local
editable state. For **Now**, every amount on screen comes from one server quote
(`opd.quoteWalkIn`) that re-reads each id, price, and tax fact. The financial
shell stays visible at zero before a quote and while its inputs change; submit
waits for the current quote. For **Later**,
the form lists the chosen services with their catalog rate and no totals, because
a booking collects nothing. The client sends the practitioner only; the server
derives the department from the practitioner record.

### Now

**Now** calls `opd.createWalkIn`. The client supplies no appointment time; the
server owns the fresh arrival instant and Organization-local Business Date. The
path requires OPD create, Patient read, and Billing write permission. A role that
cannot settle sees that limitation without being silently switched to Later.

The server-authoritative quote adds the configured attendance fee by default.
Fee selection is practitioner follow-up item, then practitioner consultation
item, then department default. An intentional zero-price item remains valid.

Active consultation items are also ordinary desk-pickable catalog items. Picking
one during immediate intake suppresses the automatic fee for that quote; removing
the picked row restores the automatic ladder unless the operator separately chose
**Omit fee**. Omission sends `omitConsultFee: true`, requires no reason, and is
revalidated inside creation. If no configured fee or selected service remains,
the result is a valid zero-value walk-in: the checked-in appointment and token
commit without an Invoice, Payment, Receipt, or journal. A zero-value walk-in
cannot accept a discount or payment.

When any billable line remains, appointment, token, Charges, Invoice, any
Payments and Receipts, and journals commit atomically. The desk sends the reviewed
`expectedGrandTotal`;
trusted repricing rejects a mismatch with `CONFLICT`. A collection may contain up
to four Payment lines, and each non-cash line requires its transaction reference.
Successful creation opens the Clinical record directly.

### Later

**Later** reveals one Organization-local future minute and calls `opd.book`.
There is no quote, attendance-fee omission, discount, or collection during
booking. Selected non-consultation services are verified and snapshotted as
pending Charges in the booking transaction. They remain outside cashier and
dashboard unbilled work until check-in; cancellation or no-show voids them.

The Later picker hides consultation items and `opd.book` rejects a consultation
item even when called directly. Check-in still applies the automatic attendance
fee, so allowing a booked consultation would stack it without a supersession
mechanism.

## Catalog and Charge meaning

Catalog categories are `consultation | procedure | lab | radiology | other`, but
an OPD attendance may only be charged for `OPD_BILLABLE_CATEGORIES` —
consultation and procedure (D024). `resolveOpdPricing` and
`catalog.searchServices` both enforce it, so `opd.book`, `opd.createWalkIn`, and
`opd.quoteWalkIn` cannot take a lab or radiology line. Those bill where the work
is ordered, once those domains ship.

Categories are discovery and revenue-grouping vocabulary, not clinical workflow
state. A Charge or Invoice line never proves that a procedure was ordered,
performed, or resulted.

An automatic attendance Charge uses `sourceType: "consult_fee"`. A consultation
picked during immediate intake uses `sourceType: "catalog"` and
`revenueCategory: "consultation"`; source type records how the Charge arose,
while revenue category controls accounting. More than one consultation Charge is
allowed; staff correct a duplicate by voiding the wrong line.

Practitioner and department default fee fields accept any catalog category. A
default item therefore posts to that item's revenue category; consultation
reporting is accurate only when attendance defaults use consultation-category
items.

## Billing workspace and concurrency

The OPD Billing tab is the operational checkout for this care setting. It prices
the Charges the appointment already carries: staff review the pending lines,
void a wrong one, and settle. **There is no catalog picker at the desk.** Charges
reach an appointment through intake or check-in only, because the desk must not
be the place that decides which revenue stream earned the money (D024).
`settleCharges` takes no line input.

Each OPD appointment owns a monotonic `chargeRevision`, an
optimistic-concurrency token over its Charge set (D020). Foreground polling does
not replace the cashier's reviewed snapshot: when another terminal advances the
revision, the workspace keeps the reviewed lines and total, blocks settlement,
and asks the cashier to review the updated Charges before adopting the new
revision. `expectedGrandTotal` separately catches a trusted price or tax change.

## Deferred boundaries

- Scheduled check-in has no attendance-fee omission input. Add one only with a
  separately approved authoritative pricing and persistence contract.
- Clinical procedures and tests need typed child records before the product can
  claim order, performance, result, or completion state.
- Practitioner lanes, a public token display, and a background no-show sweep wait
  for measured pilot need.
- IPD and Emergency remain separate evidence-gated care settings, not modes added
  to OPD.
