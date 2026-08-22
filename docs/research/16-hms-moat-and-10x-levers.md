# Is there a moat left in HMS — and what would a 10x change be?

Date: 2026-08-22. Branch: external (competitor source audit + India regulatory rails) combined with
internal recon of this repo. Status: **research input, not an accepted decision.** Nothing here
authorizes a route, table, permission, or navigation entry. Roadmap triggers in
[`02-roadmap-decisions.md`](../02-roadmap-decisions.md) still govern.

Prompted by two vendor-training corpora the user supplied: the Frappe School _Healthcare
Management_ course (7 videos) and the AlmightyCS _Odoo HMS_ walkthrough series (17 videos). Those
are the "what does the incumbent teach you to do" evidence; everything else below is primary.

Extends [`00-synthesis.md`](00-synthesis.md), which reached the same domain-model conclusion from
repo reads in 2026-08-03. This document does not revisit the domain model. It asks the different
question: **given that the feature surface is commodity, what is actually defensible?**

## Question

The full HMS feature surface is available free (Marley/ERPNext) or cheap (AlmightyCS's 80+ Odoo
modules). Is there any moat left to build an HMS — and if so, what change to this repo would be
worth 10x rather than 10%?

## Answer (lead)

**Yes, four moats, none of them features.** In descending order of how hard they are to copy:

1. **Real multi-tenancy, which nobody in this segment has** — and which ABDM's own architecture
   silently rewards. Marley's isolation boundary is one database per hospital; it registers **zero**
   row-level scoping and ships a publicly-reported, still-open authorization hole across ~162
   endpoints. This repo's `orgId`-on-every-row spine is the expensive thing, and it is already built.
2. **Compliance as a shipped capability, not a services engagement.** India's notified EHR Standards
   require audit logging of **reads**, lifetime retention, and cryptographic signatures. NABH now
   certifies _software_, gated on an ABDM M3 certificate. These are checklists the incumbents fail,
   and they convert into procurement requirements rather than feature bullets.
3. **Credible data portability — the thing the market is loudest and angriest about.** The top-recurring
   complaint across Indian doctor-facing EMR reviews is not features or price, it is being held
   hostage: _"Data belongs to the doctor who bought your license"_, _"I am forced to stick to this
   software due to extensive patient data stored on it, and I Hate it!"_ An export a doctor can
   actually leave with is a wedge no incumbent will copy, because **lock-in is their retention
   strategy**.
4. **Time-to-first-invoice.** Marley cannot bill a consultation until ERPNext has a Company, Chart of
   Accounts, Customer Group, Territory and Price List. That is a structural onboarding tax it cannot
   remove, because billing is welded to `Sales Invoice`.

**What is not a moat:** module count, clinical breadth, specialty coverage, AI chat. Do not race there.

**Two findings that reframe the question.**

**The market's binding constraint is 1.5–2.3 minutes.** That is the pooled Indian consultation length
across 28.5 million consultations (Irving et al., BMJ Open 2017). The incumbent asks a doctor to fill a
**58-field form across 12 tabs** inside that window. This is not a UX complaint — it means **the
doctor-facing structured EMR is the wrong product for this market**, and the repo's existing
paper-first decision is not a pilot compromise but the correct long-run shape. It also means the
users whose time the software can actually save are **reception, cashier and administrator**, which is
exactly where this repo's live scope already sits.

**ABDM is architected for a multi-tenant vendor.** NHA separates a **Bridge ID** (identifies _your
software_) from a **Service ID** (identifies _one facility_), one bridge serving many services. Marley,
being one-database-per-site, cannot exploit the shape its own country's regulator designed. This repo
can.

---

## Evidence

### A. The incumbent is weaker than its feature list suggests

All repo claims pinned to `earthians/marley` @ `e24bc491` (develop, 2026-08-19, `__version__ = 17.0.0-dev`);
stable tags v16.5.2 and v15.2.3 (both 2026-08-13).

**A1. Frappe no longer owns or maintains it.** `github.com/frappe/health` 301-redirects to
`github.com/earthians/marley`. Rebrand commit `0fc0e5fc` (2024-07-18). Frappe's Nabin Hait, first-party:
_"As no one from Frappe was actively maintaining the product, we decided to move the ownership of the
app to the Earthians team."_ — <https://discuss.frappe.io/t/128757> (2024-07-15). `frappe.io/health`
now 404s. Healthcare was removed from ERPNext core in commit `5905cf90` (2021-10-04, PR #27362); it is
absent from ERPNext ≥ v14.

**A2. Bus factor of two.** 404 commits in the last 12 months, but Anoop Kurungadam 232 (61%) + Sajin S R
82 (22%) = **83%**. 136 unique issue authors in nine years.

**A3. No row-level tenancy.** `healthcare/hooks.py:99-100` has `permission_query_conditions`
**commented out**. Zero `frappe.only_for` calls. Zero `User Permission` usage. **`Patient` has no
`company` field at all**, so the patient master is global across every company in a site. Isolation
is Frappe's database-per-site model — `frappe/installer.py:73` generates a per-site database, selected
by hostname (<https://docs.frappe.io/framework/user/en/bench/guides/setup-multitenancy>). Fifty clinics
means fifty databases, fifty migration runs, fifty backup streams.

**A4. An open, unfixed PHI exposure.** Issue
[#943](https://github.com/earthians/marley/issues/943) (2026-03-03, still open): _"Systemic missing
permission enforcement on `@frappe.whitelist()` API endpoints (~85+ functions)."_ Independently
verified worse at HEAD: **162** `@frappe.whitelist()` decorators, **2** `frappe.has_permission()`
calls, **0** `frappe.only_for()`, **123** `ignore_permissions=True`. `@frappe.whitelist()` enforces
_login_, not authorization. Combined with A3, any authenticated user reaches every patient's PHI.
Companion issue [#1063](https://github.com/earthians/marley/issues/1063) (2026-06-26) is also open.

**A5. Billing cannot be decoupled from full accounting.** `hooks.py:9` —
`required_apps = ["frappe/erpnext"]`. `healthcare/healthcare/utils.py` is a Sales Invoice factory
(`get_healthcare_services_to_invoice` :32 plus ten per-domain pullers). `patient.py:49-59` creates an
ERPNext **Customer** per patient and `:79-94` throws unless Customer Group, Territory and Selling Price
List defaults exist. 158 `Sales Invoice` references across the app.

**A6. The UI is form-per-doctype.** **128 doctypes; exactly two custom desk pages**
(`patient_history`, `patient_progress` — both read-only). Everything else is stock Frappe desk:
8 workspaces that are link lists to doctype list views. A consultation is a submittable **58-field
form across 12 tabs** (`patient_encounter.json`). The only purpose-built non-desk UI in the product is
the _patient-facing_ Vue portal (~1,700 LOC); nothing equivalent exists for clinicians or front desk.

**A7. Interop is aspirational.** No FHIR REST API — grep for `resourceType`, `Bundle`, `/fhir`
endpoints returns only terminology URI strings in `setup.py`. The `interop` branch (14 FHIR doctypes)
is **375 commits behind develop**, untouched since 2025-09-04. Issue
[#75 "FHIR compliance"](https://github.com/earthians/marley/issues/75) open since 2022-02-10.
The README's _"design is based on HL7 FHIR"_ is a **modelling-influence claim, not an interoperability
claim**.

**A8. ABDM frozen at Milestone 1 since 2022.** `healthcare/regional/india/abdm/` maps 22 endpoints, all
under `/v1/registration`, `/v2/registration`, `/v2/auth`, `/v1/search`, `/v2/account` — ABHA identity
only. **No consent artefacts, no HIP/HIU registration, no care-context linking, no record exchange.**
Delivered by PR #121, merged 2022-11-07; phases 2 and 3 never built. Maintainer akurungadam,
2026-07-28: _"nothing yet, will post you.. we restarted the development last month, in a couple of
months hopefully."_ — <https://discuss.frappe.io/t/128775>. Not certified.

**A9. No radiology/PACS, no pharmacy dispensing.** Word-boundary grep for
`dicom|pacs|hl7v2|mllp|wado|orthanc` across the entire repo: **zero hits**. Imaging is an `Observation`
of category `Imaging` with an `Attach` result — i.e. staple a file to an order. Pharmacy is delegated:
README, _"By integrating with ERPNext, features of ERPNext can also be utilized to manage Pharmacy and
supplies."_ Insurance exists (7 doctypes, shipped to stable in v16, 2026-01-14) but is **ledger-only** —
grep for `x12|nhcx|edi|837|clearinghouse|pmjay` returns zero hits. It tracks claims in your own books;
it transmits nothing to any payer network.

**A10. Adoption evidence is thin and stale.** Best community inventory
(<https://discuss.frappe.io/t/79721>, opened 2021-08-31) names **four hospitals in five years**. The
largest, RYK Hospital Pakistan ("3 branches, 300+ beds"), was posted **2022-10-19** and its only
supporting artefact is the implementation partner's own case study. Vendor site marleyhealth.io names
Shizuoka General Hospital, Japan — but for a **newborn hearing-screening registry since April 2022**,
not an OPD/IPD/billing HIS. `frappe.io/erpnext/case-studies` 404s. Regex over all 244 issue
titles/bodies for `slow|timeout|performance|scal|concurrent|thousands|large volume|crash|memory`
returns **0 hits** — for an inpatient HIS, that indicates nobody runs it at a load where scale bites.
Live-user reports that do exist come from a **4-bed day hospital**
([#1141](https://github.com/earthians/marley/issues/1141)) and a revenue-leak defect inserting billable
items at **rate 0.00** ([#1140](https://github.com/earthians/marley/issues/1140), open).

**A11. The Odoo path is services-led by construction.** From the AlmightyCS full demo transcript
(<https://www.youtube.com/watch?v=hiumJoDEHxI>, 56:55, 2022-12-31): _"our HMS is very big which is
built with 80 plus modules"_, and customization _"will be a paid service obviously."_ The demo's own
OPD walkthrough moves through patient form → appointment → evaluation → encounter tabs → prescription
→ final invoice as separate screens, while simultaneously advertising a waiting-room timer to _measure_
the delay this causes. `INFERENCE`: the product optimizes for configurability so the partner can avoid
code changes, not for desk speed.

**A12. The five supplied Frappe lessons confirm that the visible HMS feature set is a commodity
checklist, not a moat.** They teach a complete and internally coherent path, but every differentiating
claim is about coverage or configurability rather than a proprietary capability:

| Lesson                                                                 | What the incumbent already covers                                                                                                                                          | Consequence for this repo                                                                                                                                                                                                            |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Master data and setup](https://www.youtube.com/watch?v=52QYSeGVcVc)   | Departments, hierarchical service units, room/bed occupancy flags, practitioner schedules and fees, medical codes, default billing accounts                                | Department, practitioner, schedule, bed and code masters are table stakes. A larger or more configurable master-data surface is not defensible.                                                                                      |
| [Patient management](https://www.youtube.com/watch?v=VgBVX944kNw)      | Registration, ERP Customer linkage, registration and appointment invoicing, free follow-ups, portal invites, reminders, medical-history fields and a configurable timeline | Patient registration, reminders, a portal and a timeline are parity work. The structural opening is to avoid coupling patient identity and care state to ERP accounting automation.                                                  |
| [Consultation management](https://www.youtube.com/watch?v=ObeguwheZeM) | Appointment types and slots, procedure templates, vitals, a general Patient Encounter, prescriptions, investigations and reusable treatment plans                          | Templates reduce repeated entry but leave the clinician inside a long form workflow. The opportunity is a materially faster role-specific desk, not another encounter form or more templates.                                        |
| [Inpatient management](https://www.youtube.com/watch?v=EeKzUazeT0I)    | Admission orders, bed assignment, medication schedules and administrations, transfers, discharge notes and a consolidated medical record                                   | Admission, occupancy, medication administration, transfer and discharge are IPD table stakes. Their safety and financial boundaries have to be stronger, but stronger modelling alone is not a market moat until proven in live use. |
| [Course introduction](https://www.youtube.com/watch?v=a6x8uXg-0VM)     | Positions the same module set for organizations ranging from small clinics to super-specialty hospitals                                                                    | Breadth is the incumbent's positioning. Competing on breadth starts a module-count race this repo cannot win cheaply and does not need to win.                                                                                       |

Two concrete seams support the existing thesis. First, the patient lesson can create and cancel a Sales
Invoice as a side effect of booking or cancelling an Appointment; the inpatient lesson says services
should be billed before discharge. This repo instead keeps clinical and financial state independent
([product blueprint](../product-blueprint.md#billing-advances-and-accounting)). Second, Frappe's general
Patient Encounter covers consultation, admission, diagnostic, operative and invasive interactions,
whereas this repo gives OPD, Admission and Emergency separate operational records over one internal
Clinical Encounter ([product blueprint](../product-blueprint.md#the-internal-clinical-encounter)). These
are better invariants and useful trust evidence. `INFERENCE`: they become defensible only when they
produce measurably fewer billing errors, safer handoffs, faster onboarding or procurement wins.

### B. The regulatory rails are a moat, and they are specific

**B1. Audit trails must log reads.** MoHFW **EHR Standards for India, notified 30 December 2016**,
maintained by NRCeS — <https://www.nrces.in/standards/ehr-standards-for-india>. Verbatim: _"All actions
related to electronic health information… **including viewing** should be recorded"_, with date, time,
record identification and user identification on create / modify / delete / print. NABH DHS **DIS.2.d**
requires capturing _"the audit trails of each transaction"_. **Write-only audit satisfies neither.**

**B2. Retention is lifetime, not three years.** Same EHR Standards: records preserved **throughout the
patient's lifetime**; after death, move to _inactive_ preferably after three years; permanent
destruction **discouraged**. The IMC 2002 three-year rule is a professional-misconduct floor for
inpatient records only. The NMC RMP Conduct Regulations 2023 (gazetted 2023-08-03,
[PDF](https://www.nmc.org.in/wp-content/uploads/2023/02/NMC_RMP_Conduct_Regulations_2023.pdf)) would
have re-based the clock to _last contact_ and mandated _"fully digitized records"_ within three years,
but were **held in abeyance**; IMC 2002 remains operative. `INFERENCE`: design to the stricter rule.

**B3. A pasted signature image fails certification.** NABH DHS **COP.1.c** requires capturing digital
signatures of treating practitioners and states explicitly that **"pasting of signature will not
qualify"** — it requires Aadhaar e-Sign, a DSC from a licensed CA, or another IT Act 2000-compliant
method. The ABDM `DocumentBundle` profile already provides the slot (`signature`, 0..1, _"base64
encoded. XML-DSig or a JWT."_).

**B4. NABH now certifies software, and M3 is the gate.** NABH **Digital Health Standards for Clinic
Management Systems, 1st Edition, September 2025** —
<https://nabh.co/programmes/digital-health-standards-for-clinic-management-system/>. Eligibility:
**minimum 10 operational clinic deployments in India plus a valid ABDM M3 compliance certificate.**
That is a commercial reason M3 is not optional, and a barrier that compounds — early certification
makes later certification easier to sell.

**B5. ABDM's architecture presumes a multi-tenant vendor.** From NHA's **Sandbox Documentation
(ABDM Milestone 3), Version 2.5, 03.03.2025** —
<https://sandboxcms.abdm.gov.in/uploads/M3_Dcoument_03_03_2025_faf0c9aecb.pdf> §2, verbatim:
**Bridge ID** is _"client ID which provided by NHA to HIP (Its alphanumerical eg: `SBX_00XXXX`)"_;
**Service ID** is _"Facility ID which is generated from NHPR application (Its alphanumeric eg:
`IN02100000XX`)"_. One bridge, many services. Facility linkage is
`POST .../v1/bridges/MutipleHRPAddUpdateServices` with `facilityId`, `bridgeId`, `hipName`, `type`,
`active`. Gateway v3 lives at `https://apis.abdm.gov.in/api/hiecm/…/v3/` (sandbox `dev.abdm.gov.in`,
routed by header `X-CM-ID`).

**B6. The compliance checklist already exists, published.** NHA **MVP Guidance Document for ABDM
Compliant HMIS/LMIS, Version 3.0** —
<https://abdm.gov.in/strapicms/uploads/Approved_MVP_document_Version_3_9fc83de148.pdf> (undated;
internal deadlines run Oct 2022 → Apr 2023). Mandatory for Hospital-HMIS: transport encryption,
**encryption at rest**, **audit trail**, access control, emergency access, **data migration in and
out**, SNOMED CT / ICD / LOINC, DICOM, ABDM FHIR R4 profiles. Disaster recovery is _"Suggested"_
generally but **Mandatory for small hospitals up to 25 beds** — i.e. mandatory for the likely entry
segment.

**B7. FHIR target is pinned and stable.** NRCeS FHIR IG for ABDM, canonical
`https://nrces.in/ndhm/fhir/r4`, package `ndhm.in`. **Current release v6.5.0, 2025-05-08**
(<https://nrces.in/ndhm/fhir/r4/history.html>). A v7.0.0 exists at
<https://www.nrces.in/preview/ndhm/fhir/r4/index.html> dated 2026-07-15 but **self-describes as
"Local Development build" / "Draft"** — build against 6.5.0. FHIR version is exactly `4.0.1`.
Seven `Composition`-derived clinical artifacts (`OPConsultRecord`, `PrescriptionRecord`,
`DiagnosticReportRecord`, `DischargeSummaryRecord`, `ImmunizationRecord`, `HealthDocumentRecord`,
`WellnessRecord`) plus `InvoiceRecord` (added v6.0.0, _"To onboard Pharmacies to ABDM"_).
`Bundle.type` fixed to `document`; `bdl-11`: first entry SHALL be a `Composition`.

**B8. NHCX is optional and does not address hospitals.** IRDAI circular
`IRDAI/HLT/CIR/MISC/124/06/2023`, 8 June 2023 — addressed _"To All Insurers (except ECGC, AIC) and
TPAs"_, para 4: insurers and TPAs are _**"hereby advised"**_ to adopt; para 6: _"Insurers **may**
on-board themselves."_ No deadline, no penalty, hospitals not addressed. The gateway is live
(a probe of `POST https://apisbx.abdm.gov.in/hcx/v1/claim/submit` returns a real protocol envelope,
`NHCX-401`), but adoption figures could not be verified from any first-party source.

**B9. Billing needs two turnover tests, not one.** E-invoicing (IRN) applies above **₹5 crore** AATO
(10/2023-CT, 10.05.2023, effective 01.08.2023). The separate **30-day IRN reporting window** applies
above **₹10 crore** AATO (GSTN advisory 05.11.2024, effective 01.04.2025 —
<https://einvoice6.gst.gov.in/content/revised-time-limit-for-e-invoice-reporting-for-businesses-with-aato-of-%E2%82%B910-crores-above/>).
And the room-rent rule survived the 2025 two-slab reform: **5% without ITC on rooms above ₹5,000/day,
ICU/CCU/ICCU/NICU excluded** (03/2022-CT(R) S.No. 31A + 04/2022-CT(R), both 13.07.2022, effective
18.07.2022). Reading 15/2025-CT(R) and 16/2025-CT(R) (both 17.09.2025) directly confirms **neither
withdraws it**; reports that it was withdrawn are wrong. That is a per-bed-per-day computation with a
ward-type exclusion and blocked input credit — not a line-item tax rate.

**B10. DPDP is in a phase-in, and health gets no special tier.** DPDP Rules 2025 notified
**14 November 2025**; PIB, verbatim: _"The Rules introduce an **eighteen-month period for phased
compliance**"_ — outer deadline around **14 May 2027**
(<https://www.pib.gov.in/PressReleasePage.aspx?PRID=2190655>). Data-principal rights (access,
correction, erasure) carry a **90-day** maximum. DPDP has **no "sensitive personal data" category**;
s.44 repeals the SPDI Rules 2011 only when brought into force. `INFERENCE`: during phase-in, design to
the stricter of the two. Note the collision worth naming early: **DPDP's erasure right versus the EHR
Standards' lifetime-preservation duty** needs a documented lawful-basis override, not an ad-hoc delete.

### C. The workflow constraint that dominates every design decision

**C1. An Indian OPD consultation is 1.5–2.3 minutes.** Irving et al., **BMJ Open 2017** — systematic
review, 179 studies, **28,570,712 consultations**, 67 countries (PMID 29118053,
<https://pmc.ncbi.nlm.nih.gov/articles/PMC5695512/>). India: **1.5–2.3 minutes** across studies spanning
1979–2015. Sweden, for contrast: 21–22.5 minutes. Eighteen countries covering roughly half the world's
population get **five minutes or less**. The authors note such consultations are _"likely to adversely
affect patient healthcare and physician workload and stress."_ A private secondary-care Indian OPD
time-motion study finds **~6 minutes** — private runs longer, but still inside one order of magnitude of
the pooled figure.

Volume: a Maharashtra PHC study found **40–182 OPD visits per PHC per day** with 80/day as the
performance threshold (<https://pmc.ncbi.nlm.nih.gov/articles/PMC10122341/>).
`INFERENCE`: a working range of **2 minutes (government/high-volume) to 6 minutes (private)**, at
**80–150+ patients per doctor per day**. PHC volumes are facility-level; PHCs are often single-doctor,
so they approximate but do not prove a per-doctor number.

**This is the number that kills the incumbent design.** A6 showed the consultation record in Marley is a
submittable **58-field form across 12 tabs**. The Odoo demo (A11) walks the same consult through four
or five screens. Neither is a 2-minute artifact. **Screen-count and field-count are not UX preferences
in this market; they are the product constraint.**

**C2. Why doctors stay on paper is asserted everywhere and measured nowhere.** The best available Indian
evidence is a cross-sectional survey of 105 postgraduate doctors at a private rural tertiary hospital in
Ujjain (BMC Health Serv Res, 2025, <https://pmc.ncbi.nlm.nih.gov/articles/PMC12087044/>): 93% _wanted_
an EMR, but **only 46% believed it would save time**; 94% named time management a barrier. Free-text:
_"A lot of time will be required initially to start EMR and to maintain it."_ The paper reports **no**
documentation-time measurement and **no** revert-to-paper rate.

**No NHSRC or NHA report quantifying EMR abandonment, consultation-time inflation, or language barriers
was found.** Figures circulating as Indian — "EMR adoption below 15%", "16 minutes per patient on
digital records" — trace to vendor blogs, and the 16-minute figure is a **US** number (Overhage &
McCallie, Ann Intern Med 2020) recycled as Indian. **Do not cite either.** `INFERENCE`: the abandonment
story is plausible and universally asserted, but it is currently anecdote plus vendor marketing. If the
business case needs it, it has to be generated first-hand — which makes it a pilot-instrumentation
requirement, not a research gap.

**C3. Ambient AI scribes save less than the marketing implies, and nothing has been evaluated in Indian
languages.** The strongest study is **JAMA, 1 April 2026** — Ambient Clinical Documentation
Collaborative, 8,581 ambulatory clinicians (1,809 adopters vs 6,772 non-adopters) across Mass General
Brigham, Emory, UCSF, Yale New Haven and UC Davis, June 2023 – Aug 2025, using Ambience, Nuance DAX
Copilot and Abridge on Epic. Result: **documentation time −16.0 minutes and total EHR time −13.4 minutes
per 8-hour clinical day**, +0.49 visits/week — and **only 32% of adopters used the scribe in ≥50% of
visits**. Note the denominator: this is per _day_, not per encounter; some secondary coverage misreports
it. Kaiser Permanente/TPMG's operational analysis (NEJM Catalyst CAT.25.0040; 7,260 physicians,
2,576,627 encounters, 63 weeks) reports ~15,791 hours saved, which is roughly **0.37 minutes per
encounter**.

Burnout results are better but weaker in design: JAMA Netw Open, Aug 2025
(doi 10.1001/jamanetworkopen.2025.28056), >1,400 clinicians, **21.2% absolute reduction in burnout
prevalence at 84 days** — survey-based pre-post, no control arm.

**Evidence quality, stated honestly: one large multi-site controlled study showing modest savings, and
everything else uncontrolled pre-post, survey, or vendor-adjacent. Effect sizes shrink as rigour rises.**

**No published evaluation covers Indian-language or code-switched Hinglish clinical speech.** The npj
Digital Medicine 2026 scaling paper (PMID 41866429) names LMIC language adaptation as an _opportunity_
and flags automation bias, but reports no non-English data. A Hinglish ASR corpus exists (HiACC,
PMC12329218) but it is general speech, not clinical. Circulating word-error-rate and hallucination
figures for Indic/code-switched speech come from **Indian vendor blogs, not peer review** — do not cite.

### D. What Indian doctors actually complain about, and what the market pays

All ratings and review text pulled from live listings on **2026-08-22**, India region.

**D1. Doctor-facing apps are rated far worse than the same vendors' patient apps.**

| App                                                                                                 | Play rating | Play reviews | iOS rating | iOS ratings |
| --------------------------------------------------------------------------------------------------- | ----------- | ------------ | ---------- | ----------- |
| [Practo Pro — For Doctors](https://play.google.com/store/apps/details?id=com.practo.droid&hl=en_IN) | **3.1**     | 7,560        | 4.40       | 5,219       |
| [HealthPlix SPOT](https://play.google.com/store/apps/details?id=com.healthplix.spot&hl=en_IN)       | **2.8**     | 782          | —          | —           |
| [Eka Doc](https://play.google.com/store/apps/details?id=eka.care.doctor&hl=en_IN)                   | 4.5         | 852          | 4.28       | 185         |
| [Bajaj Health — for Doctor](https://play.google.com/store/apps/details?id=com.drx&hl=en_IN)         | 3.8         | 3,520        | 4.53       | 1,062       |
| Practo (consumer)                                                                                   | —           | —            | **4.67**   | 104,778     |

**Absolute scale is small**: 782 reviews for HealthPlix SPOT and 852 for Eka Doc, against vendor claims
of 14,000+ doctors. `INFERENCE`: the doctor-side installed base of even the leading Indian EMRs is in
the low tens of thousands, not hundreds of thousands. **This is not a saturated market.**

**D2. The loudest structural complaint is data hostage-taking — and it is the strongest signal in this
entire investigation.** Verbatim, from Google Play:

> _"pathetic software with so many caps on data dear, **Data belongs to the doctor who bought your
> license** but you guys are mad and don't understand the simple thing"_ — 1★, HealthPlix SPOT

> _"I've seen Practo monetize even basic services that were given to me initially. They are charging me
> for storing patient data now too… **I am forced to stick to this software due to extensive patient
> data stored on it, and I Hate it!**"_ — 1★, Practo Pro

> _"Initially they will say its completely free and then they suddenly drop pop up message saying your
> account will be deactivated in 3 days untill you pay… **All the patient data, regarding their
> treatment or other history you saved is suddenly gone.**"_ — 1★, HealthPlix SPOT

> _"A great team of people to convince people to get onboard and then **a pathetic team of people who
> prevent you from leaving**."_ — 1★, Eka Doc

**D3. Support collapses after the sale.**

> _"Extremely disappointing experience. **They are very responsive until you onboard, but after that,
> getting support is almost impossible.** Even if you manage to reach someone, the response is usually,
> 'This isn't my department, I'll escalate it,' with little to no follow-up… **A service meant to make
> work easier shouldn't add more work.**"_ — 1★, Practo Pro

> _"took subscription for 3 years and they have now stopped taking complaints wasted 39000₹."_ — 1★, Eka Doc

**D4. Bugs break the clinic day, and updates remove working features.**

> _"Bugs have completely overtaken… **Affecting my daily practice**… **They Remove the essential easy
> simple things and add complicated things without taking feedback from the existing users.**"_ — 1★, Eka Doc

> _"if you are planning on choosing this software for your practice, Be aware that you are in for
> **financial loss, broken work flow, pissed off patients** because of erratic and bug ridden
> software."_ — 1★, Eka Doc

> _"most of the time the app does not work. **simple things like the change in clinic schedule time can
> not be updated**"_ — 1★, Practo Pro

**D5. The marketplace bundle poisons the software's reputation.** Practo Pro and Bajaj Health for Doctor
draw heavy anger about undelivered patient leads (_"makes fake bookings and squeezes out money from
doctors"_; _"less than 10 patients consultation in 1 year"_). `INFERENCE`: discovery-marketplace and
practice-software are different products, and bundling them imports a whole complaint class. A pure
practice-software product avoids it entirely.

**D6. Almost nobody publishes pricing — one vendor in six.** Three independent passes over the same
sites; where they disagreed, the majority reading is given and the dissent recorded.

| Vendor                                            | Publishes?                                                                                                                                                                     | Detail                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [**DocEngage**](https://www.docengage.in/pricing) | **Yes — confirmed all three passes.** It advertises the fact: _"We are the only company in India who published every pricing. There is nothing hidden. You pay what you see."_ | Per **care centre** per year, ≤10 users: Clinic Management ₹30,000 (Basic) / ₹36,000 (Advanced); **Practice Management ₹36,000 / ₹54,000** (the Advanced tier covers OPD, IPD, lab, beds, pharmacy); Telehealth ₹42,000 / ₹60,000; Healthcare CRM ₹96,000; >200 users quote-only. **No per-bed pricing anywhere.** |
| Practo Ray                                        | **No** (2 of 3 passes: contact-sales only; `/providers/pricing` 404s)                                                                                                          | One pass read ₹999–1,499/mo plus a 1.8–2% payments take-rate. **Unconfirmed — do not quote.**                                                                                                                                                                                                                      |
| Eka Care                                          | **No** (2 of 3: pricing pages 404)                                                                                                                                             | One pass read ₹16,999–18,749/yr per seat. A user review independently cites **₹39,000 for 3 years**, which is the only user-corroborated figure in the set.                                                                                                                                                        |
| HealthPlix                                        | **No** (main site renders no prices; `/pricing` 404s)                                                                                                                          | A blog subdomain leaks ₹11,999–17,999/yr. Note: the "₹60,000" on md.healthplix.com is a **referral bonus, not a price**.                                                                                                                                                                                           |
| KareXpert, Halemind                               | **No** — demo/contact only, confirmed all passes                                                                                                                               | Implementation-services-led `INFERENCE`                                                                                                                                                                                                                                                                            |

**Two things follow.** First, **pricing opacity is the norm**, which means a published price is itself a
differentiator — DocEngage treats it as one. Second, the one fully-public data point puts a
**clinic-to-small-hospital HMS at ₹36,000–₹54,000 per care centre per year**, sold per site rather than
per bed. `INFERENCE`: that is the anchor a new entrant in this segment is priced against.

**Third-party Practo Ray figures circulating at ₹1,000–6,000/doctor/month come from competitor
marketing blogs — do not cite them.**

**D7. Two more themes worth designing against.** _Ads inside paid software_ — HealthPlix SPOT, 1★:
_"they show adverts on the paid platform. only when I threatened a law suit they withdrew the ads."_
And _the mobile app is a stub_: _"app does not have much of features **need to depend on website
version**, I basically subscribed due to initial features of app, later many features disabled"_
(Eka Doc, 3★); _"no handy version of the app.. so we can see all patient data on phone"_
(HealthPlix SPOT, 2★).

**Not reached:** Reddit (crawler-blocked, 403 on the JSON API), G2 (Cloudflare 403), Capterra and
Indian aggregators (review bodies render client-side), and Apple review _bodies_ (the RSS returns
empty — the iOS star counts above are from the lookup API and are reliable, but every quote above is
Android). DocEngage and Halemind have no findable doctor-facing app listing, so there is **no user
evidence at all** for them, only vendor marketing.

### E. What this repo already has

Internal recon, 2026-08-22, `main` @ `2ad1c07`. ~21,000 LOC across apps and packages; 13 domain tables;
12 oRPC routers; 24 test files.

- **Tenant isolation as a first-class invariant.** ADR [0002](../contributing/decisions/0002-no-fallback-scope.md)
  (no fallback scope), [0010](../contributing/decisions/0010-org-id-in-procedure-input.md),
  [0015](../contributing/decisions/0015-org-procedure-only.md). Every domain row carries `orgId`; every
  read and write proves scope. This is precisely what A3 shows the incumbent lacks.
- **A FHIR-shaped clinical spine already.** `packages/db/src/schema/clinical-encounters.ts:16` documents
  itself as _"FHIR's Encounter"_, deliberately not a workflow table, with OPD/IPD/emergency owning their
  own statuses (ADR [0022](../contributing/decisions/0022-care-settings-are-separate-destinations.md),
  [0023](../contributing/decisions/0023-charges-hang-off-the-clinical-encounter.md)).
- **Double-entry billing that is a projection, not a general ledger.** `accounts`, `journal_entries`,
  `journal_lines` posted in the same transaction as the billing document
  (ADR [0020](../contributing/decisions/0020-double-entry-posting-in-billing-transactions.md)).
  Directly contrasts A5: money is modelled without an ERP dependency.
- **Paper-first clinical capture.** `opd.attachPrescription` / `detachPrescription`
  (`packages/api/src/routers/opd.ts:526,596`), reasoned in
  [`02-paper-first-consultation.md`](02-paper-first-consultation.md).
- **AI deliberately removed.** ADR [0024](../contributing/decisions/0024-remove-generic-ai-chat.md)
  (2026-08-21) deleted the generic chat and states AI returns only inside a workflow that defines
  _"authorization, consent, provenance, human review, source-record linkage, failure handling, and
  auditing."_ That is a well-set gate, not an absence.
- **Audit is mutation-only.** ADR [0005](../contributing/decisions/0005-fire-and-forget-audit.md);
  project intent says _"Not every mutation — the ones a customer or auditor will ask about."_
  This is the one place where a shipped decision now conflicts with B1.

---

## What this proves / does not prove

**Proves.** That the incumbent open-source HMS in this segment is single-tenant by construction,
authorization-broken at the API layer today, welded to an ERP for billing, form-per-doctype in the UI,
and stalled on the national health stack. That India's notified standards impose read-logging, lifetime
retention and real cryptographic signatures, which most products do not implement. That NABH now gates
a software certification on ABDM M3. That ABDM's bridge/service split is multi-tenant-shaped. That the
Indian consultation window is 1.5–2.3 minutes at very high volume, which no form-per-doctype design can
fit. That published ambient-scribe savings are real but modest, and unevaluated in Indian languages.

That Indian doctors' loudest complaints about existing EMRs are data lock-in, post-sale support
collapse, and bugs that break the clinic day — not missing features. That published per-doctor pricing
is opaque across five of six vendors, and that the one fully-published HMS price is ₹36,000–₹54,000 per
care centre per year.

**Does not prove.** That any of this converts to sales. Source-code weakness is not market weakness —
Marley's install base is small, but so is the evidence that a better product wins those buyers rather
than the incumbent's implementation partner. It does not prove that read-logging or e-signature is what
any specific buyer will pay for; regulation creates a _requirement_, not necessarily a _purchase_.

**The review evidence has a known bias and it must not be over-read.** App-store reviews
oversample angry users; 1★ text is the loudest sample, not the median experience. The quotes in D2–D5
establish that these complaints **exist and recur**, not their prevalence. Nothing here measures how
many doctors churn over lock-in, or what switching actually costs. **No G2, Capterra or Reddit evidence
was reachable**, and all quoted text is Android-only.

**On the consultation-length finding specifically:** the Irving India figures span **1979–2015** and are
pooled from studies of varying design. They establish the order of magnitude, not a current per-clinic
number. They also measure _consultation_ time, not total doctor-facing software time. And short
consultations do not by themselves prove that software caused or worsened anything — **no Indian study
measures documentation-time inflation from an EMR at all** (C2). The claim this document rests on is
narrow and defensible: any workflow requiring minutes of structured entry per patient does not fit the
observed window.

**Explicitly not established:** ABDM certification duration (no first-party statement; NHA sandbox docs
return HTTP 503 to non-browser clients — vendor claims of 4–9 months are unverifiable); the empanelled
certification-agency list; the Scan-and-Share / token-based OPD registration API contract (existence
confirmed three ways, contract not retrievable); the M2 HIP-side `dataPushUrl` payload envelope; whether
the Health Data Retention Policy referenced in HIP obligations since 2022 was ever issued; whether DHIS
incentives survive past March 2026 (no Corrigendum 7 found — treat as lapsed); SNOMED CT India licence
terms for a commercial vendor (NRCeS licence pages 404 — commercially material); and the Clinical
Establishments Act 2010 record rules (every route unreachable from this network).

---

## What this means for us — the 10x levers

Ordered by (evidence strength × leverage now) ÷ cost. Each names the trigger it would need under the
existing roadmap discipline; none of them is authorized by this document.

### 1. Make the audit trail read-aware — the only shipped decision that now conflicts with law

**Why 10x, not 10%.** B1 is a _notified standard_, and it is the single control that is nearly free to
add at 21k LOC and brutally expensive to retrofit at 200k. It simultaneously (a) closes a compliance
gap, (b) becomes a sellable screen — "who opened this patient's record" is a question hospital
administrators ask and no competitor in this segment can answer, and (c) is the exact inverse of the
incumbent's defining defect (A3 + A4).

**The core change.** ADR 0005 scopes audit to sensitive mutations. B1 requires create / modify /
delete / print **and view**, with user, timestamp and record ID. That is a different write volume and a
different storage shape — an append-only read log with an explicit sampling and retention policy, not
an extension of the existing table. It needs its own ADR superseding or amending 0005, because
"fire-and-forget" is the wrong delivery guarantee for a compliance artifact.

**Risk to name plainly:** read-logging on a queue screen that polls will generate enormous volume. The
policy question (log the record open, not the list render) must be settled before the schema.

### 2. Adopt the ABDM FHIR IG as an **export contract** now, without becoming a HIP

**Why 10x — and this is now the highest-confidence lever in the document, because it is the only one
with both regulatory and user-demand evidence behind it.** Four payoffs from one piece of work. It is
the ABDM on-ramp (B5/B7) whenever a sale triggers it. It is the DPDP data-portability right (B10,
90-day SLA) satisfied for free. It is the strongest possible answer to lock-in objections — a
competitor whose export is a CSV cannot match one whose export is a valid `DocumentBundle`. And **D2
shows lock-in is the single loudest complaint in this market**, which converts a compliance chore into
the marketing line: _the data is yours, in the national standard format, and you can take it with you._

**The uncomfortable implication, stated plainly: this deliberately weakens your own retention.** Every
incumbent named in D2 monetizes the opposite. Making export first-class is a bet that trust wins more
customers than hostage-taking retains — and that bet is only rational if the product is genuinely
better at the daily work. It is a strategy commitment, not a feature.

**The core change.** Emit `OPConsultRecord`, `PrescriptionRecord` and `InvoiceRecord` bundles from
`clinical_encounters` + `charges` + `attachments`. Pin **IG 6.5.0 / FHIR 4.0.1** — not the 7.0.0 draft.
Store three identifiers on tenancy: facility **HFR ID**, practitioner **HPR ID**, app **bridge ID**,
plus a per-tenant **`hipName`** with a 15-character no-special-characters validator (it is
patient-visible in the ABHA app). Validate locally with HAPI against the IG's `package.tgz` before ever
touching the sandbox.

**Cost is low precisely because it is early.** 13 tables. The shape already matches — ADR 0023's
`clinicalEncounter` is `Encounter`; `charges` → `ChargeItem`; `invoices` → `Invoice`.

**Note:** registration is _portal_ work, not integration work. HFR/HPR have no public API to create a
facility or practitioner (Aadhaar OTP + C-DAC e-Sign, portal-only). The only real API surfaces are
bridge↔facility linkage and the HIE-CM v3 consent/data-flow APIs.

### 3. Replace signature _images_ with real e-signatures

**Why it matters.** B3 is explicit — a pasted image does not qualify. Today's paper-first design
(storing the doctor's signed page as a private file) is a defensible _source document_ and should stay.
But any system-generated record — discharge summary, generated prescription, and eventually the FHIR
bundle's `signature` slot — needs Aadhaar e-Sign or a licensed-CA DSC.

**This is the unlock for the doctor-facing workflow that `02-paper-first-consultation.md` deferred.**
That document's blocker was that proxy signing changes clinical authorship. A real e-signature solves
authorship properly rather than working around it.

### 4. Change the retention model from "purge" to "lifetime with lifecycle"

**Why now.** Defaults are cheap to set and expensive to change once a customer has three years of data.
B2 says lifetime, mark inactive after death, discourage destruction. B10 says a data principal may
demand erasure within 90 days. **Those two collide**, and the collision needs a documented lawful-basis
override before either is implemented, not after a request arrives.

### 5. Treat time-to-first-invoice as the product metric

**Why it is a real moat and not a slogan.** A5 is structural: Marley cannot bill until ERPNext has a
Company, Chart of Accounts, Customer Group, Territory and Price List. This repo already allocates an
MRN from an org-scoped counter and seeds a chart of accounts. **Measure the number, then defend it as a
constraint** — every future setup requirement is spending it.

### 6. The AI wedge is the prescription image you already store

**Why this one and not the others.** ADR 0024 set the gate: owned workflow, source-record linkage,
consent boundary, provenance, required human review. The prescription attachment satisfies every clause
naturally — the source record exists and is immutable, the reviewer is the practitioner already on the
encounter, and the output is a _draft index_ (medicines, advice, diagnosis text) that stays visibly
unverified, exactly as `02-paper-first-consultation.md` prescribed. It converts a write-only image into
searchable, structured, FHIR-exportable data.

**Prefer image extraction over ambient speech, and the evidence now says why.** C3 gives the strongest
available scribe study — **JAMA, April 2026**, 8,581 clinicians — a saving of **16 minutes of
documentation per 8-hour day**, with only **32% of adopters using it in half their visits**. Kaiser's
operational figure works out to about **0.37 minutes per encounter**. Against a **1.5–2.3 minute**
Indian consultation (C1), a per-encounter saving of that size is not a product. Worse, **no published
evaluation covers Indian-language or code-switched Hinglish clinical speech at all** — the capability
is unproven in the language the market actually speaks.

**The prescription image has none of those problems.** It is asynchronous, so it never competes for the
2-minute window; it is already captured; the artifact is fixed rather than streamed; and the failure
mode is a wrong draft field a clinician rejects, not a wrong note in the record. Ambient speech stays
behind the roadmap's _Ambient AI consultation_ trigger and should stay there until Indic clinical ASR
has published evidence.

### 7. Publish the isolation tests as a sales artifact

**Cheap, and no competitor can copy it.** A3 and A4 mean Marley cannot make the claim at all. The
tenancy tests already exist. Make them a document a hospital's IT reviewer can read.

### The one core change worth considering, not just an improvement

**Become the ABDM bridge for many small facilities, not one HIP for one hospital.** B5 shows NHA
designed exactly this: one Bridge ID for your software, many Service IDs for facilities. The incumbent's
database-per-site model cannot express it; a row-level multi-tenant system expresses it naturally.
`INFERENCE, and the largest open question in this document`: whether that is a product, a compliance
posture, or a regulatory relationship this repo's owner is willing to hold. It changes what the company
is, so it belongs in `validate-idea` or `brainstorm`, not in a spec.

---

## Next falsification

The claims most likely to be wrong, and the cheapest test for each:

1. **"Nobody in this segment has real multi-tenancy."** Falsify by auditing Danphe, CARE (ohcnetwork)
   and Bahmni for row-level org scoping the way A3 audited Marley. `00-synthesis.md` §2 covers their
   feature sets but not their isolation model.
2. **"Compliance converts to purchase."** Falsify by asking one real hospital buyer whether NABH DHS
   or ABDM certification appears in their procurement criteria. One conversation settles it.
3. **"Lock-in anger converts to switching."** D2 proves the anger; nothing proves the churn. Falsify by
   asking five doctors who left an EMR what it cost them in money and days, and what they lost. **This
   is the biggest remaining hole**, and it decides whether lever 2 is a wedge or merely a virtue.
4. **"Extraction works on Indian handwritten prescriptions."** Falsify cheaply: bench-test a model
   against 100 real (consented, de-identified) prescription images from the pilot and measure field
   accuracy for drug name, dose and frequency. Lever 6 is unsupported until this exists.
5. **"₹36,000–₹54,000 per care centre per year is the anchor."** It rests on **one** vendor. Falsify by
   getting a real quote from KareXpert or Halemind for a 30-bed hospital — that single data point would
   tell you more about this market's willingness to pay than every feature comparison in this document.
6. **The Curve25519 landmine.** Third-party report ([mgrmtech/fidelius-cli](https://github.com/mgrmtech/fidelius-cli))
   that ABDM's Fidelius library uses BouncyCastle **short-Weierstrass** Curve25519 rather than the
   Montgomery-form X25519 in libsodium / WebCrypto / Node. If true, standard libraries fail decryption
   silently. **Unverified, cheap to test against the sandbox, expensive to discover late.**
7. **IG 6.5.0 vs 7.0.0.** Re-check <https://nrces.in/ndhm/fhir/r4/history.html> before any FHIR work
   starts; 7.0.0 was a draft build on 2026-07-15 and may have been released since.

## Gaps in this investigation

All four strands eventually landed, but with these holes:

- **Switching cost is still unmeasured.** D2 proves doctors _feel_ trapped. Nothing establishes what
  leaving actually costs in money or days, or how often it happens. This remains the biggest hole.
- **No community-forum evidence.** Reddit, G2 and Capterra were all unreachable (crawler blocks,
  Cloudflare 403, client-side rendering). All user quotes are Android app-store reviews.
- **No Indian measurement of EMR documentation-time inflation exists** (C2). The most-cited figures are
  a US number recycled as Indian. If the business case needs this, it must be generated in the pilot.
- **Lever 6 has no accuracy evidence.** Nothing in this document shows AI extraction works at acceptable
  accuracy on Indian handwritten prescriptions. C3 argues the _shape_ is right (asynchronous, fixed
  artifact, clinician-reviewed) and that ambient speech is worse. It does not show the extraction works.
  **Do not treat lever 6 as evidence-backed until a bench test on real prescription images exists.**
- **No first-party adoption data for Marley** beyond four hospitals named in five years (A10), and no
  reachable NHCX participant list (B8).

## Sources

**Competitor source audit** — [earthians/marley](https://github.com/earthians/marley) @ `e24bc491` ·
[marleyhealth.io](https://marleyhealth.io) · [earthianslive.com](https://earthianslive.com) ·
[docs.frappe.io/erpnext/frappe-healthcare](https://docs.frappe.io/erpnext/frappe-healthcare) ·
[Frappe multitenancy](https://docs.frappe.io/framework/user/en/bench/guides/setup-multitenancy) ·
[Frappe Cloud pricing](https://frappe.io/cloud/pricing) ·
[discuss.frappe.io/t/79721](https://discuss.frappe.io/t/79721) ·
[t/128757](https://discuss.frappe.io/t/128757) · [t/128775](https://discuss.frappe.io/t/128775) ·
issues [#943](https://github.com/earthians/marley/issues/943),
[#1063](https://github.com/earthians/marley/issues/1063),
[#75](https://github.com/earthians/marley/issues/75),
[#1140](https://github.com/earthians/marley/issues/1140),
[#1141](https://github.com/earthians/marley/issues/1141)

**Vendor training corpora (user-supplied)** — Frappe School _Healthcare Management_, 7 videos, uploaded
2024-01-05 ([intro](https://www.youtube.com/watch?v=a6x8uXg-0VM)) · AlmightyCS _Odoo HMS_, 17 videos,
notably the [56:55 full demo](https://www.youtube.com/watch?v=hiumJoDEHxI) (2022-12-31)

**ABDM / NHA** — [HIP/HIU Guidelines v24-10-2022](https://abdm.gov.in/strapicms/uploads/HIP_HIU_Guidelines_f85df336ec.pdf) ·
[MVP Guidance v3.0](https://abdm.gov.in/strapicms/uploads/Approved_MVP_document_Version_3_9fc83de148.pdf) ·
[M3 Sandbox Doc v2.5, 03.03.2025](https://sandboxcms.abdm.gov.in/uploads/M3_Dcoument_03_03_2025_faf0c9aecb.pdf) ·
[ABHA V3 Integrator Guide v1.2, 04-10-2024](https://sandboxcms.abdm.gov.in/uploads/ABDM_ABHA_V3_AP_Is_SOP_V1_1_4_faef8099bd.pdf) ·
[HFR Verifier SOP](https://abdm.gov.in/strapicms/uploads/Health_Facility_Registry_SOP_b40e4bb9be.pdf) ·
[DHIS Operational Guidelines 17-01-2023](https://abdm.gov.in/static/media/OperationalGuidelinesDHIS.a35651cdf843e0b399c2.pdf) ·
[DHIS Corrigendum 6, 20-11-2025](https://abdm.gov.in/strapicms/uploads/20_Nov_2025_vf_DHIS_Corrigendum_6_dba5b58a53.pdf)

**Standards** — [NRCeS FHIR IG history](https://nrces.in/ndhm/fhir/r4/history.html) ·
[DocumentBundle 6.5.0](https://nrces.in/ndhm/fhir/r4/StructureDefinition-DocumentBundle.html) ·
[FHIR in ABDM and NHCX, Sept 2024](https://www.nrces.in/download/files/pdf/Implementation_Guide_for_Adoption_of_FHIR_in_ABDM_and_NHCX.pdf) ·
[EHR Standards for India 2016](https://www.nrces.in/standards/ehr-standards-for-india) ·
[NABH Hospital Standards 6th ed., eff. 01-01-2025](https://portal.nabh.co/images/Standards/NABH%20Hospital%20Accreditation%20Standard%206th%20Edition%20January%202025.pdf) ·
[NABH DHS for CMS](https://nabh.co/programmes/digital-health-standards-for-clinic-management-system/)

**Law and tax** — [IRDAI HCX circular, 08-06-2023](<https://irdai.gov.in/documents/37343/365525/Circular+on+Testing+and+adoption+of+Health+Claims+Exchange+(HCX)+Specifications+and+e-claim+standards.pdf/a336cb71-95d1-cfb7-4b10-4ceb50494f0c>) ·
[DPDP Rules 2025, PIB 17-11-2025](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2190655) ·
[NMC RMP Conduct Regulations 2023](https://www.nmc.org.in/wp-content/uploads/2023/02/NMC_RMP_Conduct_Regulations_2023.pdf) ·
[03/2022-CT(R)](https://cbic-gst.gov.in/pdf/central-tax-rate/03_2022-ctr-eng.pdf) ·
[04/2022-CT(R)](https://cbic-gst.gov.in/pdf/central-tax-rate/04_2022-ctr-eng.pdf) ·
[17/2022-CT](https://cbic-gst.gov.in/pdf/central-tax/17-2022-ct-eng.pdf) ·
[30-day IRN advisory](https://einvoice6.gst.gov.in/content/revised-time-limit-for-e-invoice-reporting-for-businesses-with-aato-of-%E2%82%B910-crores-above/) ·
[56th GST Council, 03-09-2025](https://gstcouncil.gov.in/sites/default/files/2025-09/press_release_press_information_bureau_0.pdf)

**Clinical workflow** — [Irving et al., BMJ Open 2017, international consultation length](https://pmc.ncbi.nlm.nih.gov/articles/PMC5695512/) (PMID 29118053) ·
[EMR perceptions, Ujjain, BMC Health Serv Res 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12087044/) ·
[Barriers to EMR usage, Indian J Community Med](https://pmc.ncbi.nlm.nih.gov/articles/PMC7467200/) ·
[Maharashtra PHC OPD volumes](https://pmc.ncbi.nlm.nih.gov/articles/PMC10122341/) ·
[WISN workforce analysis, Hum Resour Health 2021](https://human-resources-health.biomedcentral.com/articles/10.1186/s12960-021-00687-9) ·
JAMA 2026, Ambient Clinical Documentation Collaborative (8,581 clinicians) ·
JAMA Netw Open Aug 2025, doi 10.1001/jamanetworkopen.2025.28056 ·
NEJM Catalyst CAT.25.0040 (Kaiser/TPMG) · npj Digital Medicine 2026, PMID 41866429 ·
HiACC Hinglish ASR corpus, PMC12329218

**Market evidence (read 2026-08-22)** — [Practo Pro](https://play.google.com/store/apps/details?id=com.practo.droid&hl=en_IN) ·
[HealthPlix SPOT](https://play.google.com/store/apps/details?id=com.healthplix.spot&hl=en_IN) ·
[Eka Doc](https://play.google.com/store/apps/details?id=eka.care.doctor&hl=en_IN) ·
[Bajaj Health for Doctor](https://play.google.com/store/apps/details?id=com.drx&hl=en_IN) ·
[DocEngage pricing](https://www.docengage.in/pricing) ·
[HealthPlix marketing](https://md.healthplix.com/)

**Internal** — `packages/db/src/schema/clinical-encounters.ts` · `packages/api/src/routers/opd.ts` ·
ADRs [0002](../contributing/decisions/0002-no-fallback-scope.md),
[0005](../contributing/decisions/0005-fire-and-forget-audit.md),
[0020](../contributing/decisions/0020-double-entry-posting-in-billing-transactions.md),
[0022](../contributing/decisions/0022-care-settings-are-separate-destinations.md),
[0023](../contributing/decisions/0023-charges-hang-off-the-clinical-encounter.md),
[0024](../contributing/decisions/0024-remove-generic-ai-chat.md) ·
[project intent](../contributing/project-intent.md) · [roadmap](../02-roadmap-decisions.md)
