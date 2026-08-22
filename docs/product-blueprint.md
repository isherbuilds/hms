# HMS product blueprint

This is the canonical product language and domain map for HMS. It names what staff see, what code
calls each record, how the records relate, and which parts are live. Architecture documents explain
implementation; specifications define an approved slice; research is evidence, not product truth.

## Product promise

HMS is an organization-scoped hospital operations system for small and mid-sized Indian hospitals.
It should let each role finish its shift from one consistent data set:

- reception registers patients, manages arrivals, and hands off to care;
- doctors and nurses see the clinical work that needs action;
- cashiers issue bills and receipts without changing clinical state;
- accountants receive traceable source documents, tax classifications, and balanced ledger exports;
- administrators see operational and financial read models without maintaining a second data set.

The product is online-only. One Better Auth Organization is one hospital tenant. Every domain row
belongs to exactly one Organization and every read or write proves that scope.

## Delivery labels

| Label              | Meaning                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------ |
| **Live**           | Implemented, protected, tested, and available in the working application.                  |
| **Next**           | Required before pilot traffic or the next accepted slice.                                  |
| **Planned**        | The vocabulary and boundary are accepted; implementation still needs its trigger and spec. |
| **Evidence-gated** | Not authorized until observed workflow or a sale proves the need.                          |

Future concepts below define the target shape. They do not authorize placeholder routes, tables,
permissions, or navigation.

## Language rules

Use the term in the **record** column in code and database names. Use the **staff label** in
navigation and task copy. URLs use the short, spoken desk term. Never use a generic `visit`, `case`,
or `account` when the exact record is known.

| Staff label | URL          | Record / code     | Table                 | Exact meaning                                                                                                       |
| ----------- | ------------ | ----------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| OPD         | `/opd`       | OPD Appointment   | `opd_appointments`    | One scheduled or walk-in outpatient attendance, shown as Appointments before arrival and Queue after check-in.      |
| IPD         | `/ipd`       | Admission         | `admissions`          | One inpatient stay from admission through discharge/cancellation. “Inpatient” is an adjective, not the record name. |
| Emergency   | `/emergency` | Emergency Case    | `emergency_cases`     | One unscheduled emergency-care workflow from arrival/triage through disposition.                                    |
| Patients    | `/patients`  | Patient           | `patients`            | The organization-local patient identity and medical record number.                                                  |
| Billing     | `/billing`   | Charge / Invoice  | `charges`, `invoices` | Money for care, worked organization-wide. Each document references the exact care record that incurred it.          |
| Reports     | `/reports`   | Report/read model | query/export specific | A derived view over source records, never another write model.                                                      |

There is no universal Visit, Encounter, Episode, or care wrapper. OPD Appointments, Admissions, and
Emergency Cases own their workflows. Typed child records reference the exact parent they belong to;
a shared anchor is introduced only after a concrete cross-setting record proves it is necessary.

## People and access

| Term          | Meaning                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Organization  | One hospital tenant. Never “workspace”, “team”, or “account”.                                                                        |
| User          | A login identity. A User is not tenant scope and may belong to multiple Organizations.                                               |
| Member        | A User's staff membership in one Organization, with one or more unioned roles.                                                       |
| Patient       | The person receiving care, identified inside one Organization by MRN.                                                                |
| Caller        | A person making an Appointment; may be the Patient or another person and may exist before Patient registration.                      |
| Payer         | The person or organization handing over money; may differ from the Patient.                                                          |
| Practitioner  | A clinical professional record, optionally linked to a Member login. “Doctor” is a role-specific label, not the general schema term. |
| Receptionist  | Member role for registration, Appointments, arrivals, and OPD queue work.                                                            |
| Cashier       | Member role for Charges, Invoices, payments, advances, refunds within granted limits, and shift handover.                            |
| Accountant    | Member role for classifications, reconciliation, ledgers, statutory exports, and controlled corrections.                             |
| Nurse         | Member role for assigned queues, vitals, administrations, handovers, and inpatient worklists.                                        |
| Administrator | Member role for organization settings, staff, catalog, permissions, audit, and operational analysis.                                 |

The current broad `member` grant is development-only. Reception, cashier, accountant, doctor, and
nurse permissions must be explicit before real staff onboarding. Navigation is capability-composed:
one person with two roles sees the union of usable destinations, not a separate application.

## Care-access records and lifecycles

### OPD Appointment — Live

Scheduled: `booked → waiting → in_consult → completed`, with `cancelled` and `no_show` exits.

Walk-in: `waiting → in_consult → completed`, with `cancelled` and `left_unseen` exits.

- `arrivalMode` (`scheduled | walk_in`), `kind` (`consultation | procedure`), and `status` are
  independent fields.
- A caller-only booking may exist before Patient registration. Check-in links a Patient and enriches
  the same row with arrival time, daily practitioner token, and configured attendance Charge.
- A walk-in starts with Patient, token, arrival time, and configured attendance Charge. Consultation
  and procedure kinds share this pricing policy; kind is not a free-service switch.
- The configured follow-up fee applies only when the same patient has a **completed** OPD Appointment
  with the same practitioner inside the organization's follow-up window. Waiting and cancelled
  appointments never qualify.
- Billing may issue the Invoice and receive full or partial payment while the OPD status is still
  `waiting`. Clinical completion is not a billing gate.
- Cancellation voids pending Charges; issued financial documents require their own correction flow.

### Admission / IPD — Planned

The staff destination and route are **IPD**; the record is an **Admission**.

`planned | admitted → transferred* → discharge_ready → discharged` with explicit cancellation and
death/disposition paths defined by the eventual clinical owner.

- Owns admission/discharge timestamps, attending practitioner, service-unit/bed occupancy, transfer
  history, nursing handover, and discharge workflow.
- Clinical records and Charges reference the Admission directly unless signed pilot workflow proves
  a different grouping.
- Bed occupancy is temporal history, never a mutable `bedId` alone on the Admission.

### Emergency Case — Planned

`arrived → triaged → under_care → disposition_recorded → closed`

- Owns acuity, triage, emergency team, time-critical observations, and disposition.
- Disposition may discharge, transfer, refer, create an Admission, or record death. Creating an
  Admission is an explicit handoff, not a silent status change.
- Safety discovery, clinical ownership, and downtime procedure are prerequisites.

## Billing, advances, and accounting

Clinical workflow state and financial state are independent. A patient can be waiting after paying,
in consultation with an outstanding balance, or clinically complete before final settlement.

### Financial records

| Record               | Meaning                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| Service Catalog Item | Organization-priced billable service or item with tax classification.                                           |
| Charge               | Catalog-backed billable activity with immutable description, quantity, price, discount basis, and tax snapshot. |
| Invoice              | Immutable classified demand for payment. Corrections use a Credit Note.                                         |
| Payment              | Money applied to one Invoice; a Receipt is the printable proof of that Payment.                                 |
| Advance Receipt      | Money received before it can be allocated to an Invoice; a patient advance liability, not revenue.              |
| Advance Allocation   | Applies part of an Advance Receipt to an Invoice after the invoice exists.                                      |
| Credit Note          | Line-level reduction or reversal of an issued Invoice with tax snapshots.                                       |
| Refund               | Money returned against available advance credit or Credit-Note refund due.                                      |
| Ledger Account       | Chart-of-accounts record used only by the organization Billing Ledger.                                          |
| Journal Entry / Line | Balanced accounting projection posted from immutable billing documents.                                         |

### OPD collection flow

1. Reception creates a walk-in OPD Appointment or checks in a booked one.
2. The same transaction creates the daily token and configured consultation Charge on that row.
3. Billing may issue an Invoice immediately, including while the queue state is `waiting`.
4. The cashier records one or more Payments. A Payment is capped by current positive outstanding;
   partial and full payment are equally valid.
5. Clinical staff move the OPD Appointment independently through consultation.
6. Later services create additional Charges; they are invoiced under explicit hospital policy rather
   than silently modifying an issued Invoice.

### Appointment advance-credit flow

1. Booking may be free. If money is taken, record an Advance Receipt with payer identity, method,
   amount, receipt number, and optional Appointment/Patient references.
2. Accounting entry on receipt: debit Cash/Bank; credit Patient Advances liability.
3. The available credit is derived: `received − allocated − refunded`. Never maintain a mutable
   balance column.
4. At check-in, enrich the same OPD Appointment with Patient, arrival, token, and Charge; issue the
   Invoice when the hospital's billing flow requires it.
5. Apply some or all available credit with an Advance Allocation. Accounting entry: debit Patient
   Advances; credit Patient Receivables.
6. Any remainder stays reusable or is refunded under explicit hospital policy. Cancellation or
   no-show never converts it to revenue automatically.

An **advance credit** is money available to allocate. A **Credit Note** corrects an issued Invoice.
They are different records and must never share a label. “Appointment payment” is banned because it
misstates the liability and couples booking to revenue.

### Billing-ledger boundary

The HMS Billing Ledger explains HMS Invoices, Payments, Advance Receipts and Allocations, Credit
Notes, and Refunds. It is not a general accounting product: no manual journals, payroll, expenses,
opening balances, bank reconciliation, period close, or final accounts. Accountants receive neutral
XLSX/PDF exports; a one-way Tally adapter remains evidence-gated.

## Clinical records — target vocabulary

| Record                    | Meaning and owner                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Allergy / Intolerance     | Patient-level safety record, with status, verification, reaction, and recorder.                                        |
| Condition                 | Patient problem or diagnosis; not an Observation.                                                                      |
| Clinical Note             | Authored note attached to the exact OPD Appointment, Admission, or Emergency Case; signed/amended states are explicit. |
| Observation               | A measured or asserted clinical fact such as vitals or lab values.                                                     |
| Order                     | Practitioner request. Use Service Request for lab/radiology/procedure and Medication Order for drugs.                  |
| Specimen                  | Collected material and chain-of-custody state for a lab Order.                                                         |
| Diagnostic Report         | Signed interpretation grouping atomic result Observations.                                                             |
| Medication Order          | Prescription intent, distinct from Dispense and Administration.                                                        |
| Dispense                  | Pharmacy supply event with item/batch/quantity.                                                                        |
| Medication Administration | Dose actually given to a patient, usually owned by nursing.                                                            |
| Procedure                 | Clinical action performed, with performer, time, outcome, and source Order where applicable.                           |
| Care Plan                 | Longer-lived goals and activities; may span multiple care records.                                                     |
| Referral / Follow-up      | Explicit next-care instruction, not an overloaded encounter status.                                                    |
| Consent                   | Versioned permission with scope, subject, witness/signature, and withdrawal state.                                     |
| Discharge Summary         | Signed Admission outcome document; not the same as changing Admission status.                                          |
| Attachment                | Private link from an owned domain record to a File.                                                                    |

The signed paper prescription remains the current clinical source. Staff attach and open its private
scan from the OPD Appointment screen, and the attachment targets that appointment directly. A
future structured Medication Order must not silently replace or reinterpret it.

## Facility and operations — target vocabulary

- **Department**: organizational specialty or desk, such as General Medicine or Billing.
- **Service Unit**: facility hierarchy node: campus, ward, room, bed, chair, or bay.
- **Bed Occupancy**: dated assignment of an Admission to a bed; transfers close one assignment and
  open another atomically.
- **Queue Token**: practitioner- and Business-Date-scoped OPD sequence, displayed unchanged.
- **Business Date**: calendar date in the Organization timezone, used for queue, numbering, reports,
  and fiscal bucketing. Never infer it from server UTC.
- **Task / Worklist Item**: derived or explicitly assigned operational work. It must link to its
  source record and must not become a parallel source of truth.
- **Handover**: accountable transfer between people or units with author, recipient, time, and state.
- **Disposition**: Emergency outcome; discharge, Admission, transfer, referral, or death.

## Department modules — target boundaries

### Pharmacy and inventory — Evidence-gated

Catalog Item is not Stock Item. Inventory needs Item, Batch/Lot, Stock Location, Stock Movement,
Vendor, Purchase Order, Goods Receipt, Dispense, Return, expiry, and controlled adjustment. Every
movement is immutable and organization-scoped; current stock is derived.

### Laboratory — Evidence-gated

Order → collection → Specimen → processing → result Observations → signed Diagnostic Report.
Reference ranges and units are snapshotted. External lab reports remain private Attachments until
an in-house workflow is owned.

### Radiology — Evidence-gated

Order → schedule → perform → signed Diagnostic Report. Image storage/integration is a separate
decision from storing the report; DICOM/PACS is not implied by a PDF upload.

### Surgery / OT — Evidence-gated

Schedule, theatre/resource allocation, consent, pre-op assessment, anesthesia record, procedure,
implants/consumables, recovery, and billing. It depends on live IPD and signed ownership.

### Insurance / TPA — Evidence-gated

Coverage, payer, tariff/contract, authorization, claim, submission batch, adjudication, denial,
remittance, and patient responsibility. “Credit patient” must not overload Advance Credit.

## Reporting, analysis, and compliance

Reports are reproducible read models over source records and immutable financial documents.

- reception: arrivals, waiting time, no-shows, queue, pending registration;
- doctors: assigned queue, incomplete notes/orders, follow-up work;
- nurses: vitals due, administrations, transfers, handover, occupancy;
- cashiers: unbilled Charges, outstanding Invoices, advances, refunds due, payment-method totals;
- accountants: document registers, GST classification, trial balance, ledger, credit/refund audit,
  export and reconciliation exceptions;
- administrators: volume, wait time, utilization, revenue, outstanding, collection, cancellation,
  staff access, audit, and data-quality exceptions.

Every report states Organization, Business-Date range, timezone, generation time, filters, and
source-document identifiers. Exported totals must reconcile to the same filtered on-screen view.
Mutable workflow rows never replace statutory source documents.

## Navigation target

Working domains appear only when usable. Stable order is:

1. **Overview**: Dashboard
2. **Care**: OPD, IPD, Emergency, Patients
3. **Diagnostics & supply**: Lab, Radiology, Pharmacy, OT (only as each ships)
4. **Finance**: Billing, Insurance, Reports
5. **Workspace**: Files, AI (only when backed by owned workflows)
6. **Administration**: Settings

Routes use lowercase short staff terms: `/opd`, `/ipd`, `/emergency`. Code uses exact records:
`opdAppointment`, `admission`, and `emergencyCase`. Do not create `/visits`, `/outpatient`,
`/inpatient`, or generic `/encounters` compatibility aliases.

## 0-to-100 delivery map

| Capability                                                       | Status                     | Required outcome                                                               |
| ---------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------ |
| Tenant/auth/permissions/audit/private files                      | Live                       | Preserve isolation and explicit org scope.                                     |
| Patient registry, MRN, practitioner/department/catalog           | Live                       | Harden dedupe, data quality, and role boundaries for pilot.                    |
| OPD arrival, queue, consult status, prescription attachment      | Live                       | Complete real-printer and multi-terminal validation.                           |
| Billing, partial payments, credit notes, refunds, Billing Ledger | Live                       | Add agreed operational reports and role split before pilot.                    |
| Scheduled OPD appointments and walk-ins                          | Live                       | One record, booking and queue views, atomic check-in, tokens, and charges.     |
| Advance credit                                                   | Planned                    | Advance receipt/allocation/refund policy.                                      |
| Patient timeline, vitals, notes, diagnoses, orders               | Planned                    | Clinical ownership, typed records, signing/amendment rules.                    |
| IPD/ADT, service units, beds, nursing, discharge                 | Evidence-gated             | Signed admission-to-discharge workflow and facility master.                    |
| Emergency                                                        | Evidence-gated             | Safety discovery, triage owner, downtime path, disposition workflow.           |
| Pharmacy/inventory                                               | Evidence-gated             | Opening stock and signed purchase/sale/return/adjustment flows.                |
| Lab/radiology                                                    | Evidence-gated             | Owners, order/result boundary, templates, units/reference ranges.              |
| OT/surgery                                                       | Evidence-gated             | Live IPD plus consent, anesthesia, resource, and consumable flows.             |
| Insurance/TPA                                                    | Evidence-gated             | Real insured volume, contracts/tariffs, claim ownership.                       |
| ABDM/interoperability                                            | Evidence-gated             | Sale requirement, HFR/HPR/ABHA prerequisites, sandbox/compliance owner.        |
| Patient portal/gateway                                           | Evidence-gated             | Real remote journey with webhook, refund, and reconciliation ownership.        |
| Offline mode                                                     | Evidence-gated             | Outage evidence proves UPS/network and controlled paper fallback insufficient. |
| AI assistance                                                    | Evidence-gated by workflow | Authorization, provenance, consent, human review, and source-record linkage.   |

## Banned ambiguous vocabulary

- **Visit / encounter / episode** — use OPD Appointment, Admission, Emergency Case, or ward round.
- **Case** alone — use the actual OPD Appointment, Admission, Emergency Case, billing, insurance, or support record.
- **Account** alone — say Organization, User, or Ledger Account. There is no per-encounter billing
  account: Charges and Invoices name their exact care record (ADR 0026).
- **Appointment payment** — say Advance Receipt or Advance Credit.
- **Credit** alone — say Advance Credit or Credit Note.
- **Receipt** as the transaction — the transaction is Payment or Advance Receipt; Receipt is its proof.
- **IPD encounter** — the operational record is Admission; IPD is the destination and care setting.
- **Outpatient route / inpatient route** — routes are `/opd` and `/ipd`.
- **Doctor** in generic schema — use Practitioner; use Doctor in role-specific UI copy when exact.
- **Staff user** as tenant scope — authorization uses Member and verified Organization scope.

## Non-negotiable invariants

- Every domain record has `orgId NOT NULL`; every query includes the verified Organization predicate.
- Clinical state never derives from payment state, and payment never silently changes care status.
- Issued financial documents are immutable; corrections are explicit linked documents.
- Money amounts, tax classifications, quantities, and document numbering fail loudly.
- Derived balances and stock are computed from source transactions, not independently edited.
- Every cross-domain reference is verified inside the same Organization before write.
- Sensitive or destructive actions emit audit events without turning audit delivery into the source
  transaction's availability dependency.
- Future domains ship vertically: schema, permission, guarded API, UI, audit, tests, documentation,
  and real owner together. No dead menu entries or compatibility aliases.
