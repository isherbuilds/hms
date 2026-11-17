# IPD reference systems

Observed 2026-11-17. Six parallel scouts read source, manuals and issue trackers
for how running hospital systems handle inpatient admission, bed charging,
deposits and discharge. Conclusions promoted to the
[IPD spec](../specs/ipd-admission-to-discharge.md) and
[D066](../decisions.md#d066--bed-days-are-derived-bills-repeat-and-a-wrong-discharge-can-be-undone).

Evidence tags: **source** (code read at a pinned commit), **docs** (official
manual), **community** (issue or forum), **inferred**. No race was reproduced at
runtime; every concurrency finding is read from code.

## Systems read

| System                                   | Pinned at                          | Read for                                                                    |
| ---------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------- |
| Marley Health (`earthians/marley`)       | `7bb34f56`, v16.8.0                | Inpatient Record, occupancy billing, discharge checks, medication, deposits |
| OpenMRS bed management, emrapi, O3 wards | `9c0af0fe`, `7eeb85de`, `f2e9fb87` | Bed assignment, admit/transfer/discharge encounters, ward app               |
| Bahmni (bahmniapps, IPD, Odoo modules)   | `4aced91d`, `49a502b1`, `f1691c9a` | ADT, bed sharing, IPD medication record, billing through Odoo               |
| Danphe EMR                               | `9963822`                          | Deposits, provisional bills, discharge billing, parameters                  |
| Care (`ohcnetwork/care`)                 | `782d511a`                         | Location and encounter model, bed association, charge items                 |
| GNU Health, Open Hospital                | current default branches           | Inpatient registration, bed states, discharge types, bills                  |
| Indian hospital tariffs and rules        | six published hospital policies    | Day boundaries, transfer days, deposits, GST, discharge                     |

`frappe/health` resolves to `earthians/marley`. OpenEMR has no ward, bed or
admission tables and HospitalRun is archived; neither is a reference for IPD.

## Findings

### Integrity

- No system read protects a bed with a database constraint. Marley reads a
  cached `Vacant/Occupied` flag and writes with no lock
  ([source](https://github.com/earthians/marley/blob/7bb34f56a4178f51cd726b7b8d82c2abca08ba8b/healthcare/healthcare/doctype/inpatient_record/inpatient_record.py#L626-L654));
  OpenMRS `assignPatientToBed` never checks occupancy and Bahmni allows three
  patients per bed by default; Danphe sets a boolean and carries on; Care takes
  a Redis lock released before commit and has duplicate-active-bed reports
  ([community](https://github.com/ohcnetwork/care/issues/2370)).
- A stored bed status drifts. Marley's flag is reset by saving the bed master,
  and an early version freed the bed at "Order Discharge"
  ([community](https://github.com/earthians/marley/issues/1141)). Care's
  dashboard "Reserved" count was always zero
  ([community](https://github.com/ohcnetwork/care_fe/issues/15864)).
- Marley's duplicate-admission check covers `Admitted` and `Admission Scheduled`
  but not `Discharge Scheduled`, so a patient awaiting discharge can be admitted
  again (source, same file `#L100-L116`).
- OpenMRS O3 and Bahmni admit in two browser calls (encounter, then bed). A
  failed second call leaves a patient admitted with no bed; a 2026 Bahmni fork
  pull request asks for one transactional endpoint.

### Bed charging

- Nobody computes calendar bed days the same way, and several compute none.
  Marley bills `hours / no_of_hours` with a minimum quantity, no checkout time,
  and two modes that disagree for the same stay (source, `utils.py#L482-L578`).
  OpenMRS, Bahmni, Care, GNU Health and Open Hospital compute nothing; staff
  type a quantity. Danphe carries three formulas (24-hour blocks, calendar-date
  difference, midnight census) plus three parameters.
- Every published Indian policy that states a boundary uses a calendar one
  (11:00, noon or midnight), never rolling 24 hours. Four of six add a half-day
  band on the discharge day
  ([Kokilaben](https://www.kokilabenhospital.com/patients/admission.html),
  [Sir Ganga Ram](https://sgrh.com/important-information-for-patients-and-attendants),
  [Woodlands](https://www.woodlandshospital.in/billing)). All six are large
  metro hospitals; none has 10–50 beds.
- No system and no tariff read splits a transfer day by time occupied.
  Woodlands charges the bed occupied the most hours that day; others decide by
  the direction of the class change; Danphe uses the bed at midnight.
- Marley forces invoicing before discharge, measures an open stay to "now" and
  marks it invoiced, so hours between the invoice and departure are never
  billed. Implementers switch the gate off.
- Separate recurring lines beside the room (nursing, duty doctor, monitor) are
  standard: the insurer-standard final bill has distinct heads
  ([docs](https://safewaytpa.in/documents/13_STANDARD_FINAL_BILL%20FORMAT.pdf)),
  Danphe has per-day items including a percentage of room rent, and a Marley
  request for daily automatic room, nursing and oxygen charges has been open
  since 2023 ([community](https://github.com/earthians/marley/issues/181)).

### Money

- Marley, Bahmni and Danphe hold deposits per patient, not per stay. Marley
  allocates any customer advance to any invoice; Bahmni applies payments to the
  oldest invoice; Danphe sums per patient in one check and per visit in others.
- Marley has no provisional bill; its only interim bill is a real partial
  invoice. Danphe's provisional items are editable in place and the server
  trusts client totals.
- Danphe added "provisional discharge" in August 2023: release the bed with no
  financial effect, settle later. Its original design released the bed inside
  the billing call.
- Marley's default medication path moves stock on issue and bills from the
  doctor's prescription, so issued medicine goes unbilled unless ordered through
  an encounter
  ([community](https://discuss.frappe.io/t/how-to-bill-medications-in-inpatient-record/162677)).
  GNU Health and Open Hospital ward issues create no bill line either.
- No system read has inpatient packages with inclusion limits. Marley's
  "Treatment Counselling" is a priced pre-admission estimate with a deposit
  request.
- Large hospitals price visits, investigations and surgery by bed category
  ([Manipal tariff](https://www.manipalhospitals.com/jayanagar/uploads/pdf/SCHEDULE_OF_INPATIENT_TARIFF_WITH_EFFECTIVE_FROM_Jayanagar.pdf)).
  Evidence at 10–50 beds is thin.

### Lifecycle

- A wrong-patient discharge happens everywhere. Marley users filed it as urgent
  and got a confirmation dialog
  ([community](https://github.com/earthians/marley/issues/1253)); Bahmni ships
  Undo Discharge, which does not give the bed back; Danphe reverses with a full
  credit note and re-occupies the bed unchecked; Open Hospital clears the
  discharge date.
- Discharge type is core everywhere except Marley: OpenMRS dispositions, GNU
  Health `home / transfer / death / against_advice`, Open Hospital
  `NORMAL DISCHARGE / REFERRED / DEAD / ESCAPE`. None lists absconded and
  against-advice together, which Indian registers need.
- Open Hospital and GNU Health give every admission a register number; Open
  Hospital requires an admission diagnosis and a discharge diagnosis.
- O3's maternal ward puts a newborn in the mother's bed as a linked patient.

### Clinical boundary

- Bahmni's digital medication record needed doctor order entry, nurse-set
  schedules, shift configuration, four background jobs and a funded partner
  rollout. Marley's best stock idea (bill at administration, return leftovers
  with no credit note) also depends on an electronic medication record.
- In a 1,000-patient study at one north-Indian teaching hospital
  ([Sharma et al., IJCMPH 2025](https://www.ijcmph.com/index.php/ijcmph/article/download/14327/8619/71272)),
  77% of patients waited a mean of 235 minutes for the discharge summary; 37%
  paid cash and Ayushman Bharat clearance averaged 436 minutes.

## Limits

- Indian practice rests on six large metro hospitals, press coverage for
  insurer timelines, and the hospital edition of NABH. No government system
  manual was retrievable.
- The ₹2 lakh cash limit is quoted by Sir Ganga Ram (₹1,99,000), Hinduja
  (₹1,99,999 from 1 April 2017) and Manipal; its legal basis (believed to be
  Income Tax Act s.269ST) was not checked.
- Whether a separate nursing line counts toward the ₹5,000 room-rent GST
  threshold is unresolved and needs a tax adviser.
- Danphe ships a database backup that appears to hold real hospital data. It
  was read for table and parameter names only and is not retained.

## Sources

- Marley: [inpatient_record.py](https://github.com/earthians/marley/blob/7bb34f56a4178f51cd726b7b8d82c2abca08ba8b/healthcare/healthcare/doctype/inpatient_record/inpatient_record.py),
  [utils.py](https://github.com/earthians/marley/blob/7bb34f56a4178f51cd726b7b8d82c2abca08ba8b/healthcare/healthcare/utils.py),
  [Inpatient ADT manual](https://marleyhealth.io/docs/v13/user/manual/en/healthcare/inpatient_adt)
- OpenMRS: [bed management](https://github.com/openmrs/openmrs-module-bedmanagement/tree/9c0af0fe38cbbeb34bebee0938393d4f84bddbd0),
  [emrapi](https://github.com/openmrs/openmrs-module-emrapi/tree/7eeb85de82162208f007b18e9c01f4308527ae64),
  [O3 patient management](https://github.com/openmrs/openmrs-esm-patient-management/tree/f2e9fb87d44fe82ef6d8a7cacac3c9f1204edafb)
- Bahmni: [bahmniapps](https://github.com/Bahmni/openmrs-module-bahmniapps/tree/4aced91d7568c3d68f1cbfe6bda4a6bdf39da62b),
  [IPD module](https://github.com/Bahmni/openmrs-module-ipd/tree/49a502b14c96a9c5cd1d84d191c63f08f14ee782),
  [IPD dashboard](https://bahmni.atlassian.net/wiki/spaces/BAH/pages/3719102466/IPD+Dashboard)
- Danphe: [repository at 9963822](https://github.com/opensource-emr/hospital-management-emr/tree/9963822)
- Care: [repository at 782d511a](https://github.com/ohcnetwork/care/tree/782d511a38fcf164a5eca79c03eed73ad29828ee)
- Standards: [FHIR Encounter](https://hl7.org/fhir/R4/encounter.html),
  [discharge disposition](https://hl7.org/fhir/R4/valueset-encounter-discharge-disposition.html),
  [HL7 v2 event types](https://hl7.org/fhir/R4/v2/0003/index.html)
- India: [Notification 03/2022 entry 31A](https://gstcouncil.gov.in/sites/default/files/2024-05/03_2022-ctr-eng_1.pdf),
  [NABH hospital standard, 6th edition](https://portal.nabh.co/images/Standards/NABH%20Hospital%20Accreditation%20Standard%206th%20Edition%20January%202025.pdf),
  [NHA package guidelines](https://nha.gov.in/strapi/uploads/User_guidelines_for_HBP_2_2_6d2bc0412a.pdf)
