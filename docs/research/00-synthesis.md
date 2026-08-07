# HMS Research Synthesis

Date: 2026-08-03. Sources: direct reads of DanpheEMR and Frappe Health repos, plus four scout
reports (agent://EmrRepoScout, agent://FrappeHealthScout, agent://AiWedgeScout,
agent://OssComparatorScout). Scout drift noted: EmrRepoScout and FrappeHealthScout produced
generic OSS-landscape reports; repo-specific findings below are from my own primary-source reads.

## 1. Reference products

### DanpheEMR (opensource-emr/hospital-management-emr)

- Enterprise HMS, live in **50+ hospitals in India, Nepal, Bangladesh**. Proof that this segment
  buys full HMS, not point tools.
- ~40 modules; headline ones: Registration/Patient, Appointment, Billing, Accounting, Inventory,
  Pharmacy, Laboratory, ADT (Admission/Discharge/Transfer), Nursing, Sub-store, Radiology,
  Medical Records, Emergency, Reporting/Dashboard, Doctors.
- Stack: .NET + Angular + SQL Server, IIS deployment, desktop-era UX. No AI anywhere.
- Takeaway: this module list is the "what a 20–150 bed hospital actually buys" checklist.
  Billing + pharmacy + lab are as load-bearing as clinical records.

### Frappe Health (frappe/health, now "Marley Health")

- HIS on Frappe/ERPNext, GPL-3, design explicitly **based on HL7 FHIR**.
- 130 DocTypes. Core clinical spine (FHIR-shaped): `patient`, `patient_appointment`,
  `patient_encounter`, `service_request`, `medication_request`, `observation` (+ components,
  reference ranges), `specimen`/`sample_collection`, `diagnostic_report`.
- Inpatient: `inpatient_record`, `inpatient_occupancy`, `healthcare_service_unit` (beds/wards as
  a facility tree), `nursing_task`, `discharge_summary`, `emergency_record`, `triage_level`.
- Money: `insurance_payor`, `patient_insurance_policy/coverage`, `insurance_claim`,
  `fee_validity`, `healthcare_payment_record` — but pharmacy stock, purchasing, accounting, HR
  are all delegated to ERPNext. A standalone HMS must decide what replaces that.
- **Has built-in ABDM integration** (`abdm_request`, `abdm_settings`) — India's national health
  stack is already table stakes in this segment.

## 2. Other open-source comparators

- **OpenMRS/Bahmni** — Java, modular, huge LMIC install base; O3 frontend uses module
  federation. Heavy, legacy stack; pattern donor only.
- **OpenEMR** — PHP; strongest interoperability story: FHIR R4, US Core, SMART on FHIR v2.2,
  OAuth2 scopes, multisite tenancy at the URL path (`/apis/{site}/fhir`). Pattern donor for API
  contracts.
- **CARE (ohcnetwork/care)** — Django/DRF, PostgreSQL, MIT, FHIR-R5-aligned, plugin
  architecture, India gov-scale deployments (TeleICU). The most modern OSS competitor in our
  target geography.
- **HospitalRun** — archived/dead.
- **Medplum** — TypeScript FHIR platform; closest stack-culture analog (TS + Postgres +
  FHIR-native API).

## 3. Domain-model convergence (what everyone independently agrees on)

Patient → Encounter/Visit (OPD, IPD, ER as encounter classes) → Orders (service_request:
lab/radiology/procedure; medication_request: drugs) → Results (observation, diagnostic_report)
→ Charges hanging off every orderable/performable → facility tree of Service Units (campus >
ward > room > bed). FHIR R4 resource names are the shared vocabulary across Frappe Health,
CARE, OpenEMR, Medplum. Deviating from this shape costs interop later for zero gain.

## 4. AI-native landscape

- **US, crowded:** ambient scribes (Abridge, Nabla — NEJM AI RCT shows real but modest note-time
  gains; Heidi), autonomous coding (Arintra: chart → ICD-10/CPT direct-to-billing),
  front-office/patient-access agents (Decoda "AI-native OS" for clinics, Shasta, Wattson),
  prior-auth automation (CMS-mandated SLAs driving demand).
- **AI-native EHR claims** (Decoda et al.): AI is in the write path — notes, coding, scheduling,
  billing drafted by AI and approved by staff — not a chatbot bolted onto a form-based system.
- **Emerging markets: effectively empty.** No AI-native full HMS targeting India/Nepal/SEA/Africa
  hospitals surfaced in any scan. DanpheEMR/Bahmni/CARE have zero ambient-AI capability.
  [INFERENCE: absence of evidence in scans, not proof of absence.]
- **ABDM (India)** creates both a compliance checklist and a wedge: ABHA patient IDs, HFR/HPR
  facility/practitioner registries, consent-mediated FHIR R4 record exchange (HIE-CM),
  scan-and-share OPD registration. Millions of linked records already; adoption is real.

## 5. Tensions to resolve in brainstorm

1. Scouts (US-evidence-weighted) recommend a wedge-only add-on product; user intent and
   emerging-market evidence (DanpheEMR's 50+ hospital installs) support a full HMS with an
   AI-native spine. These are different companies. → user decision.
2. Full HMS scope is enormous (Danphe: 40 modules). MVP must sequence: which modules are
   day-one, which are year-one, which never (delegate to integrations).
3. Pharmacy stock/accounting: build minimal, or integrate/defer (Frappe delegates to ERPNext)?
4. Regulatory target decides architecture: ABDM (consent-mediated, FHIR R4 IG) vs HIPAA
   (BAA, audit) vs none-yet.
