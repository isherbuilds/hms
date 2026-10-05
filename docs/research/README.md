# Research ledger

Research is evidence, not current product truth. Accepted conclusions live in
[Product](../product.md), [Architecture](../architecture.md), active
[specs](../specs/), or the [decision log](../decisions.md). Observation notes
removed after their conclusions are promoted remain available in Git history;
the first documentation consolidation is commit `35550b9`.

## Research notes

These notes retain dated evidence and open questions. They do not schedule
implementation; the [work registry](../README.md#work-lifecycle) owns that status.

- [Invitation account onboarding](./invitation-account-onboarding.md) — proposal
  checked against Better Auth 1.7.2; recommends invitation-gated email
  verification before account setup. Deferred until an email provider exists;
  the shipped MVP uses the invitation id as proof (D006).
- [Frontend patterns](./frontend-patterns.md) — Midday and OpenStatus pinned;
  Midday runs _without_ React Compiler while HMS runs with it. Holds the one
  unbuilt item (oRPC batching), the unmeasured `useSearch` selector sites, and
  what is rejected and why.
- [OPD reference flows](./opd-reference-flows.md) — Marley and OpenMRS pinned;
  what OPD means as a care setting, the unbuilt direct-service hypothesis, and
  the IPD territory map.
- [Pharmacy reference flows](./pharmacy-reference-flows.md) — Bahmni, Danphe,
  and Marley observed 2026-09-18; the shared item, batch, movement-ledger,
  FEFO, and return-to-original-batch shape the pharmacy spec adopts.
- [Supplier bill reconciliation](./supplier-bill-reconciliation.md) — 17 populated
  Indian B2B invoice artifacts inspected 2026-10-04; 15 fit stock lines plus
  rounding, two need separately taxed freight/packing. D060 accepts tax-aware
  non-stock adjustments distinct from settlement offsets; includes the exact
  unimplemented receiving brief. Public uploads are not pilot-supplier evidence.
- [Hospital inventory models](./hospital-inventory-models.md) — stock ownership,
  movement history, receiving, and return boundaries observed 2026-09-18.
- [Pharmacy item master](./pharmacy-item-master.md) — ERPNext, Odoo/Bahmni,
  Danphe, OpenEMR, OpenBoxes and Marg checked 2026-09-28; direct product/item
  billing informed the goods/services split. Its former no-loose-sale premise
  was replaced by the packs and loose-units contract on 2026-09-29.
- [Goods, services, pharmacy and OPD comparison](./goods-services-pharmacy-opd-comparison.md) —
  Marg ERP and Books, Marley/ERPNext, Bahmni, GNU Health and OpenEMR checked
  2026-09-29; separates common stock/service behavior from table design and
  names the pilot checks behind the implemented goods/services and unit contracts.
- [Hospital-wide financial reports](./hospital-wide-financial-reports.md) —
  ERPNext, Tally and CBIC checked 2026-09-23; proposes one all-stream invoice
  register beside per-stream series (D025 unchanged) and names the CA questions
  to answer before a reporting spec.
- [Medicine-name sources](./medicine-name-sources.md) — Indian catalogs probed
  2026-09-24 against the pilot shelf and mainstream brands. Medbuzz and
  Truemeds are merged for browser-fetched suggestions; Medbuzz has no
  published terms and Truemeds forbids automated access. Written permission
  is required before commercial launch (D046).
- [Landing page composition](./landing-page-composition.md) and
  [landing header anatomy](./landing-header-anatomy.md) — design-led and
  healthcare sites observed 2026-09-04; composition and header norms cited by the
  landing components. Norms only, not conversion evidence.
- [Design system](./design-system.md) — audience, shape, dashboard, public
  site, colour and performance lenses checked 2026-10-02 against peer design
  systems, WCAG/SAFER/NICE and the current code. Keeps the core system;
  proposes a 2/4/6/10/14 px radius scale, contrast and font-subset fixes, and
  names the open P0 safety gap (allergy unknown shown as none). The 12 px body size awaits a staff density test.

## Adopted findings

### Catalog

Services use a flat catalog. Products own their stock identity and sale facts. Both produce immutable Charge snapshots; pharmacy Charges reference their batch instead of a copied service row (D027, D049).

### Reference architecture

Keep HMS's explicit multi-tenancy and guarded router. Use Marley/FHIR-shaped typed records as donors when a workflow earns them; use Danphe/incumbent breadth as a checklist, not as architecture. Reject dynamic metadata and god-controller coupling.

### Paper consultation

The signed paper scan remains the clinical source. Any AI extraction is a separate unverified draft/index requiring provenance and clinician review.

### Care boundary

One OPD Appointment handles booked and walk-in outpatient work. IPD and Emergency remain separate destinations/tables; no shared care wrapper exists yet.

### Queue performance

Operational lists use tenant-leading indexes, page-first joins, stable keysets, polling, and global write invalidation (D036). Synthetic plans do not replace production p50/p95 measurement.

### Intake UX

Use one quiet flow: Patient, care team, explicit **When**, future date/time only for **Later**, and the same optional Services picker in both modes. Selected rows are local form intent and update immediately; quotes own only server pricing and the consultation line. Search is server-bounded to six display rows.

### Billing documents

The itemized supply document and Payment Receipt are different. Exempt care, taxable supply, and advance receipts require different printed treatment.

### Accounting

Atomic double-entry posting gives a defensible handover boundary without building an ERP. GST outward register is not a filing export.

### OPD status mutation

Neither reference expects a receptionist to drive a consultation lifecycle. Marley makes appointment status read-only and derives completion from saved clinical work, sweeping missed rows to No Show nightly; Danphe has no consult states at all and lets its day-scoped queue self-empty. Both tie the transition to work the desk already does.

### Navigation

Stable task destinations suit frequent non-technical staff, but only live domains appear. OPD/IPD/Emergency use familiar labels and separate workflows.

### Compliance/ABDM

Treat ABDM as evidence-gated until facility/practitioner registration, sandbox, sale, and compliance ownership exist. Design durable identifiers and exportability early; do not claim legal sufficiency from research alone.

### Performance

Public asset compression, request-local SSR context, parallel loaders, and bounded queries matter. Rejected micro-optimizations stay rejected until profiling shows a bottleneck.

### Frontend adoption

Measured 2026-08-24 on 40k seeded patients: Base UI combobox pickers, previous-data patient results, and one optimistic catalog toggle (7 ms median flip at Slow 4G versus an ≥800 ms round trip; rows needed memoization at 1,000 items) landed with a +68 B route script. The final capture narrowly missed three 110% server bounds in a noisy window; the retained evidence reports those misses separately from its ambient-drift analysis. The earlier TanStack Query 5.101 hold is resolved: HMS now typechecks on 5.102.8, and the oRPC adapter forwards Query's `AbortSignal`. Evidence: [`data/perf-midday-adoption/`](./data/perf-midday-adoption/) and [frontend patterns](./frontend-patterns.md).

### Core-screen UX

Keep one **New appointment** entry, explicit **Now/Later**, server-owned Now time, and one optional service-selection surface. A zero Now bill is valid and creates no financial document. Later persists selected services as dormant Charge snapshots until check-in. Leave guards, patient conflict checks, phone normalization, explicit sex, keyboard focus, bounded popups, local list search, and URL-backed closed-row filtering remain. Evidence: [OPD reference flows](./opd-reference-flows.md).

### Billing concurrency

Protect the reviewed Charge set with one explicit revision on the exact care record. Row locks serialize settlement; the revision rejects the stale contender. Do not infer a version from the latest Invoice, and do not add a generic Billing Account wrapper. Evidence: [FHIR version-aware updates](https://hl7.org/fhir/R4/http.html#concurrency) and [PostgreSQL row locks](https://www.postgresql.org/docs/17/explicit-locking.html#LOCKING-ROWS).

### Treatment plans

Open Dental, Cliniko, and dental coding post a multi-sitting fee on delivery and hold earlier money as a liability; Ind AS 115 agrees but leaves the earning milestone for a one-fee RCT to the accountant (D033–D035). Only Frappe Health's derived session count was copied.

### Financial retries

HMS has no request key. Row locks, Charge revisions, and document uniqueness do not prevent every duplicate after a lost response. Staff check the record before retrying and use correction documents for confirmed duplicates (D039).

### Payer model

Modelling an insurer as a payment method makes an unpaid bill read as settled (Bahmni seeds RSBY as cash). Peers with a payer model post the payer share to a separate receivable at Invoice time; none ships a cheque clearing account (D029).

### Public site

Google Search ignores `llms.txt`; the only AI lever is a per-purpose robots policy. Screenshots as CSS backgrounds are unindexable. DPDP notice duties commence 2027-05-13, SPDI r4 applies now, and Incorporation Rules r26 require an identity block on the home page. WhatsApp-first contact.

### Staff guide framework

Keep Fumadocs on Astro for `apps/fumadocs`; Blume was checked 2026-10-02 and not adopted. Both are MIT, Astro-capable, and cover static Orama search, Takumi OG cards, `llms.txt`, and subpath builds. Blume 2.1.0 ([npm](https://registry.npmjs.org/blume/latest)) replaces the app with a CLI-generated, hidden Astro project; it is three months old (first real release 2026-06-30, roughly 1.1k of its commits by one author, 122k weekly downloads). Fumadocs 16.15.17 has been published since 2024-01 and gets 2.2M weekly downloads ([GitHub](https://api.github.com/repos/fuma-nama/fumadocs), [npm](https://api.npmjs.org/downloads/point/last-week/fumadocs-core)). HMS owns about 293 lines of Fumadocs integration for 7 pages, so Blume would remove little code. It would add a migration done by a coding agent (`meta.json` → `meta.ts`, Callouts → directives), require new checks for the `/docs` Nitro bundle and noindex header, and bring a younger dependency. Fumadocs also offers MCP tools, versioning, locales, and API references ([headless](https://www.fumadocs.dev/docs/headless)); Blume's difference is that these are set in config instead of wired as app code, and it adds an in-page assistant plus `translate`, `audit`, and `eval` commands. None of these is a current need. Revisit if the guide needs several of those features at once and wiring them in Fumadocs would cost more than migrating, or if Fumadocs's Astro support stalls. Comparison claims come from [Blume's own page](https://useblume.dev/compare/fumadocs) and its [migration playbook](https://raw.githubusercontent.com/haydenbleasel/blume/main/skills/blume-migrate/references/fumadocs.md).

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
