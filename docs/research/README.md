# Research ledger

Research is evidence, not current product truth. Accepted conclusions live in
[Product](../product.md), [Architecture](../architecture.md), active
[specs](../specs/), or the [decision log](../decisions.md). Observation notes
removed after their conclusions are promoted remain available in Git history;
the first documentation consolidation is commit `35550b9`.

Active temporary memos:

- [Treatment plans and advances](./treatment-plans-and-advances.md) — Marley,
  Open Dental, Jane, Cliniko, Odoo, Ind AS 115 and CGST Rules 50–51 read
  2026-09-14; supports a course parent, delivery-based Charges on ordinary OPD
  sittings, and unearned money as a liability; does not settle GST voucher
  particulars or the RCT earning milestone (CA questions). Evidence for the
  [active spec](../specs/treatment-plans-and-advances.md).
- [Invitation account onboarding](./invitation-account-onboarding.md) — proposal
  from 2026-09-07, checked against Better Auth 1.7.2; recommends invitation-gated
  email verification before account setup. Deferred on 2026-09-08: no email
  provider exists, so the shipped MVP uses the invitation id as proof (D006).
- [Frontend patterns](./frontend-patterns.md) — Midday and OpenStatus pinned;
  establishes that Midday runs _without_ React Compiler while HMS runs with it,
  keeps the one unbuilt item (oRPC batching) and the unmeasured `useSearch`
  selector sites, and records what is rejected and why. Consolidates five
  2026-08-31/09-01 memos.
- [OPD reference flows](./opd-reference-flows.md) — Marley and OpenMRS pinned;
  what OPD means as a care setting, the unbuilt direct-service hypothesis, and
  the IPD territory map. Consolidates two 2026-08-24/25 memos.
- [Reference financial integrity and catalog](./reference-financial-integrity-and-catalog.md)
  — Bahmni, Danphe, and Marley pinned 2026-09-03; establishes that no reference
  has a request key for financial retries (D023 is ahead of peers), that both
  peers with a real design keep one thin billable item and link domain masters
  to it, and what that means for pharmacy/lab/IPD masters, roles, no-show, and
  day-close shapes.
- [Landing page composition](./landing-page-composition.md) — Cursor, Slack,
  Midday, Ramp and six practice/hospital-management sites observed 2026-09-04;
  establishes that a trust strip sits directly under the hero in 4 of 4
  design-led references, that the healthcare tier fills that slot with volume
  numbers and regulatory badges rather than customer logos, that four of six
  healthcare references barely show the product at all, and that pricing stays
  off the landing page. Composition only — it proves norms, not conversion.
- [Landing header anatomy](./landing-header-anatomy.md) — Cursor, Midday, Tebra
  and Jane read 2026-09-04; establishes that both tiers ship wordmark + one to
  four doors + two or three right-hand actions, that the design-led tier ends on
  a self-serve primary while every healthcare reference books a demo from the
  bar itself, that healthcare product menus segment by who is buying and not
  only by feature, and that nobody ships a four-item door. Norms only.
- [Public site: search and AI visibility, performance, pages, contact](./public-site-seo-ai-and-pages.md)
  — Google, OpenAI, Anthropic, Perplexity, Apple, MeitY, MCA and web.dev read
  2026-09-05; establishes that Google Search does not read `llms.txt`, that the
  only AI-specific lever is a per-purpose robots policy, that every product
  screenshot is an unindexable CSS background, that DPDP notice/contact duties
  commence 2027-05-13 while SPDI r4 applies now, and that Incorporation Rules
  r26 already requires name/CIN/registered office/contact on the home page.
  Recommends WhatsApp-first contact. Lists the five owner decisions it cannot
  make.

- [Reference payment methods and payers](./reference-payment-methods-and-payers.md)
  — Bahmni, Danphe, and Marley pinned 2026-09-03; establishes that modelling an
  insurer or scheme as a payment-method value makes an unpaid bill read as
  settled (Bahmni seeds RSBY as a cash journal), that both peers with a payer
  model post the payer's share to a separate receivable at invoice time and split
  it per line by percentage, and that no reference ships a cheque clearing
  account. Records why HMS keeps a fixed method enum and a bounded, sum-checked
  split. It produces D029 only.

## Adopted findings

| Catalog                | A flat item master plus immutable Charge snapshots is sufficient for OPD. Satellite pricing/packages are additive later. New/follow-up Practitioner prices are first-class. Domain masters link to `catalog_items` rather than extending it (D027; reference evidence in the memo above).                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reference architecture | Keep HMS's explicit multi-tenancy and guarded router. Use Marley/FHIR-shaped typed records as donors when a workflow earns them; use Danphe/incumbent breadth as a checklist, not as architecture. Reject dynamic metadata and god-controller coupling.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Catalog                | A flat item master plus immutable Charge snapshots is sufficient for OPD. Satellite pricing/packages are additive later. New/follow-up Practitioner prices are first-class.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Paper consultation     | The signed paper scan remains the clinical source. Any AI extraction is a separate unverified draft/index requiring provenance and clinician review.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Care boundary          | One OPD Appointment handles booked and walk-in outpatient work. IPD and Emergency remain separate destinations/tables; no shared care wrapper exists yet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Queue performance      | Operational lists use tenant-leading indexes, page-first joins, stable keysets, and explicit invalidation/polling. Synthetic plans do not replace production p50/p95 measurement.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Intake UX              | Use one quiet flow: Patient, care team, explicit **When**, future date/time only for **Later**, and the same optional Services picker in both modes. Selected rows are local form intent and update immediately; quotes own only server pricing and the consultation line. Search is server-bounded to six display rows.                                                                                                                                                                                                                                                                                                                                                                                        |
| Billing documents      | The itemized supply document and Payment Receipt are different. Exempt care, taxable supply, and advance receipts require different printed treatment.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Accounting             | Atomic double-entry posting gives a defensible handover boundary without building an ERP. GST outward register is not a filing export.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| OPD status mutation    | Neither reference expects a receptionist to drive a consultation lifecycle. Marley makes appointment status read-only and derives completion from saved clinical work, sweeping missed rows to No Show nightly; Danphe has no consult states at all and lets its day-scoped queue self-empty. Both tie the transition to work the desk already does.                                                                                                                                                                                                                                                                                                                                                            |
| Navigation             | Stable task destinations suit frequent non-technical staff, but only live domains appear. OPD/IPD/Emergency use familiar labels and separate workflows.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Compliance/ABDM        | Treat ABDM as evidence-gated until facility/practitioner registration, sandbox, sale, and compliance ownership exist. Design durable identifiers and exportability early; do not claim legal sufficiency from research alone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Performance            | Public asset compression, request-local SSR context, parallel loaders, and bounded queries matter. Rejected micro-optimizations stay rejected until profiling shows a bottleneck.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Frontend adoption      | Measured 2026-08-24 on 40k seeded patients: Base UI combobox pickers, previous-data patient results, and one optimistic catalog toggle (7 ms median flip at Slow 4G versus an ≥800 ms round trip; rows needed memoization at 1,000 items) landed with a +68 B route script. The final capture narrowly missed three 110% server bounds in a noisy window; the retained evidence reports those misses separately from its ambient-drift analysis. The earlier TanStack Query 5.101 hold is resolved: HMS now typechecks on 5.102.8, and the oRPC adapter forwards Query's `AbortSignal`. Evidence: [`data/perf-midday-adoption/`](./data/perf-midday-adoption/) and [frontend patterns](./frontend-patterns.md). |
| Core-screen UX         | Keep one **New appointment** entry, explicit **Now/Later**, server-owned Now time, and one optional service-selection surface. A zero Now bill is valid and creates no financial document. Later persists selected services as dormant Charge snapshots until check-in. Leave guards, patient conflict checks, phone normalization, explicit sex, keyboard focus, bounded popups, local list search, and URL-backed closed-row filtering remain. Evidence: [OPD reference flows](./opd-reference-flows.md).                                                                                                                                                                                                     |
| Billing concurrency    | Protect the reviewed Charge set with one explicit revision on the exact care record. Row locks serialize settlement; the revision rejects the stale contender. Do not infer a version from the latest Invoice, and do not add a generic Billing Account wrapper. Evidence: [FHIR version-aware updates](https://hl7.org/fhir/R4/http.html#concurrency) and [PostgreSQL row locks](https://www.postgresql.org/docs/17/explicit-locking.html#LOCKING-ROWS).                                                                                                                                                                                                                                                       |

## Evidence anchors

The most decision-relevant external sources are retained here so consolidation
does not erase the evidence trail:

- [Marley Health patient appointments](https://marleyhealth.io/patient-appointment)
  and [clinical procedure templates](https://marleyhealth.io/docs/v13/user/manual/en/healthcare/clinical_procedure_template)
- [ERPNext taxes](https://docs.frappe.io/erpnext/taxes),
  [discounts](https://docs.frappe.io/erpnext/applying-discount), and
  [Payment Entry](https://docs.frappe.io/erpnext/payment-entry)
- [Frappe document revision checking](https://github.com/frappe/frappe/blob/5003fc56/frappe/model/document.py#L1384-L1414),
  [FHIR version-aware updates](https://hl7.org/fhir/R4/http.html#concurrency),
  and [PostgreSQL row locks](https://www.postgresql.org/docs/17/explicit-locking.html#LOCKING-ROWS)
- [React guidance on deriving render data](https://react.dev/learn/you-might-not-need-an-effect)
- [CBIC invoice rules](https://cbic-gst.gov.in/gst-invoice-rules.html) and
  [CGST Act section 31](https://cbic-gst.gov.in/hindi/CGST-bill-e.html)
- [GST Council Notification 12/2017](https://gstcouncil.gov.in/node/4433)
- [National Clinical Establishments patient rights](https://clinicalestablishments.mohfw.gov.in/sites/default/files/2023-06/3181.pdf)
- [ABDM documentation](https://docs.coronasafe.network/abdm-documentation/)

Reference repositories previously inspected: `earthians/marley`,
`opensource-emr/hospital-management-emr`, OpenMRS/Bahmni, and the pilot
hospital's incumbent HMS. Repository snapshots and live observations age
quickly; verify them again before using them for a new decision.

## Open validation

Pilot launch evidence is owned by
[Operations](../operations.md#pilot-readiness), not this research ledger.

- Measure production latency and data distribution before adding cache/index
  variants.
- Observe clinical authorship, vitals, orders/results, and retention requirements
  before designing those domains.

## Adding research

Start with a question that could change a current decision. Prefer primary or
owner sources, record what the evidence does and does not prove, and end with a
falsification step. Update this ledger rather than creating a new memo unless
the raw observation set is too large to review in a pull request; after a
decision, promote the conclusion and remove the temporary memo.
