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

| Status             | Capabilities                                                                                                                                                                                                                                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Live**           | Tenant/auth spine, patients and MRNs, departments, practitioners, catalog, OPD bookings and walk-ins, daily queue, prescription attachments, Charges, Invoices, Payments, Receipts, Credit Notes, refunds, billing ledger, GST outward register, trial balance, balance sheet, dashboard, files, audit, and member administration |
| **Next**           | Daily collections, OPD register, refund-due worklist, unbilled alert threshold, production hardening, role split, printer validation, and pilot runbook                                                                                                                                                                           |
| **Evidence-gated** | Patient timeline/vitals, pharmacy and inventory, lab, radiology, IPD/ADT, Emergency, OT, insurance/TPA, ABDM, payment gateway, patient portal, offline mode, and AI assistance                                                                                                                                                    |

Evidence-gated work gets no placeholder route, table, permission, or navigation
entry. It starts only with a paid/observed need, a named operational owner, and
an accepted vertical-slice spec.

## Language and boundaries

Use exact staff language in navigation and exact record names in code. Avoid a
generic Visit, Encounter, Episode, Case, or Account when the actual record is
known.

| Staff label | URL                          | Record / code                      | Meaning                                                                                          |
| ----------- | ---------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| OPD         | `/$orgSlug/opd`              | OPD Appointment / `opdAppointment` | One scheduled or walk-in outpatient attendance from booking/arrival through consultation outcome |
| Patients    | `/$orgSlug/patients`         | Patient                            | Organization-local patient identity and MRN                                                      |
| Billing     | `/$orgSlug/billing`          | Charge / Invoice                   | Organization-wide financial worklists and source documents                                       |
| Reports     | `/$orgSlug/reports`          | Report/read model                  | Reproducible views over source records; never another write model                                |
| IPD         | future `/$orgSlug/ipd`       | Admission                          | A future inpatient stay with its own lifecycle                                                   |
| Emergency   | future `/$orgSlug/emergency` | Emergency Case                     | A future emergency workflow with its own lifecycle                                               |

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
See the [OPD desk lifecycle spec](./specs/opd-desk-lifecycle.md) for behavior.

Clinical and financial lifecycles remain independent after creation. The normal
front-desk walk-in is one deliberate exception at the transaction boundary: it
atomically creates the appointment, token, known Charges, itemized supply
document, Payments, Receipts, and balanced journals. It must be settled or carry
an explicit credit/discount reason. A failure leaves no partial desk walk-in.

Financial vocabulary is precise:

- a **Charge** is a priced billable event with server-snapshotted catalog and tax
  facts;
- an internal **Invoice** is the immutable itemized supply aggregate; its printed
  classification may be a Bill of Supply or Tax Invoice;
- a **Payment** is money received and a **Receipt** is its proof;
- a **Credit Note** corrects an issued Invoice and a **Refund** returns money;
- booking money taken before supply is an **Advance Receipt/Credit**, not
  Appointment payment state, and remains a liability until allocation.

Never label a Payment Receipt as the itemized bill. Qualifying exempt health
care, taxable supplies, and advances have different document requirements. The
pilot's chartered accountant must approve classifications and printed fields.

The Billing Ledger is a code-owned double-entry projection of HMS source
documents. It is not a general accounting product: no manual journals, bank
reconciliation, expenses, opening balances, period close, payroll, inventory
accounting, or final accounts. Handover is XLSX/print first; a one-way Tally
adapter is evidence-gated.

## Delivery rules

- Pre-production schema and API changes are clean cutovers. Remove obsolete
  shapes; do not add aliases, dual reads/writes, or compatibility columns.
- Migration history becomes append-only at the first live financial document.
- A pilot cutover may import agreed demographics and master data. It does not
  recreate historic invoices or use dual entry; the old HMS becomes read-only.
- New domains ship vertically: schema, permission, guarded API, UI, audit,
  tests, docs, and a real owner together.
- The current broad `member` grant is development-only. Reception, cashier, and
  accountant permissions split before pilot staff onboarding; clinical roles
  ship with their owned workflows.

## Roadmap gates

| Increment                   | Trigger before specification                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Patient timeline and vitals | Live OPD use identifies fields, authors, signing, and correction rules                                         |
| Pharmacy/inventory          | Paid scope, pharmacy owner, verified opening stock, and signed sale/return/purchase/adjustment workflows       |
| Lab/radiology               | Named clinical owner, measured demand, approved order/result boundary, templates, units, and signing rules     |
| IPD/ADT                     | Stable OPD, paid scope, facility master, and signed admission-to-discharge, deposit, nursing, and billing flow |
| Emergency                   | Separate safety discovery, medical-owner approval, triage/disposition rules, and downtime ownership            |
| OT/surgery                  | Live IPD plus approved consent, anesthesia, resources, consumables, recovery, and billing                      |
| Insurance/TPA               | Meaningful insured volume or signed payer requirement with tariffs and claim lifecycle                         |
| ABDM                        | Sale requirement plus HFR/HPR/ABHA prerequisites, sandbox access, and compliance owner                         |
| Gateway/portal              | Real remote-payment journey with webhook, refund, and reconciliation ownership                                 |
| Offline mode                | Outage evidence proves network/UPS remediation and controlled paper fallback insufficient                      |
| AI assistance               | Owned workflow with consent, provenance, authorization, source linkage, human review, and failure handling     |

Before pilot traffic, complete the [reports spec](./specs/reports.md), split
roles, validate real printers, rehearse backups/restores and data import, define
cashier handover and correction authority, and reconcile daily during a staged
single-department or single-shift cutover.

## Non-negotiable product invariants

- Every domain record has `orgId NOT NULL`; every query uses verified scope.
- Clinical state never derives from payment state after creation.
- Issued financial documents are immutable; corrections are linked documents.
- Money, tax, quantities, numbering, configuration, and cross-domain references
  fail loudly.
- Derived balances and future stock come from source transactions, not editable
  summary fields.
- AI never bypasses tenancy, authorization, provenance, consent, or review.
