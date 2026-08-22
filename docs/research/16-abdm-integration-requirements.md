# 16 — ABDM integration requirements for an Indian HMS

Researched: 2026-08-22 (all URLs accessed this date unless noted). Web research only; no code changed.
Scope set by requester: official sources only (abdm.gov.in, sandbox.abdm.gov.in, docs.abdm.gov.in, NHA, NRCeS). Non-official items are marked **[non-official]**.

## Question

What must hospital management software implement to be "ABDM enabled": milestones M1–M3(+M4), whether integration is mandatory or incentivized, the registries, the NRCeS FHIR profiles, the API surface, and what changed by 2025–2026?

## Answer (lead)

ABDM participation is **voluntary** and pushed through incentives (DHIS, active through September 2026). An HMS becomes ABDM-enabled by clearing three sandbox milestones — M1 (ABHA creation/verification), M2 (HIP record sharing), M3 (HIU consent-based retrieval) — then registering each facility in HFR and taking production keys from NHA. Data exchange is FHIR R4 using the NRCeS "FHIR Implementation Guide for ABDM" (published v6.5.0, May 2025; v7.0.0 draft preview July 2026). A fourth milestone (M4) exists on official dashboards/newsletters but has **no published definition on any .gov.in page we could find**; vendors describe it as NHCX claims integration. The API surface moved to a v3 set (synchronous discovery, linking token at profile share) hosted behind a new sandbox portal; legacy `sandbox.abdm.gov.in/docs/*` paths now return HTTP 503.

## 1. Milestones M1, M2, M3 (+ M4)

Canonical definition — NHA _HIP-HIU Guidelines_ PDF (accessed 2026-08-22):
https://abdm.gov.in/strapicms/uploads/HIP_HIU_Guidelines_f85df336ec.pdf

> "To integrate with the ABDM ecosystem, there are three levels of integration which are also called 'milestones':
> • Milestone 1 (M1): ABHA Number creation and capture & verification for seamless patient registration.
> • Milestone 2 (M2): Building Health Information Provider (HIP) services to share digital records via Personal Health Records (ABHA) app.
> • Milestone 3 (M3): Developing Health Information User (HIU) services to provide view of patient's medical history to authorized healthcare workers with complete consent"

Same document on who must do what:

> "The HMIS/LMIS needs to be ABDM compliant and shall be compliant with at least M2 milestone of ABDM Integration i.e. HIP. In M3 ABDM integration, the HMIS/LMIS acts as a HIU."

> "…integration at M1 (ABHA ID Creation and Linkages) /M2 (Health Information Provider-HIP) /M3 (Health Information User – HIU) milestones"

NHA's own wrapper repo states it tersely (official NHA GitHub org, accessed 2026-08-22): https://github.com/NHA-ABDM/ABDM-wrapper

> "Milestone 1: ABHA Id creation, verification and obtaining link token · Milestone 2: Linking and exporting health data · Milestone 3: Sending a consent request and importing data from other applications in the ecosystem"

DHIS Corrigendum 5 (19 Feb 2025) ties milestone stages to incentive eligibility and restates the role mapping:
https://abdm.gov.in/strapicms/uploads/Corrigendum_5_to_DHIS_36d146fed0.pdf

> "For a Health Facility/Clinic each transaction should be done on a system integrated with ABDM ecosystem till M3 stage (i.e., after it starts playing the role of Health Information User or HIU in ABDM). For a Diagnostic Facility/ Lab/ Pharmacy, a transaction done on a system integrated with ABDM ecosystem till M2 stage (i.e., after it starts playing the role of Health Information Provider or HIP in ABDM) will also be considered…"

### What software must implement per milestone

| Stage        | Must implement                                                                                                                                                                                                                                                                               | Official source                                                                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **M1**       | Create ABHA number & address (Aadhaar OTP, mobile OTP; demographic/demo-auth only for trusted/govt entities); verify ABHA presented by patient (Aadhaar OTP, mobile OTP, biometric, mobile-number lookup); link ABHA number ↔ address. Scan & Share runs once M1 is done.                    | Sandbox test-case catalogue mirrored at https://kiranma72.github.io/abdm-docs/11-test-cases/milestone-1/index.html **[non-official mirror]**; Scan&Share FAQ below |
| **M2 (HIP)** | Discover care contexts; notify/link every new health record to the patient's ABHA address (user-initiated linking + HIP-initiated linking incl. deep-link SMS); share records on consented request as FHIR R4 bundles; support consent revocation, ABHA-address deletion, uptime heartbeats. | https://kiranma72.github.io/abdm-docs/1-basics/making_your_app_abdm_compliant/index.html **[mirror]**; HIP duties quoted in HIP-HIU Guidelines PDF above           |
| **M3 (HIU)** | Raise consent requests; store signed consent artefacts; fetch records from HIPs; display them. Consent lives on the HIE-CM; revocation must be honoured.                                                                                                                                     | HIP-HIU Guidelines PDF; https://kiranma72.github.io/abdm-docs/4-milestone3/index.html **[mirror]**                                                                 |
| **HFR**      | In production the facility must first register and be approved on HFR; the HFR ID becomes the HIP ID used for bridge linking.                                                                                                                                                                | Guidance Document quote below                                                                                                                                      |

FHIR record types expected at M2 (Guidance Document for ABDM Compliant HMIS/LMIS, accessed 2026-08-22): https://abdm.gov.in/strapicms/uploads/Guidance_Document_for_ABDM_Compliant_HMIS_LMIS_d066e52a6d.pdf — "Following records should be FHIR Compliant: Health Document Record · Discharge summary · OP Consultation · Diagnostic · Immunization · Wellness Record · Prescription."

Production gating, same document:

> "In production, the HIP services are registered via HFR. Any facility on prod needs to be first registered and approved on HFR and then they can apply to become an HIP. This HIP ID can now be used for the linking with bridge."

Scan & Share dependency (official FAQ, accessed 2026-08-22): https://abdm.gov.in/scan-share/faqs

> "Although Scan and Register services run when the HMIS is integrated with M1 milestone of ABDM, it is desirable that the HMIS solution integrates across all the three milestones of ABDM so that the health records created are linked to the ABHA of the patients."

Minimum product bar for hospitals (MVP Guidance Document v2.0, accessed 2026-08-22): https://abdm.gov.in/strapicms/uploads/Approved_MVP_Document_Version_2_0_4a85e329f9.pdf — mandatory for Hospital HMIS: ABHA creation + verification native to the system, record linking against ABHA, exchange of records with other compliant solutions, view of records shared by others, compliance with the Consent Manager and ABDM APIs, OPD registration/billing/discharge summary/IPD modules, transport encryption + audit trail per the Health Data Management Policy. Structured FHIR profiles were "to be mandated in future" in that version; unstructured FHIR was already mandatory.

### M4

Official appearances only as a label: ABDM Newsletter Apr–Jun 2025 counts integrators under "Milestones Achieved by Integrators: M1, M2, M3, M4" (https://abdm.gov.in/strapicms/uploads/ABDM_Newsletter_April_to_June_2025_revised_color_a2b033f077.pdf) and https://abdm.gov.in/hmis-lite shows "ABDM Enabled Milestones: M1-M4". **We found no .gov.in page defining M4.** Vendor blogs describe M4 as National Health Claims Exchange (NHCX) integration — e.g. https://nirmitee.io/blog/abdm-integration-milestones-m1-m2-m3-m4-multi-software-guide/ **[non-official]**. NHCX has its own live portal: https://nhcx.abdm.gov.in.

## 2. Mandatory or incentivized?

**Voluntary, incentivized.** Official FAQ (accessed 2026-08-22): https://abdm.gov.in/FAQ

> "Is enrolling on ABDM compulsory? No. Participation in ABDM is voluntary including for citizens. Participation of a healthcare facility or an institution is also voluntary and shall be taken by the respective management (government or private management). However, once the management decides to register … it is essential for all the healthcare professionals serving the said facility/institution to register in Healthcare Professionals Registry…"

HFR SOP likewise disclaims any regulatory force: "HFR is not mandated to regulate or set standards for the facilities" (https://abdm.gov.in/strapicms/uploads/Health_Facility_Registry_SOP_b40e4bb9be.pdf).

The lever is money: the **Digital Health Incentives Scheme (DHIS)**.

- Announced 22 Dec 2022; operational from 01 Jan 2023. Operational Guidelines, 17 Jan 2023 (full text extracted): https://abdm.gov.in/static/media/OperationalGuidelinesDHIS.a35651cdf843e0b399c2.pdf
  - Eligibility: facilities ≥10 beds registered in HFR with IPD; labs/imaging centers registered in HFR; DSCs holding production keys "for all three milestones (M1, M2 and M3)" (M3 waived for health lockers).
  - Counting rules: max 1 transaction/day and 5/month per ABHA address; +20% incentive for QCI-certified DSCs; claims monthly via HFR/Sandbox portal.
- Amended by corrigenda dated 16 Mar 2023, 29 Jul 2023, 13 Dec 2023, 11 Jun 2024, 19 Feb 2025, 20 Nov 2025; canonical list at https://abdm.gov.in/dhis (page is JS-rendered).
- Corrigendum 5 (19 Feb 2025, URL above): financial outlay **Rs 120 crore**; minimum threshold 100 eligible transactions/month; back-dated claims limited to 3 months; tokens generated outside 05:00–20:00 not counted without approval.
- **Corrigendum 7 — currently in force April–September 2026**: https://abdm.gov.in/strapicms/uploads/DHIS_corrigendum_7_c1d7e09cc2.pdf
  - Incentivizes **KYC-linked records only**; no more Scan&Share or health-locker incentives.
  - Rates: Category 1 (HI types other than Diagnostic Report/Discharge Summary) **Rs 10** facility / **Rs 5** DSC per transaction above the 100 baseline; Category 2 (Diagnostic Report or Discharge Summary) **Rs 5** / **Rs 2.5**.
  - Consent-based sharing: **₹10 to the HIU + ₹5 to the source HIP/locker** per successful record share.
  - NHCX claims: Rs 200 per claim or 10% of claim amount (lower) to the facility; Rs 10 per claim to the DSC; capped Rs 1 crore; scheme-wide cap Rs 5 crore per entity.
  - Mandates migration to **v3 APIs**: "the software of every digital solution company gets integrated with the APIs of v3 version of ABDM for all the three milestones", with a compliance window April–June 2026.
- Scheme extensions along the way (example, Sept 2023 digest): "DHIS has been extended till December 31, 2023" (https://abdm.gov.in/strapicms/uploads/DIGITAL_HEALTH_DIGEST_Sept_final_version_2_c6418bad44.pdf).

Related certification track: QCI-NABH "Certification of ABDM Enabled Health Solutions (CAHS)" digital + site assessment — https://abdm.gov.in/qcicertified.

## 3. Registries and what an HMS integrates with

Adoption scale, MoHFW written reply, 11 Feb 2025: https://mohfw.gov.in/?q=pressrelease-209 — "73,98,09,607 ABHA have been created, 3,63,520 health facilities have registered on HFR, 5,64,851 healthcare professionals have registered on HPR, 1,59,020 health facilities are using an ABDM-enabled software and 49,06,02,540 (~49.06 Cr) health records have been linked with ABHA." Same release names a drug registry as an emerging component.

| Registry                                                                                              | Portal (probed 2026-08-22)                                                                                                                               | HMS integration surface                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ABHA numbers** (patient identity; 14-digit number + `@` address)                                    | https://abha.abdm.gov.in (301→app); sandbox ABHA APIs historically at `healthidsbx.ndhm.gov.in`/`healthidsbx.abdm.gov.in` (both unreachable when probed) | M1: ABHA creation, verification, linking APIs; store ABHA number/address on the patient record                                                                                                                                          |
| **HPR** — Healthcare Professionals Registry (verified doctors/nurses, council-reg no.)                | https://hpr.abdm.gov.in and https://nhpr.abdm.gov.in (`hpr.` 301-redirects into the unified NHPR portal `/nhpr/v4`)                                      | Verify practitioners' HPR IDs; required context for Scan&Share QR generation and signing records; sandbox HPR APIs exist for integrators                                                                                                |
| **HFR** — Health Facility Registry (all facility types, 12-digit alphanumeric IDs, verifier workflow) | https://facility.abdm.gov.in and https://hfr.abdm.gov.in (both 301-redirect to https://nhpr.abdm.gov.in/)                                                | Register each physical facility, pass district-verifier approval, obtain HFR ID → becomes the production **HIP ID**; generate facility QR codes; SOP: https://abdm.gov.in/strapicms/uploads/Health_Facility_Registry_SOP_b40e4bb9be.pdf |

Note the consolidation signal: facility, professional, and provider portals all land on one NHPR application as of Aug 2026.

## 4. NRCeS FHIR profiles

Yes — official Indian profiles exist and are maintained for NHA by NRCeS (C-DAC Pune).

- **Current published:** _FHIR Implementation Guide for ABDM_, package `ndhm.in`, **v6.5.0**, FHIR R4, generated 2025-05-08, publication status "Draft": https://nrces.in/ndhm/fhir/r4/ (downloads: https://www.nrces.in/ndhm/fhir/r4/downloads.html, marked "active").
- **Next version in CI build:** v7.0.0 draft, generated 2026-07-15: https://nrces.in/preview/ndhm/fhir/r4/index.html
- Scope: "defines the minimum conformance requirements for accessing health data to achieve continuity of care in the Indian context", referencing EHR Standards for India 2016, NDHB, MCI/PCI, NHCX. Profiles cover Patient, Practitioner, Organization, Composition types (OPConsultation, DischargeSummary, Prescription, WellnessRecord…), DiagnosticReport, ImmunizationRecord etc.
- Lineage: NDHM IG v1.x (Feb 2021) → ABDM IG v2.0.1 (Nov 2021) → current 6.x line (version list renders client-side; https://nrces.in/ndhm/fhir/r4/history.html shows no server-rendered entries).
- Code samples: https://github.com/HL7India/nrces-fhir-samples (Java). SDKs/support via https://www.nrces.in/services/tools-and-technologies, nrc-help@cdac.in.

## 5. API surface and the enablement flow

Building blocks (HIP-HIU Guidelines PDF + sandbox material): ABHA service, Gateway, HIE-CM (**consent manager** — stores consents, mediates exchange), registries (HFR/HPR), PHR apps / health lockers, plus optional UHI and NHCX rails.

Roles:

- **HIP** — creates/stores/distributes records (a hospital running your HMS is the HIP; technically the facility registered in HFR).
- **HIU** — requests/views records with consent (the same hospital usually also wants this: M3).
- **CM (HIE-CM)** — holds consent artefacts; patients grant/revoke in their PHR app (e.g. ABHA app).
- **Gateway** — routes discovery/linking/consent/data-transfer calls between HIPs, HIUs, CM.

Flow an HMS implements to go live:

1. Register on the sandbox portal (now https://sandbox.abdm.gov.in/sandbox/v3) → client ID/secret.
2. Implement **M1** ABHA APIs (create/verify/link) against sandbox ABHA service.
3. Implement **M2** HIP: register a public **bridge** callback host with ABDM; handle care-context discovery, user-initiated linking, HIP-initiated linking, profile-share (Scan & Share), consent-artefact validation, encrypted FHIR bundle delivery; package data per NRCeS profiles; E2E encryption per ABDM's Fidelius scheme (ECDH Curve25519 + AES-256-GCM).
4. Implement **M3** HIU: consent request/init, notify callbacks, fetch, decrypt, display.
5. Sandbox exit testing against NHA test harness → security audit (WASA/API vulnerability testing by STQC/CERT-IN-empanelled agency, per https://abdm.gov.in/qcicertified) → NHA issues production keys.
6. Register each facility in **production HFR**; HFR ID becomes the HIP ID; link facility to bridge; generate QR codes.

Environment facts observed across official artifacts:

- Header `X-CM-ID`: `sbx` in sandbox, `abdm` in production (NHA-ABDM/ABDM-wrapper README: https://github.com/NHA-ABDM/ABDM-wrapper).
- Gateway hosts seen in integrator configs: `dev.abdm.gov.in` (sandbox) and `live.abdm.gov.in` (production); `live.abdm.gov.in/api/global/lgd/v3` is referenced inside the official sandbox SPA bundle itself. **[endpoints cross-checked via dimagi/abdm-python-integrator and the community docs mirror — non-official confirmations]**
- **V3 API generation** is the current standard: synchronous patient discovery, a linking token issued at profile-share (replacing separate OTP linking), unified `/v3` session/gateway endpoints. Corrigendum 7 makes v3 compliance an incentive condition from April–June 2026 (URL in §2). Community mirror notes "V1.0 APIs are currently in production. V3 APIs are currently only available in sandbox" during the transition (https://kiranma72.github.io/abdm-docs/) **[non-official snapshot]**.
- NHA also ships an open-source wrapper abstracting HIP/HIU workflows: https://github.com/NHA-ABDM/ABDM-wrapper.

## 6. Status 2025–2026

- **Certification still active.** Sandbox exit + milestone letters continue; the Apr–Jun 2025 newsletter logs 45 newly integrated products across M1–M4 categories and weekly Tuesday technical sessions (newsletter URL in §1). QCI-NABH certification (CAHS) runs alongside (§2).
- **DHIS alive and restructured**, effective through Sep 2026 with new rates and a hard v3-API requirement (Corrigendum 7).
- **Portal churn:** sandbox root now 301-redirects to `/sandbox/v3`; every legacy doc path we tried (`sandbox.abdm.gov.in/docs`, `/docs/milestones`, `/documentation/content`) returns **HTTP 503**; `docs.abdm.gov.in` does not connect at all. Current documentation is a client-rendered SPA (`new-documentation?doc=…`), which search engines cannot index.
- **UHI:** still listed officially (https://abdm.gov.in/uhi, https://uhi.abdm.gov.in) and on the status board (https://abdm.gov.in/status-update, last updated 27/02/2026), but its GitHub repo last pushed 2024-09-05 with protocol spec 0.0.1 pre-release (https://github.com/NHA-ABDM/UHI). Treat as stalled/pilot; MVP doc lists UHI teleconsultation as "to be mandated in future".
- **Scale-up continues:** >100 crore health records linked per NHA press release (https://abdm.gov.in/press-releases); national review meetings Oct 2025 (Bhopal) and Jan 2026 (Bhubaneswar Chintan Shivir) on the same page.
- **IRDAI push:** NHA/IRDAI accelerator workshops drive insurers/TPAs through ABDM + NHCX integration (digest and press-releases pages cited above); insurance companies directed to create ABHA for policyholders (July 2023 digest).

## What we looked for and did NOT find

- **No official definition of M4** anywhere on `.gov.in`. It appears only as a dashboard/newsletter label; vendor descriptions ("NHCX") are unconfirmed by NHA text we could retrieve.
- **Original DHIS notification** (the 22 Dec 2022 scheme order) — not located; earliest artifact found is the 17 Jan 2023 Operational Guidelines. Widely reported original rates (Rs 500/record etc.) could not be verified against a primary document.
- **Legacy developer docs are dead**: `sandbox.abdm.gov.in/docs/*` → 503; `docs.abdm.gov.in` → connection failure; old swagger links printed in the Guidance Document (`healthidsbx.ndhm.gov.in/api/...`, `sandbox.abdm.gov.in/swagger/ndhm-hip.yaml`) unverifiable.
- **NRCeS version-history page** renders no version list server-side; version lineage reconstructed from search-indexed sub-pages instead.
- **No mandate for private hospitals** found anywhere official — the FAQ explicitly says voluntary. We did not audit individual state-level circulars.
- GitHub API rate-limited during probing; NHA-ABDM repo inventory incomplete (wrapper + UHI repos confirmed individually).

## What this proves / does not prove

Proves: milestone definitions, voluntariness, DHIS terms through Sep 2026, registry topology and scale, NRCeS IG location/status, v3 transition — all from primary `.gov.in`/NRCeS sources.

Does not prove: M4 scope, exact production endpoint inventory post-v3-migration (docs are JS-only now), or any state-level mandates. Sandbox content behind the SPA needs a real browser session to read verbatim.

## What this means for us (hms)

If India becomes a target market: M1 maps cleanly onto our patient model (store ABHA number/address per tenant org = facility), M2 requires per-facility HIP identity (org ↔ HFR ID) plus FHIR R4 output shaped by the NRCeS IG — a second FHIR dialect beside anything else we adopt — and M3 is optional until multi-provider record pull matters. DHIS economics (Rs 10/5 per KYC-linked record, cap Rs 5 cr) are the customer's ROI story, not ours to build. Nothing here authorizes a build decision; treat as market intel.

## Next falsification

Open `https://sandbox.abdm.gov.in/sandbox/v3/new-documentation?doc=MileStone_*` in a real browser (or ask NHA support) to capture the authoritative v3 test cases and confirm whether an M4/NHCX module is defined there; re-check `abdm.gov.in/dhis` after September 2026 for Corrigendum 8 / scheme renewal.

## Sources

Primary (accessed 2026-08-22):

1. HIP-HIU Guidelines PDF — https://abdm.gov.in/strapicms/uploads/HIP_HIU_Guidelines_f85df336ec.pdf
2. Guidance Document for ABDM Compliant HMIS/LMIS — https://abdm.gov.in/strapicms/uploads/Guidance_Document_for_ABDM_Compliant_HMIS_LMIS_d066e52a6d.pdf
3. MVP Guidance Document v2.0 — https://abdm.gov.in/strapicms/uploads/Approved_MVP_Document_Version_2_0_4a85e329f9.pdf
4. DHIS Operational Guidelines (17 Jan 2023) — https://abdm.gov.in/static/media/OperationalGuidelinesDHIS.a35651cdf843e0b399c2.pdf
5. DHIS Corrigendum 5 (19 Feb 2025) — https://abdm.gov.in/strapicms/uploads/Corrigendum_5_to_DHIS_36d146fed0.pdf
6. DHIS Corrigendum 7 (eff. Apr–Sep 2026) — https://abdm.gov.in/strapicms/uploads/DHIS_corrigendum_7_c1d7e09cc2.pdf
7. DHIS hub — https://abdm.gov.in/dhis
8. ABDM FAQ (voluntary participation) — https://abdm.gov.in/FAQ
9. Scan & Share FAQs — https://abdm.gov.in/scan-share/faqs
10. HFR SOP — https://abdm.gov.in/strapicms/uploads/Health_Facility_Registry_SOP_b40e4bb9be.pdf
11. MoHFW ABDM update (11 Feb 2025) — https://mohfw.gov.in/?q=pressrelease-209
12. ABDM press releases hub — https://abdm.gov.in/press-releases
13. ABDM Newsletter Apr–Jun 2025 — https://abdm.gov.in/strapicms/uploads/ABDM_Newsletter_April_to_June_2025_revised_color_a2b033f077.pdf
14. Digital Health Digest Sept 2023 — https://abdm.gov.in/strapicms/uploads/DIGITAL_HEALTH_DIGEST_Sept_final_version_2_c6418bad44.pdf
15. NRCeS FHIR IG for ABDM v6.5.0 — https://nrces.in/ndhm/fhir/r4/ (+ /downloads.html, /history.html; preview v7.0.0 — https://nrces.in/preview/ndhm/fhir/r4/index.html)
16. NHA-ABDM/ABDM-wrapper — https://github.com/NHA-ABDM/ABDM-wrapper
17. NHA-ABDM/UHI — https://github.com/NHA-ABDM/UHI
18. UHI site — https://uhi.abdm.gov.in/ ; https://abdm.gov.in/uhi
19. Status board — https://abdm.gov.in/status-update
20. QCI-NABH CAHS — https://abdm.gov.in/qcicertified
21. hmis-lite — https://abdm.gov.in/hmis-lite
22. Sandbox v3 portal — https://sandbox.abdm.gov.in/sandbox/v3 (SPA; legacy /docs paths HTTP 503)
23. Registry portals probed: https://nhpr.abdm.gov.in , https://hpr.abdm.gov.in (301→NHPR), https://facility.abdm.gov.in (301→NHPR), https://nhcx.abdm.gov.in (200)

Non-official, clearly labelled:

24. Community mirror of sandbox docs — https://kiranma72.github.io/abdm-docs/
25. dimagi/abdm-python-integrator (documents official endpoint hosts) — https://github.com/dimagi/abdm-python-integrator
26. HL7India/nrces-fhir-samples — https://github.com/HL7India/nrces-fhir-samples
27. Vendor analyses of M1–M4 and v3 specifics (claims about M4=NHCX, dev timelines) — https://nirmitee.io/blog/abdm-integration-milestones-m1-m2-m3-m4-multi-software-guide/ , https://cliniqwise.com/resources/abha-abdm-compliance-guide
28. Think-tank assessment of adoption gaps (no mandate exists) — https://hmpi.org/2026/07/09/from-infrastructure-to-impact-operationalizing-indias-ayushman-bharat-digital-mission/
