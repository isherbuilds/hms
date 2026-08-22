# HMS product boundaries

This document describes the product as it exists and the constraints for its next increments.
Terms are defined in the [`product blueprint`](./product-blueprint.md). Architectural details live in
[`contributing/`](./contributing/index.md), and future work is gated by
[`02-roadmap-decisions.md`](./02-roadmap-decisions.md).

## Product

- HMS is a cloud, multi-tenant hospital management system for small and mid-sized private
  hospitals. One Better Auth Organization is one hospital.
- The application is online-only. On-premise deployment may use the same containers, never a
  separate codebase.
- The working clinical surface is outpatient care: patient registration, an OPD appointment and queue,
  billing, private files, and paper-prescription capture. Staff see **OPD**; code uses
  `opdAppointment` only for the setting-specific record.
- Inpatient care, emergency, pharmacy, lab fulfillment, radiology, surgery,
  insurance, ABDM, offline mode, gateways, and a patient portal do not exist until their roadmap
  triggers fire. They do not receive placeholder routes, permission subjects, tables, or menu
  entries.
- One OPD Appointment row handles booked and walk-in outpatient care. Inpatient Admissions and
  Emergency Cases will own separate tables and state machines. There is no universal Visit or
  Clinical Encounter wrapper; see
  [ADR 0026](./contributing/decisions/0026-one-opd-appointment-record.md).

## Billing and accounting

- HMS owns catalog items, Charges, Invoices, payments, receipts, Credit Notes, refunds, and the
  Billing Ledger required to explain those source documents.
- Charges and invoices link directly to the owning OPD Appointment. Future IPD and Emergency money
  links directly to its Admission or Emergency Case. Their statuses remain independent of finance.
- An Invoice may be issued and receive multiple partial or full payments after OPD check-in,
  including while the patient is waiting. Clinical status never gates collection.
- A configured follow-up fee applies only after a completed OPD Appointment with the same patient and
  practitioner inside the organization's follow-up window. Waiting and cancelled appointments do not
  qualify.
- Optional booking money is an Advance Receipt: a patient-advance liability that may reference an
  OPD Appointment, never financial state on the Appointment itself. At check-in it can be allocated
  to the Invoice; unused credit remains reusable or refundable under explicit policy.
- The Billing Ledger is a code-owned projection, not a general accounting product. HMS has no
  manual journals, bank reconciliation, expenses, opening balances, period close, inventory
  accounting, payroll, or final accounts.
- Accountant handover is neutral XLSX/PDF. A one-way Tally adapter is built only if a real handover
  test proves the neutral export insufficient. HMS never synchronizes accounting data back from
  Tally.

## Clinical records and AI

- The source prescription is signed paper. Staff manage its private scan on the OPD Appointment.
  HMS does not pretend that an
  unreviewed digital reconstruction is the clinical source of truth.
- Sensitive actions are auditable. Audit delivery remains fire-and-forget unless a later ADR
  explicitly changes that cross-cutting policy.
- AI may draft or help retrieve information, but it does not bypass authorization, tenancy,
  provenance, or human review. Ambient consultation is research until the roadmap trigger is met.

## Delivery rules

- This is pre-production software. Schema and API changes are clean cutovers: remove obsolete
  shapes instead of adding aliases, dual reads, dual writes, or compatibility columns.
- At the first live financial document, migration history becomes append-only. That freezes
  rebasing; it does not authorize mixed-version application deployments.
- A pilot cutover may import demographics and agreed master data. It does not recreate old invoices
  or run dual entry. The old HMS becomes read-only at the cutover timestamp.
- Every new module is sold to the pilot, assigned an operational owner, and specified from observed
  workflow before implementation.

## Staff experience

- Routes and navigation use stable staff vocabulary: **OPD**, **IPD**,
  **Emergency**, **Patients**, **Billing**, and **Reports**.
- Navigation is capability-composed because one employee may hold multiple roles. Reception,
  clinicians, nurses, accountants, and administrators receive different worklists without creating
  separate applications or role-specific URLs.
- The current broad `member` grant is development-only. Reception and accountant permissions split
  before staff onboarding; doctor and nurse grants ship with their first digital workflows.
- Dashboards are read models over source data. They do not introduce a second write model or copy
  financial totals into clinical rows.

## Current unresolved product decisions

- Which operational and statutory reports each hospital role may read.
- Which payment methods and receipt granularity the pilot actually uses.
- Whether neutral accountant handover is sufficient without a Tally adapter.
- Printer constraints and the exact pilot cutover/runbook details.
