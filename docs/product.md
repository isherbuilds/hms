# Product

HMS is an online, multi-tenant hospital operations system for small and
mid-sized Indian hospitals. One Better Auth Organization is one hospital. The
live product covers the OPD front office and billing path; it does not claim to
model the whole hospital.

## Product promise

Each role should finish its shift from one consistent, organization-scoped data
set:

- reception registers patients, books or receives OPD arrivals, and manages the
  queue;
- cashiers create itemized financial documents and receipts without changing
  care state;
- accountants receive traceable source documents, balanced ledger exports, and
  tax classifications;
- administrators manage configuration, staff access, audit history, and
  operational read models.

Doctors currently continue signing paper prescriptions. HMS stores private
scans against the OPD Appointment; it does not present an unreviewed digital or
AI reconstruction as the clinical source.

## Scope

| Status             | Capabilities                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Live**           | Tenant/auth spine, patients and MRNs, departments, practitioners, catalog, OPD bookings and walk-ins, treatment plans and sittings, due follow-ups, advance receipts and patient credit, daily queue, prescription attachments, Charges, Invoices, Payments, Receipts, Credit Notes, refunds, billing ledger, GST outward register, trial balance, balance sheet, daily collections, OPD register, billing worklists, dashboard, files, audit, member administration with reception/cashier/accountant/administrator roles, security headers, runtime-only images, upload cleanup, four Payment methods (Cash, UPI, Card, Bank transfer), and measurement-only Sponsor capture (no billing change) |
| **Next**           | Printer validation, release evidence for the hardened images and headers, and the pilot runbook                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Evidence-gated** | Patient timeline/vitals, pharmacy and inventory, lab, radiology, IPD/ADT, Emergency, OT, insurance/TPA, ABDM, payment gateway, patient portal, offline mode, and AI assistance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Evidence-gated work gets no placeholder route, table, permission, or navigation
entry. It starts only with a paid/observed need, a named operational owner, and
an accepted vertical-slice spec.

## Language and boundaries

Use exact staff language in navigation and exact record names in code. Avoid a
generic Visit, Encounter, Episode, Case, or Account when the actual record is
known.

| Staff label        | URL                               | Record / code                       | Meaning                                                                                                                                    |
| ------------------ | --------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| OPD                | `/$orgSlug/opd`                   | OPD Appointment / `opdAppointment`  | One scheduled or walk-in outpatient attendance from booking/arrival through consultation outcome                                           |
| Patients           | `/$orgSlug/patients`              | Patient                             | Organization-local patient identity and MRN                                                                                                |
| Billing            | `/$orgSlug/billing`               | Charge / Invoice                    | Organization-wide financial worklists and source documents                                                                                 |
| Treatment plan     | OPD visit Treatment panel         | Treatment plan / `treatmentPlan`    | One course of quoted work for one Patient and Practitioner, named by its items                                                             |
| Sitting            | OPD and Treatment surfaces        | Plan-linked OPD Appointment         | One attendance in a Treatment plan; the count is derived from linked appointments                                                          |
| Follow-ups         | `/$orgSlug/opd?status=follow-ups` | Treatment follow-up read model      | Open plans without a booked sitting, due or undated, ordered by the requested next date; a Status filter of the OPD desk, not its own page |
| Advance Receipt    | Patient Billing tab               | Advance receipt / `advanceReceipt`  | Money held for future services; it is Credit and a liability until allocation                                                              |
| Credit             | Patient and settlement views      | Unallocated advance balance         | What is left of a Patient's Advance Receipts; the cashier applies it to an Invoice                                                         |
| Post to this visit | OPD visit Treatment panel         | `treatment.postToVisit`             | Turns one quoted plan item into a Charge on the sitting that delivered it                                                                  |
| Reports            | `/$orgSlug/reports`               | Report/read model                   | Reproducible views over source records; never another write model                                                                          |
| Pharmacy           | `/$orgSlug/pharmacy`              | Pharmacy sale / `pharmacySale`      | One counter sale of medicines to a walk-in or a Patient, with its own Invoice                                                              |
| Product            | `/$orgSlug/pharmacy/items`        | Product / `products`                | One stocked item; with a catalog item it is sold at the counter (D027), without one it is an internal supply                               |
| Batch              | `/$orgSlug/pharmacy/stock`        | Stock batch / `stockBatches`        | One received lot of a medicine: batch number, expiry, and MRP; immutable once created                                                      |
| Stock movement     | `/$orgSlug/pharmacy/movements`    | `stockMovements`                    | One signed, reason-coded quantity change on a batch and bucket; stock on hand is their sum (D041)                                          |
| Pharmacy return    | Pharmacy sale Sheet               | Pharmacy return / `pharmacyReturns` | Goods coming back against a sale into quarantine, with its Credit Note and any refund                                                      |
| IPD                | future `/$orgSlug/ipd`            | Admission                           | A future inpatient stay with its own lifecycle                                                                                             |
| Emergency          | future `/$orgSlug/emergency`      | Emergency Case                      | A future emergency workflow with its own lifecycle                                                                                         |

There is no universal care wrapper. OPD Appointments, future Admissions, and
future Emergency Cases own separate tables and state machines. Typed child
records point to their exact parent. A shared anchor is reconsidered only after
two live care settings prove a concrete cross-setting record or query needs it.

People and access terms:

- **Organization:** one hospital tenant; never “workspace”, “team”, or
  “account”.
- **User:** a login identity; never tenant scope.
- **Member:** a User's membership and union of roles inside one Organization.
- **Patient:** a person receiving care, identified locally by MRN.
- **Practitioner:** a clinical professional record, optionally linked to a
  Member login.
- **Caller:** the person making a booking; may exist before Patient registration.
- **Payer:** the person or organization handing over money; may differ from the
  Patient.

## OPD and money

One `opd_appointments` row represents both scheduled and walk-in work.
`arrivalMode` and lifecycle `status` are independent OPD dimensions. Lifecycle
states are exactly `booked`, `checked_in`, `cancelled`, and `no_show` with staff
copy **Booked**, **Checked In**, **Cancelled**, and **No show**. The staff
surface is one searchable `opd.day` list per business date.
See [OPD](./opd.md) for the shipped workflow.

Clinical and financial lifecycles remain independent after creation. The one
deliberate exception is at the transaction boundary: a front-desk walk-in
commits its appointment, token, Charges, and money as a single atomic unit, so
a failure leaves no partial desk walk-in (D015). See
[OPD](./opd.md#now) for that contract.

Financial vocabulary is precise:

- a **Charge** is a priced billable event with server-snapshotted catalog and tax
  facts;
- an internal **Invoice** is the immutable itemized supply aggregate; its printed
  classification may be a Bill of Supply or Tax Invoice;
- a **Payment** is money received and a **Receipt** is its proof;
- a **Credit Note** corrects an issued Invoice and a **Refund** returns money;
- booking money taken before supply is an **Advance Receipt/Credit**, not
  Appointment payment state, and remains a liability until allocation.

Payments use four methods: Cash, UPI, Card, and Bank transfer.

Registration captures an optional Sponsor with Payer policy or employee identifiers for measurement only; it does not change billing—the Invoice remains addressed to the Patient and an uncovered balance remains outstanding.

One collection may be split across at most four Payment lines. Each non-cash
line requires its reconciliation reference and produces its own Receipt. After
an Invoice is issued, a discount is represented by a Credit Note; recording a
Payment never rewrites the immutable Invoice.

Never label a Payment Receipt as the itemized bill. Qualifying exempt health
care, taxable supplies, and advances have different document requirements. The
pilot's chartered accountant must approve classifications and printed fields.
Until that approval lands, the printed itemized document uses the neutral label
**Invoice** and makes no Tax Invoice or Bill of Supply claim.

The Billing Ledger is a code-owned double-entry projection of HMS source
documents. It is not a general accounting product: no manual journals, bank
reconciliation, expenses, opening balances, period close, payroll, inventory
accounting, or final accounts. Handover is XLSX/print first; a one-way Tally
adapter is evidence-gated.

## Delivery rules

- Schema and API changes are clean cutovers. Remove obsolete shapes; do not add
  aliases, dual reads/writes, or compatibility columns. A release that the
  previous version cannot run beside is a stop-the-world deploy, not a
  compatibility layer.
- Applied migration history is append-only (D022).
- A pilot cutover may import agreed demographics and master data. It does not
  recreate historic invoices or use dual entry; the old HMS becomes read-only.
- New domains ship vertically: schema, permission, guarded API, UI, audit,
  tests, docs, and a real owner together. Clinical roles ship with their owned
  workflows.

## Roadmap gates

| Increment                   | Trigger before specification                                                                                                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Patient timeline and vitals | Live OPD use identifies fields, authors, signing, and correction rules                                                                                                                             |
| Pharmacy/inventory          | **Gate open 2026-09-18** — paid scope signed off; the spec's Stage 0 assumptions still await owner confirmation; see [Pharmacy counter sale and stock](./specs/pharmacy-counter-sale-and-stock.md) |
| Lab/radiology               | Named clinical owner, measured demand, approved order/result boundary, templates, units, and signing rules                                                                                         |
| IPD/ADT                     | Stable OPD, paid scope, facility master, and signed admission-to-discharge, deposit, nursing, and billing flow                                                                                     |
| Emergency                   | Separate safety discovery, medical-owner approval, triage/disposition rules, and downtime ownership                                                                                                |
| OT/surgery                  | Live IPD plus approved consent, anesthesia, resources, consumables, recovery, and billing                                                                                                          |
| Insurance/TPA               | Meaningful insured volume or signed payer requirement with tariffs and claim lifecycle                                                                                                             |
| ABDM                        | Sale requirement plus HFR/HPR/ABHA prerequisites, sandbox access, and compliance owner                                                                                                             |
| Gateway/portal              | Real remote-payment journey with webhook, refund, and reconciliation ownership                                                                                                                     |
| Offline mode                | Outage evidence proves network/UPS remediation and controlled paper fallback insufficient                                                                                                          |
| AI assistance               | Owned workflow with consent, provenance, authorization, source linkage, human review, and failure handling                                                                                         |

Before pilot traffic, walk the role map with the shift lead, validate real
printers, rehearse backups/restores and data import, define cashier handover and
correction authority, and reconcile daily during a staged single-department or
single-shift cutover ([operations](./operations.md#pilot-readiness)).

## Non-negotiable product invariants

- Every domain record has `orgId NOT NULL`; every query uses verified scope.
- Clinical state never derives from payment state after creation.
- Issued financial documents are immutable; corrections are linked documents.
- Money, tax, quantities, numbering, configuration, and cross-domain references
  fail loudly.
- A correction never guesses which record the staff meant (D038).
- Derived balances and future stock come from source transactions, not editable
  summary fields.
- AI never bypasses tenancy, authorization, provenance, consent, or review.

### Patient contacts

Registration keeps name, phone, sex, and birth date or age visible. Native
disclosure sections hold Contacts, Personal details, Sponsor, and Medical
details. They start closed, retain draft values when closed, and open when a
contained field has a validation error.

A patient can have a relation (S/o, D/o, W/o, H/o, or C/o) and name, with an
optional mobile number. The registration and edit form can copy this person into
the emergency contact fields; the copy needs their name and mobile number. S/o
and D/o identify a parent; W/o and H/o identify a spouse; C/o leaves the
emergency relation unspecified. The copy fills the visible fields, which the
desk can then correct before saving. An emergency contact requires a name and
phone; its relation is optional. Invoice issuance snapshots the patient relation
label with the patient identity.

The relation label carries its own capitalisation, because both the browser and
the PDF renderer break words at the slash and would print "W/O".

Patient, practitioner, and caller names normalize to lowercase on create or
update; presentation controls casing. The schema migration does not rewrite
existing names. Any production data normalization is a separate operator task.
