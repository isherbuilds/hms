# Research ledger

Research is evidence, not current product truth. Accepted conclusions live in
[Product](../product.md), [Architecture](../architecture.md), active
[specs](../specs/), or the [decision log](../decisions.md). Full observation
notes and citations from the earlier research files remain available in Git
history before the 2026-08-23 documentation consolidation.

Active temporary memos:

- [Billing PDF rendering foundation](./billing-pdf-rendering-foundation.md) —
  owner-source review of the Takumi server boundary, native layout model, font
  coverage, and remaining physical-printer/accountant validation (2026-08-27).
- [Midday dashboard patterns](./midday-dashboard-patterns.md) — external
  reference sweep of `midday-ai/midday` plus an August 2026 library-currency
  check. Promote its conclusions here after decisions, then remove it.
- [OPD/IPD reference flows](./opd-ipd-reference-flows.md) — source-pinned
  comparison of Marley and OpenMRS O3 registration, day-view, billing, draft,
  concurrency, and IPD surfaces (2026-08-24).
- [OPD intake state and query review](./opd-intake-state-and-query-review.md) —
  internal boundary review for local selection state, zero-value walk-ins,
  scheduled service snapshots, and bounded server search (2026-08-25).
- [OPD, direct services, and departmental billing](./opd-direct-services-marley-openmrs.md) —
  source-pinned definition and Marley/OpenMRS comparison for direct lab,
  radiology, procedures, shared billing, and revenue attribution (2026-08-25).

## Adopted findings

| Area                   | Durable conclusion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reference architecture | Keep HMS's explicit multi-tenancy and guarded router. Use Marley/FHIR-shaped typed records as donors when a workflow earns them; use Danphe/incumbent breadth as a checklist, not as architecture. Reject dynamic metadata and god-controller coupling.                                                                                                                                                                                                                                                                                                                                             |
| Catalog                | A flat item master plus immutable Charge snapshots is sufficient for OPD. Satellite pricing/packages are additive later. New/follow-up Practitioner prices are first-class.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Paper consultation     | The signed paper scan remains the clinical source. Any AI extraction is a separate unverified draft/index requiring provenance and clinician review.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Care boundary          | One OPD Appointment handles booked and walk-in outpatient work. IPD and Emergency remain separate destinations/tables; no shared care wrapper exists yet.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Queue performance      | Operational lists use tenant-leading indexes, page-first joins, stable keysets, and explicit invalidation/polling. Synthetic plans do not replace production p50/p95 measurement.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Intake UX              | Use one quiet flow: Patient, care team, explicit **When**, future date/time only for **Later**, and the same optional Services picker in both modes. Selected rows are local form intent and update immediately; quotes own only server pricing and the consultation line. Search is server-bounded to six display rows.                                                                                                                                                                                                                                                                            |
| Billing documents      | The itemized supply document and Payment Receipt are different. Exempt care, taxable supply, and advance receipts require different printed treatment.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Accounting             | Atomic double-entry posting gives a defensible handover boundary without building an ERP. GST outward register is not a filing export.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| OPD status mutation    | Neither reference expects a receptionist to drive a consultation lifecycle. Marley makes appointment status read-only and derives completion from saved clinical work, sweeping missed rows to No Show nightly; Danphe has no consult states at all and lets its day-scoped queue self-empty. Both tie the transition to work the desk already does.                                                                                                                                                                                                                                                |
| Navigation             | Stable task destinations suit frequent non-technical staff, but only live domains appear. OPD/IPD/Emergency use familiar labels and separate workflows.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Compliance/ABDM        | Treat ABDM as evidence-gated until facility/practitioner registration, sandbox, sale, and compliance ownership exist. Design durable identifiers and exportability early; do not claim legal sufficiency from research alone.                                                                                                                                                                                                                                                                                                                                                                       |
| Performance            | Public asset compression, request-local SSR context, parallel loaders, and bounded queries matter. Rejected micro-optimizations stay rejected until profiling shows a bottleneck.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Frontend adoption      | Measured 2026-08-24 on 40k seeded patients: Base UI combobox pickers, URL-backed patient search, and one optimistic catalog toggle (7 ms flip at Slow 4G vs an ≥800 ms round trip; needs memoized rows at 1,000 items) landed with flat server latency and +68 B route script. TanStack Query stays 5.101.x until oRPC types support 5.102. Evidence: `data/perf-midday-adoption/`.                                                                                                                                                                                                                 |
| Core-screen UX         | Keep one **New appointment** entry, explicit **Now/Later**, server-owned Now time, and one optional service-selection surface. A zero Now bill is valid and creates no financial document. Later persists selected services as dormant Charge snapshots until check-in. Leave guards, patient conflict checks, phone normalization, explicit sex, keyboard focus, bounded popups, local list search, and URL-backed closed-row filtering remain. Evidence: [OPD/IPD reference flows](./opd-ipd-reference-flows.md) and [OPD intake state and query review](./opd-intake-state-and-query-review.md). |

## Evidence anchors

The most decision-relevant external sources are retained here so consolidation
does not erase the evidence trail:

- [Marley Health patient appointments](https://marleyhealth.io/patient-appointment)
  and [clinical procedure templates](https://marleyhealth.io/docs/v13/user/manual/en/healthcare/clinical_procedure_template)
- [ERPNext taxes](https://docs.frappe.io/erpnext/taxes),
  [discounts](https://docs.frappe.io/erpnext/applying-discount), and
  [Payment Entry](https://docs.frappe.io/erpnext/payment-entry)
- [HL7 FHIR R4](https://hl7.org/fhir/R4/)
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

- Have the pilot accountant classify representative consultation, diagnostic,
  pharmacy, credit, discount, and advance cases and approve printed fields.
- Walk the unified intake and both printed documents with reception/cashier staff
  on the real printer.
- Confirm shift handover, correction approvals, payment methods, insured/credit
  frequency, and exact statutory exports role by role.
- Measure production latency and data distribution before adding cache/index
  variants.
- Observe clinical authorship, vitals, orders/results, and retention requirements
  before designing those domains.
- Validate state-specific clinical-establishment, GST, DPDP, retention, and ABDM
  duties with qualified advisers before rollout.

## Adding research

Start with a question that could change a current decision. Prefer primary or
owner sources, record what the evidence does and does not prove, and end with a
falsification step. Update this ledger rather than creating a new memo unless
the raw observation set is too large to review in a pull request; after a
decision, promote the conclusion and remove the temporary memo.
