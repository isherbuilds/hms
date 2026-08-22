# HMS domain layer

This page maps the HMS domain that is live today. It describes current code,
not a proposed schema or migration. The platform invariants still apply: every
domain row is scoped by `orgId`, every query includes its organization
predicate, and every organization procedure is declared through
`orgProcedure(...)`.

## Current boundary

The live boundary covers organization setup and settings, patient registration
and search, the priced service catalog, department and practitioner setup, OPD
appointments with scheduled and walk-in arrival, a daily token queue, and private captures of the doctor's
signed paper prescription, and billing: immutable invoices,
payments with printable receipts, credit notes, and refunds.
The corresponding organization routes are:

- `/$orgSlug/settings`
- `/$orgSlug/patients` (registration is a sheet over the list at
  `?create=true`, not a route of its own) and `/patients/$patientId`
- `/$orgSlug/opd` (the day's token queue) and `/opd/$appointmentId`, whose layout
  carries two tabs over one record: the clinical view (index) and
  `/opd/$appointmentId/billing`
- `/$orgSlug/billing` (the organization-wide unbilled and unpaid worklist)
- `/$orgSlug/settings/catalog`
- `/$orgSlug/settings/staff`
- the print views under `/billing/invoices/$invoiceId` (invoice, receipt, credit
  note, and refund voucher)
- `/$orgSlug/reports` and the statutory report pages beneath it
  (`/reports/trial-balance`, `/reports/balance-sheet`, `/reports/gst`), each with
  XLSX export and a print view

Inpatient admissions, emergency cases, results, and beds are not live.

```ts
// Existing shape, simplified for architecture documentation.
counter: { orgId, key, value } // primary key (orgId, key)
patients: { id, orgId, mrn, createdBy }
catalogItems: { id, orgId, category, unitPrice, active }
practitioners: { id, orgId, departmentId, memberUserId?, consultFeeItemId? }
opdAppointments: { id, orgId, patientId?, callerName?, callerPhone?, practitionerId, departmentId, arrivalMode, kind, businessDate, scheduledFor?, tokenNumber?, status }
charges: { id, orgId, opdAppointmentId, catalogItemId, unitPrice, taxRatePercent, qty, status, invoiceId? }
invoices: { id, orgId, opdAppointmentId, patientId, invoiceNumber, subtotal, taxTotal, grandTotal }
invoiceLines: { id, orgId, invoiceId, chargeId, allocatedDiscount, taxableValue, taxAmount, gross }
creditNotes: { id, orgId, invoiceId, creditNoteNumber, total }
creditNoteLines: { id, orgId, creditNoteId, invoiceLineId, taxableValue, taxAmount, gross }
payments: { id, orgId, invoiceId, receiptNumber, method, amount }
refunds: { id, orgId, invoiceId, creditNoteId, refundNumber, method, amount }
attachments: { id, orgId, targetType, targetId, fileId, createdBy, createdAt }
```

Billing documents also post balanced double-entry journals into the organization's
Billing Ledger (`accounts`, `journal_entries`, `journal_lines`) inside the same
transaction; that boundary, the seeded chart, and the posting rules live in
[accounting](./accounting.md).

### Patient MRN

Registration reads `mrnPrefix` from the organization settings TTL cache, then
allocates a six-digit per-organization number:

```ts
`${settings.mrnPrefix}${String(seq).padStart(6, "0")}`;
```

The named `mrn` counter increment and patient insert share one database
transaction. The `(orgId, key)` row lock serializes concurrent allocation for
that tenant, and rollback returns the number with the transaction. See
[ADR 0018](../decisions/0018-org-scoped-mrn-counter.md) for the decision and its
limits.

### Chargeable-item catalog

`catalogItems` is the single current registry for chargeable services. Each item
is organization-scoped and carries its category, unit price, tax fields, and
active state. Deactivation hides an item from future selection rather than
deleting it. Charges snapshot description, price, and tax at creation, so a
catalog edit never reprices existing care.

Every Charge is catalog-backed. `billing.addCharge` accepts an active catalog
item ID and quantity only; the server reads and snapshots the organization-owned
description, price, tax, and revenue category. Clients never submit prices or
tax rates.

### Practitioners and logins

A practitioner is a staff record in an organization and belongs to one of that
organization's departments. `memberUserId` optionally links the practitioner to
a login for future attribution; a practitioner can exist without a login. The
user ID is attribution, never tenant scope or authorization. Handlers must prove
that linked department and catalog rows share the request's organization, and
all later reads still scope the practitioner by `orgId`.

`consultFeeItemId` may point at the organization's catalog item used for the
automatic attendance charge when an OPD appointment arrives. It applies to consultation and
procedure kinds alike; `kind` describes the requested work and is not a pricing bypass.

`followUpFeeItemId` reprices that charge when the patient has **completed** care
with the same practitioner inside the follow-up window. Completed, not merely
uncancelled: a duplicate registration made minutes earlier is still `waiting`,
and pricing it as a follow-up would quietly discount the encounter it
duplicates. The cost of the stricter rule is the opposite error — a prior attendance
nobody marked complete charges full price — which is visible at the counter and
correctable with a discount, where the leak is neither.

### OPD appointments

One `opd_appointments` row represents the whole outpatient flow. A booked slot has
`arrivalMode = scheduled`, caller details, and `status = booked`; it may exist before a Patient is
identified. Check-in adds the Patient, arrival time, Business Date, and daily token to that same row
and moves it to `waiting`. A walk-in starts at `waiting` with
`arrivalMode = walk_in`. `kind` independently records `consultation` or `procedure`.

The active flow is `booked → waiting → in_consult → completed`. Explicit exits are `cancelled`,
`no_show`, and `left_unseen`. The daily token comes from
`token:<practitionerId>:<yyyy-mm-dd>` and is allocated only on arrival. Check-in atomically updates
the appointment and creates the configured attendance Charge, so retries cannot duplicate a
token or fee.

Day-window queries filter on `businessDate` or `arrivedAt`, never `createdAt`: a booking is
created before the patient arrives, so creation time is the wrong day.

Charges, Invoices, and prescription attachments point directly at the OPD Appointment. There is no
generic Visit or Clinical Encounter wrapper. Future IPD Admissions and Emergency Cases own their
records, state machines, and direct financial links; cross-setting patient views are read models,
not a shared mutable workflow table. See
[ADR 0026](../decisions/0026-one-opd-appointment-record.md).

Cancelling a booked appointment records the cancellation without a charge. Cancelling or marking a
waiting patient left unseen voids pending Charges. Charges flip to `invoiced` only through invoice
issuance, or to `voided` with a reason. Billing may issue an Invoice and receive partial or full
payment while the appointment remains `waiting`; care state never depends on settlement. Future
booking money is an Advance Receipt and liability, not financial state on the appointment.

### Paper prescriptions and attachments

The doctor's signed paper prescription is the clinical source of truth. Staff
capture its image or PDF from the OPD appointment's own page; the application does not
transcribe, regenerate, or sign it on the practitioner's behalf. A doctor login
is therefore not required for this workflow.

`attachments` is the single polymorphic file-link table for domain documents:
`(orgId, targetType, targetId, fileId)` is unique, and `targetId` deliberately
carries no foreign key. The current target type is `prescription`, and it targets the OPD
Appointment. The attach
procedure proves both the OPD appointment and ready File exist in the caller's organization
and accepts only images or PDFs. Later domains add a constrained target type and
a guarded procedure, not another link table. Detaching removes only the link,
never the File row or stored object. Reads use short-lived presigned URLs.

`attachments.file_id` is the only foreign key pointing into the files domain,
so `file.delete` refuses with `CONFLICT` while a file is still attached to any
record: the prescription has to be detached deliberately, by someone who can see
what they are removing it from, rather than the delete failing on a raw
constraint violation.

Attach and detach successes emit fire-and-forget `opd.prescription.attach`
and `opd.prescription.detach` audit records. Automated extraction is not a
shipped workflow and cannot replace or alter the source.

### Billing

Issuing an invoice is one transaction: the OPD appointment is locked to prevent concurrent
cancellation, then the appointment's pending Charges are locked,
materialized into `invoiceLines` (the snapshot-of-record — pro-rata discount
allocation, per-line tax, header totals as sums of line values), and flipped
to `invoiced`. An issued invoice has no update path; corrections go through
credit notes whose lines reference invoice lines under cumulative per-line
caps, and a refund always settles a credit note. Payments cap against the
current positive outstanding. The balance identity everywhere is
`outstanding = grandTotal − creditTotal − paymentsTotal + refundsTotal`; a
negative value renders as refund due. Document numbers are gapless per
fiscal-year series from the counter keys `invoice:<fy>`, `receipt:<fy>`,
`creditNote:<fy>`, and `refund:<fy>`, formatted `{prefix}{fiscalYear}/{seq}`.

## Procedures and permissions

| Domain          | Procedures                                                                                                                                                                         | Required permission  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Patient         | `patient.register`                                                                                                                                                                 | `patient:create`     |
| Patient         | `patient.search`, `patient.get`                                                                                                                                                    | `patient:read`       |
| Patient         | `patient.update`                                                                                                                                                                   | `patient:update`     |
| Catalog         | `catalog.list`                                                                                                                                                                     | `catalog:read`       |
| Catalog         | `catalog.create`                                                                                                                                                                   | `catalog:create`     |
| Catalog         | `catalog.update`                                                                                                                                                                   | `catalog:update`     |
| Departments     | `staff.listDepartments`                                                                                                                                                            | `staff:read`         |
| Departments     | `staff.createDepartment`                                                                                                                                                           | `staff:create`       |
| Departments     | `staff.updateDepartment`                                                                                                                                                           | `staff:update`       |
| Practitioners   | `staff.listPractitioners`                                                                                                                                                          | `staff:read`         |
| Practitioners   | `staff.createPractitioner`                                                                                                                                                         | `staff:create`       |
| Practitioners   | `staff.updatePractitioner`                                                                                                                                                         | `staff:update`       |
| OPD appointment | `opd.book`, `opd.createWalkIn`                                                                                                                                                     | `opd:create`         |
| OPD appointment | `opd.checkIn`, `opd.reschedule`, `opd.startConsultation`, `opd.complete`, `opd.cancel`, `opd.markNoShow`, `opd.markLeftUnseen`, `opd.attachPrescription`, `opd.detachPrescription` | `opd:update`         |
| OPD appointment | `opd.queue`, `opd.appointments`, `opd.get`                                                                                                                                         | `opd:read`           |
| Billing         | `billing.worklist`, `billing.listPendingCharges`, `billing.invoiceBalance`, `billing.listInvoices`, `billing.getInvoice`                                                           | `billing:read`       |
| Billing         | `billing.addCharge`, `billing.voidCharge`                                                                                                                                          | `billing:write`      |
| Billing         | `billing.issueInvoice`, `billing.recordPayment`                                                                                                                                    | `billing:write`      |
| Billing         | `billing.issueCreditNote`, `billing.recordRefund`                                                                                                                                  | `billing:creditNote` |
| Report          | `report.trialBalance`, `report.balanceSheet`, `report.gst`                                                                                                                         | `report:read`        |

These are all `orgProcedure(...)` calls. Permission checks establish what the
member may do; they do not replace the `orgId` predicate on every select,
insert, and update. Optional practitioner/member linkage is attribution only;
it never authorizes a row.

Patient registration and update, OPD appointment creation and its exit
transitions (`opd.cancel`, `opd.markNoShow`, `opd.markLeftUnseen` — the routine
flow steps `reschedule`, `checkIn`, `startConsultation`, and `complete` do not
audit), billing mutations
(`charge.void`, `invoice.issue`, `payment.record`, `creditNote.issue`,
`refund.record`), and paper-prescription mutations (`opd.prescription.attach`,
`opd.prescription.detach`) call
the ordinary fire-and-forget `audit()` after their database writes; the audit
write is never part of the domain transaction.
Follow the [audit architecture](./audit.md) rather than
inventing events or assuming atomic audit behavior.
