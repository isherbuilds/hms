# OPD reference flows and the direct-service question

Consolidates two memos (OPD/IPD reference flows, 2026-08-24; OPD direct services
and departmental billing, 2026-08-25). Their adopted conclusions are promoted
into [Product](../product.md), [OPD](../opd.md), D013, D019 and D024. What
survives here is the **territory map for domains not yet gated open** and the
pins behind it.

## Pins

- Marley `develop` @ `e24bc491` (2026-08-19, v17.0.0-dev), release v16.5.2;
  Frappe @ `5003fc56`; `earthians/marley_frontend` @ `387570b9`.
- OpenMRS `openmrs-esm-patient-management` main @ `29696858` (v11.1.0);
  `esm-core` main @ `9f0c6aa8`; `openmrs-esm-billing-app` @ `fdd1b56b`; bed
  module @ `6d4b70bf`; EMR API @ `f644b9cb`; billing module @ `dc7d246`.

Both references were **weaker than HMS** on duplicate-patient defense (neither
has meaningful defense at registration) and on billing atomicity (both settle
through separate invoice and payment documents; D015's single transaction is
tighter). Their draft-protection and concurrency patterns have since landed in
HMS. That is why the day-view, registration and settlement comparisons are gone
from this memo — they were promoted and are now product behavior.

## What OPD actually means

**OPD is an outpatient care setting, not a synonym for a doctor consultation and
not an accounting department.** WHO defines an outpatient as someone using
diagnostic or therapeutic services without occupying a bed; India's DGHS says an
OPD provides promotive, diagnostic, curative, rehabilitative and palliative
services. Those definitions include outpatient diagnostics — but they do **not**
require the consultation desk to operate every laboratory or radiology workflow.

D024 has since answered the operational half of that: an OPD attendance carries
consultation and procedure charges only. A patient arriving for a test is a
future direct-service flow owned by the performing department, not a fake
consultation at the OPD desk.

Call a procedure an **OPD Procedure** only when the OPD team owns and performs
it. The word _procedure_ alone does not establish its department or care
setting; work performed by Radiology, OT, Lab or Nursing keeps that unit as
performing department.

## The unbuilt direct-service hypothesis

If the pilot validates ownership and payment timing, the candidate flow is:

```text
find/register Patient → select service(s) → create the clinical request
  → invoice/collect → route to the owning department
```

This is a hypothesis for a future vertical slice, not an accepted decision.
Lab and radiology remain evidence-gated in Product until the pilot supplies a
named clinical owner and an approved order/result boundary. Do not build a
results module from this memo.

**This interacts with an open decision.** D025 asks whether invoice granularity
stays one document per appointment or becomes one per revenue stream. The
direct-service model assumes line-level revenue attribution over a shared
document backbone; D024 currently forbids the mixed document that would test it.
Settle D025 before the first non-OPD invoice exists.

## IPD territory (roadmap only)

- **Marley:** Inpatient Record lifecycle `Admission Scheduled → Admitted →
Discharge Scheduled → Discharged/Cancelled`. Wards are a service-unit tree
  with leaf occupancy; stays bill from occupancy child rows (hours ×
  service-unit-type rate). Nursing-task checklists can gate admit/discharge, and
  discharge blocks on unbilled work. Notably **no dedicated bed board** — a
  doctype tree view not even linked from the IPD sidebar — plus schema/UI drift
  (`discharge_ordered_datetime` sent but absent from schema) and beta
  duplication (Medication Request vs IMO/IME).
- **OpenMRS:** the ward app renders bed cards plus an unassigned list; the
  awaiting-admission "queue" is **derived** from disposition observations via
  HQL, not a queue table. ADT is admission/transfer/discharge encounters. The
  bed module is a plain assignment table (AVAILABLE/OCCUPIED, no optimistic
  locking, bed sharing allowed). Officially "IPD Support V1 active" with open
  crash PRs; admission plus bed assignment is two non-atomic writes.

**The lesson, not the design:** both mature projects ship IPD half-built, and
both leave the bed-assignment write unprotected. HMS's tenancy and money rules
would not accept either. This is an inventory, not a build permit.

## Still rejected

Multi-stop token journeys, WebSocket displays, a command palette without
measured pilot need, and separate bill/invoice/payment screens for OPD.

## Falsification

Walk three prototype entry models with the pilot receptionist, cashier, lab
owner and accountant across five real cases: consultation→CBC, direct CBC,
direct X-ray, OPD dressing, and a mixed Lab+Radiology invoice. Ask who
registers, who orders, whether payment gates service, which counter collects,
and which department must receive revenue credit. **Reject the direct-service
flow** if staff cannot assign a responsible requester and department without
inventing data, or if the accountant requires legally separate documents rather
than line-level allocation. Separately, measure the duplicate-patient rate in
pilot data once volume exists.

## Sources

- [WHO outpatient definition](https://gateway.euro.who.int/en/indicators/hfa_543-6300-outpatient-contacts-per-person-per-year/)
- [DGHS hospital manual, OPD chapter](https://dghs.mohfw.gov.in/uploads/assets/b9gSYbHAzy9pIrF74o1Aw7bvw91KW9Axd5wrlqPd.pdf)
- [IPHS district-hospital guidelines 2022](https://www.nhm.gov.in/images/pdf/guidelines/iphs/iphs-revised-guidlines-2022/01-SDH_DH_IPHS_Guidelines-2022.pdf)
- [Marley Health v16.5.2](https://github.com/earthians/marley/releases/tag/v16.5.2)
  and its [Service Request schema](https://github.com/earthians/marley/blob/v16.5.2/healthcare/healthcare/doctype/service_request/service_request.json)
- [OpenMRS Information Model](https://openmrs.atlassian.net/wiki/spaces/docs/pages/515899478/OpenMRS%2BInformation%2BModel),
  [OpenMRS Billing @ dc7d246](https://github.com/openmrs/openmrs-module-billing/tree/dc7d24615afc5c4adc62dcc9110bdff7dcc7c7cf)
- o3-docs.openmrs.org, rest.openmrs.org, openmrs.atlassian.net IPD squad pages,
  docs.frappe.io. Per-claim `file:line` citations resolve against the pins above
  and against the superseded memos in Git history.
