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
   Patient-facing SMS (token/appointment reminders — the incumbent runs an SMS server, O12)
   rides this same trigger: reminders are worthless without appointments, and token SMS is
   marginal for a walk-in queue where the patient is standing in the room.
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
| Pharmacy POS + stock | Two stable live weeks; paid commitment; named pharmacy owner; clean opening stock (item/batch/expiry); sale/return/purchase/adjustment workflows signed off. Spec must also decide the inbound side (supplier invoice/GRN, GSTR-2 input-tax-credit) in-product vs accountant-side, and include the Schedule-H register — drug law, not a report preference |
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
ordinary Charges — that interim boundary is deliberate. Outsourced (send-out) tests need no
module at all: bill through Charges and attach the received report via files.

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
- GST handover scope → source XLSX only, or filing-shaped output with recipient GSTIN,
  place-of-supply/IGST, B2B/B2C HSN split, and documents-issued series. Session 2 evidence sharpens
  this: the incumbent's GST register is **pharmacy/taxable-goods only** — a live GST R1 Summary states
  it reports "Total Gst amount of Pharmacy sales and returns," and a ₹500 OPD consultation posted
  ₹0 GST with no tax line on its receipt. **Clinical OPD is GST-exempt, so a pure-OPD product needs no
  GSTR-1 at all**; our GST outward register only becomes load-bearing once we bill taxable goods
  (pharmacy/consumables — the deferred Pharmacy module). When it does, the incumbent shows the target
  shape: **multi-rate brackets (5/12/18%)**, **IGST columns** (inter-state/place-of-supply capable),
  **returns as negative lines**, plus **GSTR-2 (inward/ITC)**, **HSN-wise**, **documents-issued
  series**, and IPD **room-rent GST** reports. Our current register is explicitly intra-state,
  CGST/SGST-only, single-bucket, and must not be represented as GSTR-1-ready; see
  `docs/research/03-client-hms-production-sitemap.md` (O15–O16).
- Cashier handover → the client's incumbent showed a first-class giver/receiver handover and four
  pending handovers in one production snapshot. Validate whether this is a required shift-close SOP;
  if yes, reopen Slice 11 before pilot cutover rather than adding a parallel report later.
  Reference corroboration: DanpheEMR also models handover as a first-class acknowledged two-party
  document with a mirrored employee cash ledger (`docs/research/04-danphe-marley-entity-deep-dive.md` E2).
- Billing correction and approval → sample real payment-mode corrections, cancellations, and
  post-discounts. If reception initiates but another role approves, specify an append-only
  request/approval/reversal flow; never copy mutable receipt edits.
- Sponsor/MOU/advance/split-tender usage → measure it from anonymized transaction counts before
  changing the Insurance/TPA trigger or billing model. One schema fact raises the stakes:
  `payments.method` and `refunds.method` are CHECK-constrained to `cash/upi/card`
  (`packages/db/src/schema/payments.ts:30`, `refunds.ts:34`), and receipt numbers are
  per-payment-row. These two differ in urgency: widening the CHECK is an appended
  DROP/ADD CONSTRAINT — legal at any time under the append-only rule (which ends *rebasing*,
  not migrating) — so do not widen it speculatively for tenders the pilot never takes. Receipt
  granularity is the genuinely hard one: once receipts are printed and numbered per payment
  row, switching to per-bill numbering breaks issued documents — settle it before the first
  live receipt.
  Split tender itself needs no schema: payments are already multiple rows per invoice.
  Reference answer for the interview: DanpheEMR treats modes as configuration data, split tender
  as child rows, and numbers one financial document per bill (research 04, E3).
- Cross-role parity → the incumbent exposes named Admission, EMR, IP Billing, Laboratory, Nursing,
  Pharmacy, Phlebotomy, Purchase, Radiology, Reception, and Administrator dashboards. Session 2 added
  a second, role-broader account (identity redacted; see research 03) with functional login to **Reception, Pharmacy, and Nursing Station**
  and validated the OPD write-through end to end (register → bill → "OPD Bill Cum Receipt", MR No 2039
  / Bill No 5140 on UAT). Pharmacy and Nursing are now functionally reachable for a future supervised
  workflow pass; before scoping any department module, run a supervised synthetic workflow with that
  department's real role — do not infer capability or priority from dashboard names.
  Administrator/reporting/user-management and doctor/consultant surfaces remain
  confirmed-but-unmapped; see `docs/research/03-client-hms-production-sitemap.md`.
- Report-permission split (decision 7 here) — pilot owner.
- `unbilledAlertHours` seed value — observe real billing lag first.
- Cash-drawer expenses → the incumbent's reception records petty payouts (voucher, payee,
  authorization — O7), so the pilot's front desk may pay expenses from the drawer today. That
  breaks the day-close identity "collections report matches the drawer". Two honest options
  only: SOP — nothing leaves the drawer, separate petty float (zero code); or amend decision 5
  to admit a real `expense` posting source (credit Cash in Hand, debit an expense account).
  Never a non-posting memo field — ledger Cash in Hand would silently overstate the physical
  drawer. Ask in the handover interview.
  Reference corroboration: DanpheEMR keeps petty cash out of billing entirely — expenses are
  accounting-owned manual vouchers (research 04, E1).
- Doctor share → visiting-consultant revenue share is a named incumbent flow (IPD
  "doctor-share", consultant-wise sales reports). Decide with the pilot: a consultant-wise
  collections report with accountant-side payout (likely — one GROUP BY away from
  dailyCollections, zero schema), or out of scope. Payroll itself stays outside the product.
  DanpheEMR's in-product engine (profiles, per-item performer/prescriber/referrer %, TDS, payout
  vouchers) shows how large the alternative is (research 04, E4).
- Certificates and statutory registers → Leave/Fitness certificates and the Dead-on-Arrival /
  Brought-Dead register exist at the incumbent's front desk (O10). Ask which the pilot actually
  issues; printed certificates are cheap, the DOA register is medico-legal. Deferred by name —
  neither shipped nor promised. Danphe additionally keeps fiscal-year-numbered birth and death
  registers as dedicated entities (research 04, E6) — include both in the same pilot question.
- Stage 2 spec details (timeline fields, vitals validation ranges) — after Stage 1 ships.

## Next step

`implement` `docs/specs/accly-hms-go-live.md`. Stage 2 gets its own spec after Stage 1 is
live.
