# Multi-sitting treatments and advance money

Research memo, 2026-09-14. Question: how should HMS handle a treatment that
spans several OPD visits (dental root canal over three or four sittings,
physiotherapy over ten sessions) when the patient pays in irregular amounts and
may add work mid-way (a crown)? References read: Frappe Health (Marley
`develop`), Open Dental, Jane, Cliniko, OpenMRS/Bahmni, Odoo, GNU Health, Ind AS
115, and CBIC Notification 12/2017.

## Answer

Keep four facts separate and link them: the open **Treatment plan**, each real
**OPD Appointment**, the billable work delivered on that appointment, and the
money received or allocated. An RCT is one priced item that can span any number
of sittings and normally posts when the agreed billable work is complete. A
per-session physiotherapy course is one item with a planned quantity and posts
one unit on each delivered session. A crown is another plan item, added only
when accepted. Money received before an earned Charge is an advance liability,
not a Payment against a made-up Invoice.

This is also the smallest fit with HMS. It reuses OPD attendance, Charges,
immutable Invoices, payment methods, and the ledger. It does not add a generic
Encounter, package, instalment schedule, or zero-price service as a proxy for a
sitting.

## Today's workaround and why it fails

The desk adds the full procedure at the first sitting, issues that visit's
Invoice unpaid, and on later visits opens the first visit's Invoice and records
a Payment. The data model forces this: `charges` and `invoices` require an
`opdAppointmentId`, `payments` require an `invoiceId`, and no advance record
exists, although `docs/product.md` already names an **Advance Receipt/Credit**
that "remains a liability until allocation".

Consequences:

- Revenue and the receivable post on day one for work not yet done. If the
  patient stops after two sittings, the correction is a Credit Note, not a
  refund of unused money.
- Money collected on sitting three sits against sitting one's Invoice, so the
  visit and the money disagree in the OPD register.
- A crown added mid-way becomes a second Invoice on whichever visit it was
  typed, with no link to the course of treatment.
- Nothing records "sitting 3 of 4", so no worklist can show stalled courses.

## What the references do

| System        | Course parent                                                                 | Delivered unit                                                            | When the fee posts                                                                                                        | Money before delivery                                                                     |
| ------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Open Dental   | Treatment Plan (one active per patient)                                       | Procedure with status TP → C (C/P while grouped multi-visit work is open) | Only on status C; multi-visit uses one $0 line plus one fee line, or a group held "In Process" until the last visit       | "Unearned income": unallocated pay splits, later moved to procedures by zero-sum transfer |
| Frappe Health | Therapy Plan / Service Request (`quantity`, `qty_invoiced`, `billing_status`) | Therapy Session / Clinical Procedure (one per session)                    | Per session, per ordered quantity, or one package Invoice from a Therapy Plan Template; exactly one of the three per plan | Only Treatment Counselling (inpatient) takes a Payment Entry in advance                   |
| Jane          | Treatment Plan is clinical only; Package is financial                         | Attended appointment redeems one package "punch"                          | Package invoiced at sale; each appointment still gets a ₹0 invoice; refund = price ÷ uses × remaining                     | Account credit                                                                            |
| Cliniko       | Patient Case (`max_sessions`, `max_invoiceable_amount`)                       | Appointment invoiced against the case                                     | Per appointment                                                                                                           | Account credit applied with no payment source                                             |
| Odoo          | Sale Order                                                                    | Service line                                                              | Final invoice deducts down payment                                                                                        | Down-payment product on an income account                                                 |

The useful recurring pattern is:

1. A course-of-treatment parent with planned lines; the line, not the parent,
   carries the price.
2. The charge posts when the agreed billable unit is delivered, not when it is
   planned. A billable unit need not equal one attendance.
   Dental coding agrees: the ADA claim date is the completion date, and the AAE
   guide reports an incomplete root canal as pulpal debridement, not as
   endodontic therapy.
3. Money received before delivery is a liability (Open Dental "unearned",
   Cliniko "account credit", Ind AS 115 "contract liability") and is allocated
   to charges later.
4. Balance is derived from charges minus credits, never stored.

Frappe Health is the weakest donor here: its plan billing is three mutually
exclusive paths, sessions were double-billed until v16.1.1 (issue #996), the
package path filters on a `docstatus` the plan can never have, bulk session
creation is still open (issue #124), and advances exist only for inpatients.

Marley still supplies two useful operational patterns. Its Therapy Plan counts
submitted Therapy Sessions without fixing their future dates, and its
appointments can reserve a practitioner plus a capacity-limited Healthcare
Service Unit. A dental chair or physiotherapy bay maps to that outpatient
resource; an inpatient bed does not. The relevant source is the
[Therapy Plan update](https://github.com/earthians/marley/blob/c74fd9b50305acf59641e25d0188f31bdffd85e9/healthcare/healthcare/doctype/therapy_plan/therapy_plan.py#L23-L42),
[Therapy Session completion](https://github.com/earthians/marley/blob/c74fd9b50305acf59641e25d0188f31bdffd85e9/healthcare/healthcare/doctype/therapy_session/therapy_session.py#L82-L112),
and [appointment capacity check](https://github.com/earthians/marley/blob/c74fd9b50305acf59641e25d0188f31bdffd85e9/healthcare/healthcare/doctype/patient_appointment/patient_appointment.py#L170-L235)
on reviewed commit `c74fd9b`.

Do not copy Marley's billing collector. It chooses among appointment, Service
Request, direct procedure, direct therapy session, package, and inpatient
sources, then excludes overlaps. The branches are visible in
[`healthcare/utils.py`](https://github.com/earthians/marley/blob/c74fd9b50305acf59641e25d0188f31bdffd85e9/healthcare/healthcare/utils.py#L31-L50).
Its uninsured Service Request branch computes the remaining quantity but offers
the original ordered quantity for the next invoice, and plan completion uses
exact equality without a clear overrun guard. These are concrete warnings
against several source-specific billing paths and stored counters; see the
[quantity branch](https://github.com/earthians/marley/blob/c74fd9b50305acf59641e25d0188f31bdffd85e9/healthcare/healthcare/utils.py#L809-L900)
and [therapy equality check](https://github.com/earthians/marley/blob/c74fd9b50305acf59641e25d0188f31bdffd85e9/healthcare/healthcare/doctype/therapy_session/therapy_session.py#L151-L157).

## India: what the accountant needs

- Health care by a clinical establishment is exempt (Notification 12/2017,
  entry 74). Restorative dentistry (root canal, filling, extraction) is exempt;
  purely cosmetic work is taxable. Taxability stays a per-catalog-item fact.
- An advance is a Receipt Voucher (CGST Rule 50); its refund is a Refund
  Voucher (Rule 51) citing the receipt voucher. For exempt supplies no GST is
  due on the advance, but the voucher trail is still expected.
- Ind AS 115 requires the hospital to identify the promised goods or services
  and recognise revenue when or as those obligations are satisfied. It does
  **not** establish that every clinical sitting is a separate performance
  obligation. For a per-session physio contract, recognising each delivered
  unit is a reasonable application; for one RCT fee across several sittings,
  the hospital's accountant must approve the earned milestone. Money received
  before the relevant obligation is satisfied is presented as a contract
  liability.
- Reports a CA asks for: advance received versus revenue recognised, refunds
  tied to their receipts, per-service revenue split exempt/taxable, and a day
  book by payment mode.

## Proposal

Two small additions, shippable in two slices, that keep every current
invariant: one Invoice per appointment (D025 untouched), immutable documents,
`orgId` on every row, Charges snapshotted from the catalog, and revenue by
category.

### Slice 1: Advance Receipt and patient credit

New tables and one ledger account:

- `advance_receipts`: `patientId`, optional `treatmentPlanId`, `method`,
  `amount`, `reference`, `receiptNumber` (own series, printed as **Advance
  Receipt**), `fiscalYear`, `businessDate`, `receivedBy`. Journal: Dr Cash/Bank,
  Cr **Patient Advances** (new liability system account, code 2200).
- `advance_allocations`: `advanceReceiptId`, `invoiceId`, `amount`. Journal:
  Dr Patient Advances, Cr Patient Receivables. Invoice balance becomes grand
  total minus Credit Notes minus Payments minus allocations.
- Refund of unused advance: `refunds` gains a source that is either a Credit
  Note or an Advance Receipt, printed as a Refund Voucher citing the advance.
  Journal: Dr Patient Advances, Cr Cash/Bank.

`payments` stays Invoice-only, so every existing query, receipt, and journal is
unchanged. Patient credit is derived: sum of advances minus allocations minus
advance refunds.

Desk flow: **Take advance** on the OPD Billing tab or the Patient record.
Settlement and Record payment show **Credit available ₹X** with an **Apply
credit** line capped at the outstanding balance. Daily Collections gains an
Advances column because the cash did arrive. Trial balance and balance sheet
pick up account 2200 with no code change.

This slice alone removes the workaround: the desk takes advances during the
course and picks the procedure as a service on the final sitting's walk-in,
where the existing quote and settlement apply the credit.

### Slice 2: Treatment Plan

- `treatment_plans`: `patientId`, `practitionerId`, `status`
  `open | completed | closed`, `closeReason`, `note`. The course carries no
  free-text title; its label ("Root canal treatment + Crown") is derived on
  the server from the item descriptions.
- `treatment_plan_items`: `treatmentPlanId`, `catalogItemId`, snapshotted
  description, tax, and `unitPrice` (the quoted price), `qtyPlanned`, `status`
  `open | done | dropped`, `dropReason`. Posted quantity is derived from
  Charges whose `sourceType = 'treatment_plan'` and `sourceId` is the item.
- `opd_appointments.treatmentPlanId`, nullable. A sitting is an ordinary OPD
  Appointment (walk-in or booked) linked to one plan, so the practitioner's
  time and token are registered as today and the follow-up fee ladder applies.
  "Sitting N" is the count of checked-in appointments on the plan.

Desk flow: the OPD record shows the linked plan's items. **Post to this
visit** (billing write) creates one Charge on this appointment from the item's
snapshot and advances `chargeRevision`, so the existing Billing tab prices and
settles it with credit. Adding a crown is adding an item to the open plan. A
physiotherapy course is one item with `qtyPlanned = 10`, posted one unit per
sitting. An abandoned root canal is the item marked `dropped` with a reason, a
partial-work catalog item posted to the last sitting if the doctor charges for
it, and the unused advance refunded.

Reports and worklists: **Open treatment plans** (last sitting date, planned
versus posted, credit held) surfaces stalled courses; **Advances held** lists
the liability by patient; the ledger shows advance received versus revenue
recognised directly.

### Decisions this raises

- **Quoted price below catalog.** OPD intake refuses a rate below the catalog
  price; a treatment plan is a doctor's quote and often is below it (package
  physiotherapy, negotiated RCT). Recommendation: the plan item price defaults
  to catalog, any change needs a note, and the Charge snapshots the plan price.
- **Consult fee on sittings.** Recommendation: keep the existing ladder and
  `omitConsultFee`; default omission for plan-linked walk-ins only if the pilot
  asks.
- **Permission key.** Recommendation: `treatment: create | read | update` for
  reception and administrator; posting a Charge and taking an advance stay
  under `billing: write`.

### Rejected

- Invoicing the whole course at the first sitting (the current workaround and
  Jane's package model): books revenue before delivery and needs a Credit Note
  when the patient stops.
- Splitting one procedure's price across sittings: invents prices the doctor
  never quoted and breaks the per-service revenue report.
- Frappe's Encounter → Service Request → Session layer: three billing paths
  and an order model HMS has no clinical author for yet (doctors sign paper).
- Instalment schedules, chair or bed booking, and a package entity: none is
  needed to remove the observed billing workaround. Each sitting is still a
  real OPD Appointment. That proves attendance and practitioner workload, but
  not physical-chair or therapy-bed utilisation. If double-booking or
  utilisation becomes an observed need, add an optional outpatient resource
  reservation to the appointment; do not put the resource on the Treatment
  plan and do not reuse an inpatient bed record.

## What this proves / does not prove

The references support a course parent, real attendance records, delivery-based
charges, and unearned credit. They also show why a package sale, clinical plan,
and payment schedule should not be one record. The two shared design
conversations reach the same separation, but are design inputs rather than
authoritative accounting sources.

They do not prove the correct GST classification of a crown, the earned
milestone for every RCT contract, or that every clinic needs physical-resource
scheduling. Notification 12/2017 exempts qualifying health care, but cosmetic
work and separately supplied goods need fact-specific review. CGST Rules 50 and
51 define required voucher particulars; the proposed schema does not yet store
all of them. Until the pilot CA approves classification and printed fields, HMS
must call the document **Advance Receipt**, not claim that it is a compliant
GST Receipt Voucher.

## What this means for HMS

The staged implementation spec has the correct core boundary and slice order:
ship Advance Receipts and credit allocation first, then Treatment plans linked
to ordinary OPD Appointments. Before Slice 1, add the CA-approved immutable
recipient, purpose, place-of-supply, rate, tax, and voucher fields that apply to
the clinic. Before physical-resource reporting, measure whether practitioner
appointments are an adequate proxy; if not, specify an OPD resource and actual
start/end times as a separate scheduling slice.

## Next falsification

Pilot the flow against three cases: an RCT abandoned after two sittings, a
ten-session physio course paid in three irregular receipts, and an RCT with a
crown accepted mid-course. Ask the clinic's CA to classify each supply and mark
the exact earning event. The model fails if staff must issue a future-service
Invoice to accept money, cannot reconcile cash to receipt date, or cannot show
which OPD attendance earned each Charge.

## Sources

- [Marley `develop` healthcare source](https://github.com/earthians/marley/tree/develop/healthcare)
  and [official documentation](https://marley.frappe.cloud/docs): `therapy_plan`, `therapy_session`,
  `therapy_plan_template`, `clinical_procedure`, `service_request`,
  `patient_encounter`, `treatment_counselling`; `healthcare/utils.py`
  `get_healthcare_services_to_invoice`, `set_invoiced`; issues #124, #181,
  #552, #793, #996; PR #526; release v16.1.1.
- Open Dental: [procedures over multiple appointments](https://www.opendental.com/manual/procsmultipleappts.html),
  [unearned/prepayment](https://www.opendental.com/manual/unearnedprepayment.html),
  and [treatment plans](https://www.opendental.com/manual/treatmentplan.html).
- Jane: [treatment plans](https://jane.app/guide/treatment-plans),
  [packages](https://jane.app/guide/setting-up-a-package), and
  [resources](https://jane.app/guide/advanced-scheduling-hub).
  Cliniko: [patient cases and account credit](https://help.cliniko.com/en/articles/6477363-tracking-packages-with-patient-cases-and-account-credit).
- CareStack: [treatment-plan phases and procedures](https://carestack.zendesk.com/hc/en-us/articles/25880123845780-Create-a-Treatment-Plan-Add-Treatments)
  and [unapplied credits](https://carestack.zendesk.com/hc/en-us/articles/34138439966100-Add-and-View-Unapplied-Credits).
- ADA 2024 claim form instructions item 24; AAE CDT 2026 guide multi-visit
  scenario.
- Odoo 17 Sales down payments; GNU Health Health Services; OpenMRS information
  model; Bahmni Odoo sales configuration.
- [MCA Ind AS 115](https://www.mca.gov.in/Ministry/pdf/IndAS115_2020_10112020.pdf),
  [CBIC Notification 12/2017 entry 74](https://cbic-gst.gov.in/hindi/pdf/central-tax-rate/Notification12-CGST.pdf),
  [CBIC Circular 32/06/2018-GST](https://cbic-gst.gov.in/pdf/circularno-32-cgst.pdf),
  and [CGST Rules 50 and 51](https://cbic-gst.gov.in/pdf/24092021-CGST-Rules-2017-Part-A-Rules.pdf).
- MoHFW minimum standards for [dental clinics](https://www.clinicalestablishments.mohfw.gov.in/sites/default/files/2022-06/833_0.pdf)
  and [physiotherapy centres](https://www.clinicalestablishments.mohfw.gov.in/sites/default/files/2023-03/718_2.pdf).
- Shared design inputs: [Design Dental Billing Workflow](https://chatgpt.com/share/6aa8218e-5144-83e8-bed8-88d18f8343e4)
  and [Dental billing design](https://chatgpt.com/share/6aa8219b-a32c-83ee-be58-4130b28957e6).
