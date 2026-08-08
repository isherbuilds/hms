# HMS domain layer

This page maps the HMS domain that is live today. It describes current code,
not a proposed schema or migration. The platform invariants still apply: every
domain row is scoped by `orgId`, every query includes its organization
predicate, and every organization procedure is declared through
`orgProcedure(...)`.

## Current boundary

The live boundary covers organization setup and settings, patient registration
and search, the priced service catalog, department and practitioner setup, OPD
visits with a per-practitioner daily token queue, charges accumulating on the
visit, and billing: immutable invoices, payments with printable receipts,
credit notes, and refunds.
The corresponding organization routes are:

- `/org/$orgSlug/admin/settings`
- `/org/$orgSlug/front-desk`, `/front-desk/register`,
  `/front-desk/patients/$patientId`, `/front-desk/queue`, and
  `/front-desk/visits/$visitId` beneath the same organization prefix
- `/org/$orgSlug/admin/catalog`
- `/org/$orgSlug/admin/staff`
- `/org/$orgSlug/billing`, `/billing/visits/$visitId`, and the print views
  under `/billing/invoices/$invoiceId` (invoice, receipt, credit note, and
  refund voucher)

Appointments, consult notes, orders, results, and beds are not live.

## Existing relationships

```ts
// Existing shape, simplified for architecture documentation.
counter: { orgId, key, value } // primary key (orgId, key)
patients: { id, orgId, mrn, createdBy }
catalogItems: { id, orgId, category, unitPrice, active }
practitioners: { id, orgId, departmentId, memberUserId?, consultFeeItemId? }
visits: { id, orgId, patientId, practitionerId, departmentId, tokenNumber, status }
charges: { id, orgId, visitId, catalogItemId?, unitPrice, taxRatePercent, qty, status, invoiceId? }
invoices: { id, orgId, visitId, patientId, invoiceNumber, subtotal, taxTotal, grandTotal }
invoiceLines: { id, orgId, invoiceId, chargeId, allocatedDiscount, taxableValue, taxAmount, gross }
creditNotes: { id, orgId, invoiceId, creditNoteNumber, total }
creditNoteLines: { id, orgId, creditNoteId, invoiceLineId, taxableValue, taxAmount, gross }
payments: { id, orgId, invoiceId, receiptNumber, method, amount }
refunds: { id, orgId, invoiceId, creditNoteId, refundNumber, method, amount }
```

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

### Practitioners and logins

A practitioner is a staff record in an organization and belongs to one of that
organization's departments. `memberUserId` optionally links the practitioner to
a login for future attribution; a practitioner can exist without a login. The
user ID is attribution, never tenant scope or authorization. Handlers must prove
that linked department and catalog rows share the request's organization, and
all later reads still scope the practitioner by `orgId`.

`consultFeeItemId` may point at the organization's catalog item used for the
automatic consultation-fee charge when a visit is created.

### Visits and charges

A visit is one patient arrival: `waiting → in_consult → completed`, or
`waiting → cancelled` (cancellation voids the visit's pending charges). The
daily token comes from the counter key `token:<practitionerId>:<yyyy-mm-dd>`.
Charges accumulate on the visit as `pending` rows with snapshotted money
fields and flip to `invoiced` only through invoice issuance, or to `voided`
with a reason.

### Billing

Issuing an invoice is one transaction: the visit's pending charges are locked,
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

| Domain        | Procedures                                                                                           | Required permission  |
| ------------- | ---------------------------------------------------------------------------------------------------- | -------------------- |
| Patient       | `patient.register`                                                                                   | `patient:create`     |
| Patient       | `patient.search`, `patient.get`                                                                      | `patient:read`       |
| Patient       | `patient.update`                                                                                     | `patient:update`     |
| Catalog       | `catalog.list`                                                                                       | `catalog:read`       |
| Catalog       | `catalog.create`                                                                                     | `catalog:create`     |
| Catalog       | `catalog.update`                                                                                     | `catalog:update`     |
| Departments   | `staff.listDepartments`                                                                              | `staff:read`         |
| Departments   | `staff.createDepartment`                                                                             | `staff:create`       |
| Departments   | `staff.updateDepartment`                                                                             | `staff:update`       |
| Practitioners | `staff.listPractitioners`                                                                            | `staff:read`         |
| Practitioners | `staff.createPractitioner`                                                                           | `staff:create`       |
| Practitioners | `staff.updatePractitioner`                                                                           | `staff:update`       |
| Visit         | `visit.create`                                                                                       | `visit:create`       |
| Visit         | `visit.transition`                                                                                   | `visit:update`       |
| Visit         | `visit.queue`, `visit.get`                                                                           | `visit:read`         |
| Billing       | `billing.listPendingCharges`, `billing.invoiceBalance`, `billing.listInvoices`, `billing.getInvoice` | `billing:read`       |
| Billing       | `billing.addCharge`, `billing.voidCharge`, `billing.issueInvoice`, `billing.recordPayment`           | `billing:write`      |
| Billing       | `billing.issueCreditNote`, `billing.recordRefund`                                                    | `billing:creditNote` |

These are all `orgProcedure(...)` calls. Permission checks establish what the
member may do; they do not replace the `orgId` predicate on every select,
insert, and update. Optional member linkage likewise never authorizes a row.

Patient registration and update, visit creation and transitions, and the
billing mutations (`charge.void`, `invoice.issue`, `payment.record`,
`creditNote.issue`, `refund.record`) call the ordinary fire-and-forget
`audit()` after their database writes; the audit write is never part of the
domain transaction. Follow the [audit architecture](./audit.md) rather than
inventing events or assuming atomic audit behavior.
