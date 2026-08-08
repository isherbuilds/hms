# HMS MVP — Decision Record

Date: 2026-08-03. Product brainstorm output. Terms per `CONTEXT.md`; evidence per
`research/00-synthesis.md`.

## Decisions

1. **Product**: full hospital management system with an AI-native spine — not a wedge add-on to
   existing HMS vendors.
2. **Customer**: small-to-mid private hospitals (20–150 beds), emerging markets. Design for
   India (GST billing, FHIR-R4/ABDM-shaped model), sell wherever first. One committed pilot
   hospital exists (currently on legacy HMS + Tally).
3. **Tenancy**: cloud multi-tenant SaaS; one hospital = one Better Auth Organization. On-prem is
   an escape hatch: same Docker images, single-tenant Coolify install — never a code fork.
   Multi-branch hospitals: out of MVP (one org = one hospital).
4. **Connectivity**: online-only MVP. No offline-first/sync architecture. Graceful degradation
   is a later, evidence-driven investment.
5. **Domain model**: adopt the FHIR-shaped convergence model — Patient → Visit (OPD/IPD/ER) →
   Order (ServiceRequest / MedicationRequest) → Result (Observation/DiagnosticReport) → Charge,
   over a Service Unit facility tree. Vocabulary follows FHIR R4 resource names where sane.
   ABDM integration itself is deferred; the model must not preclude it.
6. **Billing vs accounting**: HMS owns Billing — Service Catalog with GST classes, Charges
   accumulating on Visits, on-the-spot Invoice/Receipt printing, payment capture (cash/UPI/card
   as recorded methods, no gateway), daily collection reports. **General ledger stays external
   (Tally)**; HMS ships a Tally XML day-book export. We never build accounting.
   *(Amended 2026-08-08 by ADR 0020: billing documents post balanced double-entry journals into
   a minimal, code-owned Billing Ledger for statutory handover — trial balance, billing-ledger
   balance sheet, GST register. Handover is neutral XLSX/PDF, replacing the promised Tally XML
   export unless the pilot's accountant proves an adapter necessary. Full bookkeeping, opening
   balances, reconciliation, and final accounts remain external — that boundary is unchanged.)*
7. **v0 scope (first live at pilot)**:
   - Patient registration: per-org MRN, phone+name dedupe.
   - Department / Practitioner setup, consult fees, OPD ticket + queue.
   - Service Catalog, billing, GST invoice + receipt printed on the spot.
   - Daily collection / OPD reports; Tally export.
   - Optional per-doctor consult screen: diagnosis, Rx lines, A5 printed prescription on
     letterhead, lab/radiology orders that auto-create Charges. Hospital can run
     front-office-only.
   - Explicit non-goals for v0: pharmacy POS/stock, lab result entry, IPD/beds, surgery/OT,
     insurance/TPA, ABDM, payment gateways, offline mode, general ledger.
   *(Amended for the delivered v0, per `docs/specs/accly-hms-v0.md`: the consult screen was
   replaced by signed paper-prescription capture — the pilot's doctors prescribe on paper and
   hold no logins; daily collection / OPD reports and the exception worklists moved to
   `docs/specs/accly-hms-go-live.md`; Tally export per the decision 6 amendment above.)*
8. **AI-native architecture from day one** (costs little, enables the wedge):
   - **Per-aggregate state machines, shared AI provenance envelope** (amended 2026-08-03 on
     advisory: a universal Draft→Approve lifecycle would conflate transition/reversal rules).
     Each aggregate gets its own explicit lifecycle — signed notes/prescriptions are immutable
     with addenda; invoices are immutable once issued and corrected only by credit note/refund;
     orders go draft → active → completed/cancelled; charges are pending until invoiced or
     voided. What is shared is the provenance/review envelope on AI-draftable content:
     `generatedBy` (member | ai), model + version, reviewer, timestamps.
   - Append-only event/audit log on every clinical and financial action.
   - Structured content over free text wherever workflow tolerates.
   - Early revenue-leak flagging (unbilled activity) — deterministic query in v0, not AI.
9. **AI wedge (north star, fast-follow after v0)**: ambient OPD consult — code-switched
   Hindi/Nepali/English speech → drafted clinical note + orders + prescription + bill lines,
   doctor approves, patient leaves with receipt. Requires a feasibility spike (speech quality on
   code-switched clinical audio) before it is promised in any demo.
10. **Module sequence after v0**: pharmacy POS + stock → lab (orders already exist; add result
    entry + report print) → IPD/ADT (beds, Service Unit tree) → surgery/OT → ABDM integration →
    insurance/TPA. Each increment sold to the live pilot before build.
    *(Amended 2026-08-08 by `docs/02-roadmap-decisions.md`: the fixed order is replaced by a
    per-module trigger table — depth-first go-live precedes every department module. The
    "sold to the live pilot before build" rule stands.)*
11. **Stack**: post-dash-stack as-is — Bun, TanStack Start web + Hono/oRPC API (SSR in-process),
    Better Auth organizations, Drizzle/Postgres, presigned S3 files, no realtime (mutation →
    query-key refresh), Coolify deployment. App-level clinical roles (receptionist, doctor,
    billing, admin, later pharmacist/lab-tech) layered over Better Auth's owner/admin/member.

## Open questions (deliberately deferred)

- Tally version + exact voucher format the pilot's accountant needs (verify on site).
- GST treatment details per service class (healthcare exemptions vs pharmacy/room-rent GST) —
  needs an accountant's table, not engineering guesses.
- Pricing / commercial model (per-bed, per-user, flat?) — validate with pilot.
- Speech feasibility spike result → go/no-go on ambient wedge timing.
- Whether the pilot hospital's printers (thermal receipt, A5 Rx) impose format constraints.
- ABDM sandbox timeline (when India sales become real).

## Next step

`spec` for v0 (front office + billing + optional consult), sliced so the pilot hospital can go
live incrementally. Market validation is partially settled by the committed pilot — remaining
business-model validation happens against that hospital, not in the abstract.
