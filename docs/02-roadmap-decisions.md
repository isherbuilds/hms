# HMS roadmap

This is the only forward product roadmap. A row authorizes discovery only after its trigger is met;
implementation still requires a current spec and owner approval. Completed work belongs in code,
tests, ADRs, or research—not in a historical task ledger.

## Before pilot traffic

The OPD loop, organization-local Business Date handling, multi-terminal polling, billing documents,
partial payments, the Billing Ledger, and statutory reports are implemented. The remaining go-live
product work is specified in
[`specs/operational-reports.md`](./specs/operational-reports.md):

- daily collections and the OPD register;
- unbilled-activity, dues-outstanding, and refund-due worklists.

The release also requires the operational checklist below. No department module starts during
pilot stabilization.

## Trigger-gated increments

| Increment                   | Trigger before specification                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Patient timeline and vitals | Live OPD use establishes which timeline fields staff need and who owns vitals capture; storage stays typed rather than JSON/EAV.       |
| Pharmacy POS and stock      | Paid scope, named pharmacy owner, verified opening stock, and signed sale/return/purchase/adjustment workflows.                        |
| In-house lab results        | Named lab owner and signing clinician, measured test volume, approved templates and reference ranges, and an accepted order boundary.  |
| Radiology                   | Named owner, measured demand, and a decision between report storage and imaging integration.                                           |
| IPD / ADT and beds          | Stable OPD operations, paid scope, facility master data, and signed admission-to-discharge, deposit, nursing, and billing workflows.   |
| Emergency                   | Separate safety discovery, medical owner approval of triage and downtime procedures, and 24/7 operational ownership.                   |
| Surgery / OT                | IPD is live and consent, anesthesia, consumables, scheduling, and billing workflows are approved.                                      |
| Insurance / TPA             | Meaningful insured/credit volume or a signed payer requirement, with tariffs and the claim lifecycle documented.                       |
| ABDM                        | A sale requires it and HFR/HPR/ABHA prerequisites, sandbox access, and a compliance owner exist.                                       |
| Gateway or patient portal   | A real remote-payment journey exists, including webhook, refund, and reconciliation ownership.                                         |
| Offline mode                | An outage drill and connectivity log prove operations still fail after network and UPS remediation and paper fallback is unacceptable. |
| Ambient AI consultation     | Consented real consultations meet agreed speech accuracy and review-time thresholds, and clinicians approve the review workflow.       |

OPD, IPD, and Emergency are separate destinations. IPD and Emergency do not reuse OPD route names,
`opdAppointment.status`, or a universal workflow table. Their future Admissions and Emergency Cases
own their records and direct financial links. Until a fulfillment module exists, services may be
billed as ordinary Charges and external reports stored as private files.

## Frozen product boundaries

- The Billing Ledger remains a projection of HMS source documents; no general accounting features.
- Accountant handover is XLSX/PDF first. A Tally export is evidence-gated and one-way.
- Partial and full OPD payment remain supported from Invoice issuance onward, even before the
  consultation starts. Appointment booking and check-in never depend on payment; optional booking
  money is Advance Credit, allocated only after an Invoice exists.
- New permissions, routes, tables, and navigation entries ship with a working domain, not ahead of
  it.
- Reception and accountant permissions split before pilot staff accounts are issued. Doctor and
  nurse permissions ship with their first owned worklists; union-role authorization remains.

## Pilot operational checklist

- Record the release commit and pass the full verification gate.
- Create the pilot organization through the founding-account path; remove seed data; configure
  timezone, numbering, departments, practitioners, catalog, and accountant-approved tax classes.
- Give each staff member an account; verify refund and Credit Note authority and same-day
  offboarding.
- Rehearse any approved demographics/master-data import. Do not recreate old financial documents.
- Verify every printed artifact on the hospital's real printers.
- Back up PostgreSQL and object storage and complete an isolated restore drill.
- Start with one department or shift, make the old HMS read-only, prohibit dual entry, and reconcile
  opd_appointments, invoices, payment methods, refunds, outstanding dues, and unbilled work daily during
  stabilization.
- Train each role on its real workflow and the controlled paper fallback for outages.

## Decisions required before cutover

- Report visibility by role.
- Cashier handover and cash-drawer SOP.
- Accepted payment methods and whether a receipt represents one payment or one bill.
- The accountant handover test and any proven need for a Tally adapter.
- Initial worklist thresholds and named operational escalation owners.
