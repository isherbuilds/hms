# OPD, direct services, and departmental billing

## Question

What does **OPD** mean when a patient may attend for a consultation, laboratory
test, radiology study, or procedure; and how do Marley Health and OpenMRS model
direct-service arrivals, fulfillment, billing, and departmental revenue?

## Answer

**OPD is an outpatient care setting or attendance umbrella, not a synonym for a
doctor consultation and not an accounting department.** WHO defines an
outpatient as someone using diagnostic or therapeutic services without occupying
a regular hospital bed, while India's Directorate General of Health Services says
an OPD provides promotive, diagnostic, curative, rehabilitative, and palliative
services. Those definitions include outpatient procedures and diagnostics, but
they do not require every laboratory or radiology workflow to be operated by the
consultation desk. ([WHO outpatient definition](https://gateway.euro.who.int/en/indicators/hfa_543-6300-outpatient-contacts-per-person-per-year/),
[DGHS hospital manual, OPD chapter](https://dghs.mohfw.gov.in/uploads/assets/b9gSYbHAzy9pIrF74o1Aw7bvw91KW9Axd5wrlqPd.pdf))

The decision-ready model is therefore:

```text
Outpatient attendance
├─ consultation → OPD clinical workflow
├─ direct lab request → Lab worklist
├─ direct imaging request → Radiology worklist
└─ direct/minor procedure request → owning procedure worklist

Every billable line → one shared billing system
                    → revenue attributed by service/performing department
```

A patient who arrives knowing the required test or procedure should be found or
registered, given a direct service request/attendance, billed through the shared
financial system, and routed to the performing department. A fake consultation
is unnecessary. A procedure belongs to “OPD Procedures” only when the OPD team
actually owns and performs it; the word _procedure_ alone does not establish its
department or care setting. This conclusion is an inference from the cited
definitions and both reference architectures, not a quoted universal hospital
rule.

## Evidence

### Definition and operating boundary

- WHO's current indicator metadata defines an outpatient as a person using a
  diagnostic or therapeutic service without occupying a regular hospital bed.
  The same page distinguishes an _outpatient contact_ metric from visits made
  only for prescribed tests or scheduled treatment, demonstrating that outpatient
  care is broader than the consultation-counting metric.
  ([WHO European Health Information Gateway](https://gateway.euro.who.int/en/indicators/hfa_543-6300-outpatient-contacts-per-person-per-year/))
- India's DGHS hospital manual describes OPD services as promotive, diagnostic,
  curative, rehabilitative, and palliative. It treats OPD as a hospital wing with
  accessible services across disciplines, rather than defining it as consultation
  billing alone.
  ([DGHS hospital manual, chapter 2](https://dghs.mohfw.gov.in/uploads/assets/b9gSYbHAzy9pIrF74o1Aw7bvw91KW9Axd5wrlqPd.pdf))
- India's 2022 district-hospital standards separately resource laboratory,
  pharmacy, ECG/Echo, radiology, and OT personnel and performance. This proves
  that outpatient diagnostics may have distinct operational departments even
  when they serve outpatients.
  ([IPHS Sub-District and District Hospital Guidelines 2022](https://www.nhm.gov.in/images/pdf/guidelines/iphs/iphs-revised-guidlines-2022/01-SDH_DH_IPHS_Guidelines-2022.pdf))

### Marley Health v16.5.2

- Marley Health is the `earthians/marley` Frappe/ERPNext-based HIS. Its feature
  inventory separates outpatient/inpatient management, clinical procedures, and
  laboratory management, and maps facilities to Healthcare Service Units and
  specialties to Medical Departments.
  ([repository README](https://github.com/earthians/marley),
  [v16.5.2 release](https://github.com/earthians/marley/releases/tag/v16.5.2))
- Marley does not use one `OPD` record. It separates Patient Appointment, Patient
  Encounter, Service Request, fulfillment records, and ERPNext Sales Invoice. A
  Patient Encounter may originate from an appointment or be created directly for
  a patient.
  ([Patient Encounter documentation](https://marley.frappe.cloud/wiki/docs/patient_encounter))
- In v16.5.2, Service Request supports `Direct`, `Referral`, and `External
Referral`, carries Patient, practitioner, Medical Department, requested
  template, quantity, patient-care type, status, and billing status, and does not
  require an appointment or encounter.
  ([Service Request schema](https://github.com/earthians/marley/blob/v16.5.2/healthcare/healthcare/doctype/service_request/service_request.json))
- The same Service Request can create a Lab Test, Observation/sample collection,
  Clinical Procedure, Therapy Session, or Patient Appointment. An appointment is
  therefore additive when scheduling is needed, not the mandatory parent of
  every direct service.
  ([Service Request implementation](https://github.com/earthians/marley/blob/v16.5.2/healthcare/healthcare/doctype/service_request/service_request.py),
  [Patient Appointment schema](https://github.com/earthians/marley/blob/v16.5.2/healthcare/healthcare/doctype/patient_appointment/patient_appointment.json))
- Clinical Procedure Templates carry Medical Department, patient-care type,
  billable item/rate, consumables, and optional sample collection. This directly
  disproves the idea that every procedure is inherently an OPD consultation
  charge.
  ([Clinical Procedure Template documentation](https://marleyhealth.io/docs/v13/user/manual/en/healthcare/clinical_procedure_template),
  [v16.5.2 schema](https://github.com/earthians/marley/blob/v16.5.2/healthcare/healthcare/doctype/clinical_procedure_template/clinical_procedure_template.json))
- Marley uses ERPNext Sales Invoice as one billing backbone and retrieves pending
  billable healthcare services for a patient while retaining source references on
  invoice lines.
  ([healthcare billing utilities](https://github.com/earthians/marley/blob/v16.5.2/healthcare/healthcare/utils.py#L31),
  [Sales Invoice integration](https://github.com/earthians/marley/blob/v16.5.2/healthcare/healthcare/custom_doctype/sales_invoice.py))

### OpenMRS current source, August 2026

- OpenMRS defines a Visit as a period of interaction containing finer-grained
  Encounters. Its outpatient example contains registration, consultation, and
  dispensing encounters within one Outpatient Visit. An Encounter can represent
  a doctor visit, laboratory test, dispensing, or another point interaction.
  ([OpenMRS Information Model, updated 2025-07-04](https://openmrs.atlassian.net/wiki/spaces/docs/pages/515899478/OpenMRS%2BInformation%2BModel),
  [`Visit` source at `6e77bfd`](https://github.com/openmrs/openmrs-core/blob/6e77bfd03ab134fc7d66a0e3140d6e468f569ec5/api/src/main/java/org/openmrs/Visit.java),
  [`Encounter` source at `6e77bfd`](https://github.com/openmrs/openmrs-core/blob/6e77bfd03ab134fc7d66a0e3140d6e468f569ec5/api/src/main/java/org/openmrs/Encounter.java))
- OpenMRS metadata explicitly supports lab, drug, radiology, and procedure order
  types and encounter types for outpatient, lab, immunization, and other
  interactions. A core Order requires a Patient, Order Type, Concept, and
  Encounter; the Encounter may belong to a Visit.
  ([metadata configuration](https://openmrs.atlassian.net/wiki/spaces/docs/pages/329580577),
  [`Order` source at `6e77bfd`](https://github.com/openmrs/openmrs-core/blob/6e77bfd03ab134fc7d66a0e3140d6e468f569ec5/api/src/main/java/org/openmrs/Order.java))
- OpenMRS Locations can represent hospitals, outpatient clinics, laboratories,
  surgery, emergency departments, and wards, with parent/child hierarchy. A
  patient can therefore move through OPD, Lab, and Radiology locations without
  acquiring separate identities or accounts.
  ([OpenMRS Information Model](https://openmrs.atlassian.net/wiki/spaces/docs/pages/515899478/OpenMRS%2BInformation%2BModel),
  [`Location` source at `6e77bfd`](https://github.com/openmrs/openmrs-core/blob/6e77bfd03ab134fc7d66a0e3140d6e468f569ec5/api/src/main/java/org/openmrs/Location.java))
- The O3 patient chart owns order entry, while the separate laboratory application
  owns request queues and fulfillment. OpenMRS's 2026 improvement brief explicitly
  describes the Orders App creating requests and the Lab App fulfilling them.
  ([patient chart](https://github.com/openmrs/openmrs-esm-patient-chart),
  [Lab v1.5.1](https://github.com/openmrs/openmrs-esm-laboratory-app/tree/v1.5.1),
  [2026 Orders/Lab brief](https://openmrs.atlassian.net/wiki/spaces/projects/pages/735772680/Orders%2BApp%2Band%2BLab%2BApp%2BImprovements%2B2026))
- OpenMRS Billing 2.5.0-SNAPSHOT keeps one Bill with multiple lines. Bill lines
  can retain the originating Order; services carry category/type; cashier items
  carry department attribution; and a Bill can optionally reference a Visit.
  ([billing module at `dc7d246`](https://github.com/openmrs/openmrs-module-billing/tree/dc7d24615afc5c4adc62dcc9110bdff7dcc7c7cf),
  [`Bill`](https://github.com/openmrs/openmrs-module-billing/blob/dc7d24615afc5c4adc62dcc9110bdff7dcc7c7cf/api/src/main/java/org/openmrs/module/billing/api/model/Bill.java),
  [`BillLineItem`](https://github.com/openmrs/openmrs-module-billing/blob/dc7d24615afc5c4adc62dcc9110bdff7dcc7c7cf/api/src/main/java/org/openmrs/module/billing/api/model/BillLineItem.java),
  [Liquibase schema](https://github.com/openmrs/openmrs-module-billing/blob/dc7d24615afc5c4adc62dcc9110bdff7dcc7c7cf/omod/src/main/resources/liquibase.xml))
- OpenMRS also allows manual service billing from the Patient Chart even when no
  Visit is explicitly created; its Bill-to-Visit relation is nullable. Requiring
  a direct-service attendance in HMS would therefore be our workflow decision,
  not an OpenMRS invariant.
  ([O3 Billing 1.3.1 patient-chart E2E at `dded0073`](https://github.com/openmrs/openmrs-esm-billing-app/blob/dded00733fdfb886bc1261d7e9db1aa0885de335/e2e/specs/billing-patient-chart.spec.ts),
  [`Bill` model](https://github.com/openmrs/openmrs-module-billing/blob/dc7d24615afc5c4adc62dcc9110bdff7dcc7c7cf/api/src/main/java/org/openmrs/module/billing/api/model/Bill.java))

### Current HMS

- HMS currently defines OPD as one scheduled or walk-in outpatient attendance
  and Billing as the organization-wide Charge/Invoice worklist.
  ([product language](../product.md#language-and-boundaries))
- One OPD Appointment currently parents the Patient link, queue lifecycle,
  Charges, Invoices, and prescription attachments; HMS deliberately has no
  generic Visit/Encounter wrapper.
  ([architecture](../architecture.md#domain-boundary))
- Intake already permits `procedure | lab | radiology | other` services and says
  explicitly that a billing line is not proof of ordering, performance, or a
  result.
  ([OPD desk lifecycle](../specs/opd-desk-lifecycle.md#unchanged-by-this-spec))
- The ledger already posts consultation, procedure, lab, and radiology lines to
  separate revenue accounts by catalog category. Mixed services on one invoice
  therefore do not erase category-level sales attribution.
  ([`revenueAccountFor`](../../packages/api/src/lib/ledger.ts#L83),
  [system revenue accounts](../../packages/api/src/lib/ledger.ts#L45))
- Intake and post-consultation charge capture already use the same bounded
  `catalog.searchServices` backend procedure, although their frontend combobox
  plumbing is duplicated.
  ([intake service search](../../apps/web/src/components/opd-intake-services.tsx#L84),
  [billing charge search](../../apps/web/src/components/opd-billing/charge-dialogs.tsx#L49))

## What this proves / does not prove

This proves that neither OPD nor a separate departmental invoice is required to
represent direct diagnostics. Both reference systems separate the clinical
request/fulfillment concern from a shared financial backbone, and both carry
service or department metadata into billing.

It does **not** prove one universal receptionist screen. Marley does not document
a polished direct-service intake UI, and its documentation mixes v13 legacy
invoice-triggered flows with v15/v16 Service Requests. OpenMRS supports both
order-driven billing and manual patient-chart billing. Neither system proves the
pilot hospital's preferred counter ownership or payment-before-service policy.

It also does not prove automatic department-to-cost-centre accounting in Marley.
The v16.5.2 Medical Department schema has no demonstrated automatic mapping to
an ERPNext Cost Center or Income Account. OpenMRS exposes department attribution,
but its configurable reports do not establish HMS's accounting policy.
([Marley Medical Department schema](https://github.com/earthians/marley/blob/v16.5.2/healthcare/healthcare/doctype/medical_department/medical_department.json),
[OpenMRS billing schema](https://github.com/openmrs/openmrs-module-billing/blob/dc7d24615afc5c4adc62dcc9110bdff7dcc7c7cf/omod/src/main/resources/liquibase.xml))

## What this means for us

1. Keep **OPD** as familiar staff language for the consultation/day-register
   surface, while defining it accurately as outpatient attendance rather than
   consultation revenue. This preserves the current product vocabulary without
   making OPD the owner of every outpatient department.
2. A patient arriving for a known CBC, X-ray, dressing, injection, or other
   service should use **New direct service**: find/register Patient → select
   service(s) → create the clinical request/attendance → invoice/collect → route
   to the owning department. This is the recommended HMS decision, not a claim
   that OpenMRS requires it.
3. Keep one Billing module and one invoice/payment/ledger backbone. Attribute
   each charge line to service category now and to performing department/cost
   centre if the pilot needs finer attribution. A single invoice may legitimately
   contain Lab and Radiology lines while posting each line to its own revenue
   account.
4. Call a procedure **OPD Procedure** only when the OPD team owns it. Procedures
   performed by Radiology, OT, Lab, Nursing, or another unit retain that unit as
   performing department. Scheduling is additive only when a practitioner,
   room, equipment, or time slot must be reserved.
5. Do not implement a lab/radiology results module from this research alone. The
   roadmap still requires a named clinical owner and an approved order/result
   boundary.

## Next falsification

Walk three prototype entry models with the pilot receptionist, cashier, lab
owner, and accountant using five real cases: consultation→CBC, direct CBC,
direct X-ray, OPD dressing, and a mixed Lab+Radiology invoice. Ask who registers,
who orders, whether payment gates service, which counter collects, and which
department must receive revenue credit. Reject the proposed direct-service flow
if staff cannot assign a responsible requester/department without inventing data,
or if the accountant requires legally separate documents rather than line-level
revenue allocation.

## Sources

- [WHO outpatient definition](https://gateway.euro.who.int/en/indicators/hfa_543-6300-outpatient-contacts-per-person-per-year/)
- [DGHS hospital manual, OPD chapter](https://dghs.mohfw.gov.in/uploads/assets/b9gSYbHAzy9pIrF74o1Aw7bvw91KW9Axd5wrlqPd.pdf)
- [IPHS district-hospital guidelines 2022](https://www.nhm.gov.in/images/pdf/guidelines/iphs/iphs-revised-guidlines-2022/01-SDH_DH_IPHS_Guidelines-2022.pdf)
- [Marley Health v16.5.2](https://github.com/earthians/marley/releases/tag/v16.5.2)
- [Marley Service Request schema](https://github.com/earthians/marley/blob/v16.5.2/healthcare/healthcare/doctype/service_request/service_request.json)
- [OpenMRS Information Model](https://openmrs.atlassian.net/wiki/spaces/docs/pages/515899478/OpenMRS%2BInformation%2BModel)
- [OpenMRS Billing at `dc7d246`](https://github.com/openmrs/openmrs-module-billing/tree/dc7d24615afc5c4adc62dcc9110bdff7dcc7c7cf)
