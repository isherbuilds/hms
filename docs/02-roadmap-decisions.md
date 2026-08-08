# HMS post-v0 roadmap — Decision Record

Date: 2026-08-08. Brainstorm + external advisory (ChatGPT Pro via Oracle, reconciled
claim-by-claim against code). Terms per `docs/CONTEXT.md`; evidence per
`docs/research/01-reference-architecture-danphe-marley.md` and the module-by-module
decomposition of DanpheEMR (47 server modules) and Marley/Frappe Health (130 doctypes) read
2026-08-08. Follows `docs/01-mvp-decisions.md`; amends its decisions 6 and 10 where noted.

## Decisions

1. **Depth before breadth.** The v0 slices are all implemented; the pilot goes live on the
   completed OPD loop before any department module (pharmacy, lab, radiology, IPD) is started.
   Both reference EMRs show each department is a product of its own (Danphe: Pharmacy +
   Dispensary + Inventory; Marley: ~17 lab doctypes); starting one now would delay all live
   feedback by weeks. This amends decision 10's "pharmacy first" sequence: module order is now
   set by the trigger table below, not a fixed list.
2. **Stage 1 — go-live gate** (spec: `docs/specs/accly-hms-go-live.md`): organization timezone
   + one Business Date rule (tokens, queue, fiscal-year numbering, ledger, GST currently mix
   UTC and hard-coded IST); multi-terminal freshness via polling — no realtime platform; daily
   collections + OPD register; unbilled-activity + refund-due worklists. Live pilot traffic
   starts after Stage 1 plus the operational checklist, not after more features.
3. **Stage 2 — post-live clinical depth**: longitudinal patient timeline (read model over
   visits, billing, prescription scans — no new clinical storage) and typed `vital_signs`
   capture (typed columns, new `observation` permission statement; no JSON/EAV). Specced after
   Stage 1 ships, informed by live usage.
4. **Appointments are trigger-gated, not scheduled.** Build only when two weeks of live logs
   show meaningful pre-arranged arrivals or material staff time on appointment calls. When
   built: an additive `appointments` table whose check-in atomically creates a normal Visit
   (token, consult-fee charge) — walk-in `visit.create` unchanged. Improvement doc 02's
   deferral stands.
5. **Accounting is frozen at ADR 0020.** The Billing Ledger stays a source-document
   projection: no manual journals, no chart-of-accounts editor, no opening balances, no
   reconciliation/expenses/period close, one-way boundary (never sync Tally back). New
   `sourceType` values enter only with the module that owns the source document, with balanced
   posting rules and tests. Any request phrased as "manual adjustment", "opening balance",
   "reconcile bank", "expense", or "close books" is outside the product unless an owner
   decision changes strategy.
6. **Handover boundary: XLSX first; Tally adapter only on proof.** Run the accountant
   acceptance test — one representative day (cash, UPI, discount, partial payment, credit
   note, refund) handed over as XLSX + data dictionary, posted into the hospital's actual
   Tally without engineering help. Zero unexplained differences → XLSX suffices. Otherwise
   build a one-way, versioned, golden-file-tested export adapter — never an integration, never
   ledger expansion. (Amends decision 6's Tally-XML promise, with ADR 0020.)
7. **Report visibility is a pilot-owner decision.** `report: ["read"]` is currently granted to
   every role, so reception can open the trial balance. Decide with the pilot whether to split
   operational vs statutory report permissions; the change is confined to
   `packages/auth/src/access.ts`.

## Deferred modules and their triggers

Each module starts only when its trigger evidence exists, and is sold to the pilot before
build (decision 10's rule, kept).

| Module | Trigger |
| --- | --- |
| Pharmacy POS + stock | Two stable live weeks; paid commitment; named pharmacy owner; clean opening stock (item/batch/expiry); sale/return/purchase/adjustment workflows signed off |
| In-house lab results | Hospital confirms in-house lab; named lab owner + signing clinician; two weeks of logged test volume; approved test templates + reference ranges; generic order (ServiceRequest) boundary accepted |
| Radiology | Named owner maps workflow; store-reports-only vs imaging-integration decided; live demand exceeds billing + private report attachments |
| IPD/ADT + beds | ~Four stable live weeks; paid IPD scope; service-unit/bed master data ready; admission→discharge, deposits, nursing ownership documented |
| Emergency | Separate clinical-safety discovery; medical owner approves triage + downtime protocol; 24/7 support agreed |
| OT/surgery | IPD live; named OT owner; consent/anesthesia/consumables/billing workflows approved |
| Insurance/TPA | Live insured/credit share is meaningful, or a signed payer requirement; payer tariffs + claim lifecycle documented |
| ABDM | A sale requires it; HFR/HPR/ABHA prerequisites + sandbox access; named compliance owner |
| Payment gateway / patient portal | Remote prepayment has a real user journey; webhook/refund/reconciliation ownership documented |
| Offline mode | Outage drill + connectivity log prove outages block operations after network/UPS remediation and the paper fallback is unacceptable |
| Ambient AI consult | Speech feasibility spike on real consented consultations meets accuracy/time criteria; clinicians approve review workflow; paper source stays authoritative |

Until a fulfillment module exists, in-house tests and pharmacy items are billed through
ordinary Charges — that interim boundary is deliberate.

## Go-live operational checklist (owner + engineering, not slices)

- **Baseline**: release commit recorded; full gate green; migration history becomes
  append-only at the first live financial document (pre-production rebase ends).
- **Tenant setup**: pilot Organization via the founding-email path; all seed/test data
  removed; settings complete (legal name, GSTIN, prefixes, fiscal year, timezone, follow-up
  and unbilled thresholds); departments, practitioners, catalog, GST rates seeded and — for
  GST classes — approved by the accountant, not engineering.
- **Accounts**: one login per staff member; credit-note/refund authority verified; same-day
  offboarding agreed; audit-write failures alert monitoring.
- **Legacy migration**: demographics + masters only; no recreating old invoices (corrupts the
  ledger's start date); MRN policy decided before import (preserve + advance counter, or
  reissue + legacy-identifier field); rehearsal import reconciled on staging.
- **Hardware**: every print artifact (token slip, A5 + thermal invoice, receipt, credit note,
  refund voucher, report PDFs) proven on the pilot's actual printers; billing staff sign-off.
- **Backups**: Postgres + object storage; restore drill into an isolated environment verifying
  counters produce no duplicate numbers post-recovery; RPO/RTO agreed with the hospital.
- **Cutover**: start with one department/shift; legacy HMS read-only from the cutover
  timestamp; no dual entry; daily reconciliation (visits, invoices, method totals, refunds,
  unbilled, prescription-upload completion) through stabilization; named front-desk, billing,
  and technical escalation contacts; no new modules during stabilization.
- **SOPs**: role-based training on real workflows, including the paper fallback for outages
  with controlled back-entry.

## Open questions (deliberately deferred)

- Accountant acceptance test outcome → Tally adapter yes/no (decision 6 here).
- Report-permission split (decision 7 here) — pilot owner.
- `unbilledAlertHours` seed value — observe real billing lag first.
- Stage 2 spec details (timeline fields, vitals validation ranges) — after Stage 1 ships.

## Next step

`implement` `docs/specs/accly-hms-go-live.md`. Stage 2 gets its own spec after Stage 1 is
live.
