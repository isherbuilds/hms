# Paper-first consultation workflow

## Question

For a pilot where doctors do not have application logins and continue writing paper prescriptions,
should the HMS require a structured digital consultation, store a prescription image, or create the
consultation through AI?

## Answer

Use a **paper-first record** for v0. The doctor continues writing and signing the prescription; an
authorized staff member links a scan/photo to the visit and records only minimal operational metadata.
The image is the clinical source document. Do not let staff or AI create, finalize, or present a new
prescription as though the doctor authored it.

AI may later extract a draft index (medicines, advice, diagnosis text) to make records searchable, but
the extracted fields must remain visibly unverified until a responsible clinician reviews them. They
must never replace or silently modify the source image.

## Evidence

- The National Medical Commission's published Code of Medical Ethics says a physician's registration
  number belongs on prescriptions and, in high-load government hospitals, the prescribing doctor's
  name is written below the signature. This supports preserving the doctor's authored/signed artifact
  rather than allowing a clerk or AI to originate it:
  <https://www.nmc.org.in/rules-regulations/code-of-medical-ethics-regulations-2002/1000/>.
- ABDM describes prescriptions and OP consultations as distinct health-information record types, and
  its FAQ explicitly recognizes scanned medical records and consent-controlled storage/sharing. A
  prescription image can therefore be a useful record without pretending it is a structured digital
  consultation: <https://abdm.gov.in/FAQ> and <https://abdm.gov.in/DHIS>.
- WHO guidance says humans should remain in control of medical decisions and that AI use needs
  responsibility, accountability, safety evaluation, and appropriate supervision. WHO separately
  warns that health-related LLM output can be plausible but seriously wrong. This supports AI-assisted
  extraction, not autonomous prescription generation:
  <https://www.who.int/news/item/28-06-2021-who-issues-first-global-report-on-ai-in-health-and-six-guiding-principles-for-its-design-and-use>
  and <https://www.who.int/news/item/16-05-2023-who-calls-for-safe-and-ethical-ai-for-health>.
- The earlier consultation proposal required a digitally signed note to be finalized by the visit's
  linked practitioner but did not solve the pilot's lack of doctor logins. Proxy signing would change
  clinical authorship rather than solve that workflow constraint. The ready spec is amended with the
  paper-first decision captured here.

## What this proves / does not prove

This proves that a scanned, physician-authored prescription is a defensible low-change product shape
and that autonomous AI prescription generation creates an accountability mismatch. It does not prove
that an image alone satisfies every record-retention, pharmacy, consent, or state-specific requirement.
The hospital should confirm those obligations with its compliance adviser before rollout.

## What this means for us

The smallest coherent v0 is:

1. Front desk creates the visit as today.
2. After the appointment, staff uploads one or more private prescription pages against the visit.
3. The Visit supplies the practitioner and encounter date; immutable upload metadata records who
   captured the document and when. The image itself remains the source record.
4. Staff can open/reprint the source document. Replacing a bad scan creates a new version or audited
   supersession rather than editing history.
5. Structured consultation notes, line-item prescriptions, addenda, proxy signing, and generated A5
   prescriptions stay out of the pilot unless a doctor-facing workflow is validated.
6. An AI extraction experiment may populate a separate draft/index with source-image provenance and
   confidence, but it cannot sign, prescribe, or become patient-facing without clinician review.

This reuses the existing private files boundary and removes the current need for `consult:sign`,
`signedBy`, prescription-line editing, investigation-line editing, addenda, and the generated Rx print
route from the pilot path.

## Next falsification

Run a one-day paper-to-record pilot with one receptionist and one doctor. Measure: time to capture a
two-page prescription, unreadable/retake rate, ability to find and reprint it later, and whether billing
needs any structured field from the paper. Only retain structured consultation fields that a named
downstream workflow actually consumes.

## Sources

- National Medical Commission, Code of Medical Ethics Regulations, 2002:
  <https://www.nmc.org.in/rules-regulations/code-of-medical-ethics-regulations-2002/1000/>
- Ayushman Bharat Digital Mission FAQ: <https://abdm.gov.in/FAQ>
- ABDM Digital Health Incentive Scheme: <https://abdm.gov.in/DHIS>
- WHO, ethics and governance principles for AI in health:
  <https://www.who.int/news/item/28-06-2021-who-issues-first-global-report-on-ai-in-health-and-six-guiding-principles-for-its-design-and-use>
- WHO, caution on LLMs in health:
  <https://www.who.int/news/item/16-05-2023-who-calls-for-safe-and-ethical-ai-for-health>
