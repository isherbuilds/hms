# Spec: accly-hms v0 — OPD front office + billing (+ optional consult screen)

Status: ready
Authority: brainstorm decision record `hms-docs/01-mvp-decisions.md` (2026-08-03) + user
selections in-session; advisory amendment on per-aggregate lifecycles applied.
Supersedes: none.
Canonical home after bootstrap: `accly-hms/docs/specs/accly-hms-v0.md` (this file moves there in
Slice 1; `hms-docs/` copy becomes a pointer).

Vocabulary: `hms-docs/CONTEXT.md`. Terms Organization, Member, Patient, Visit, Charge, Invoice,
Credit Note, Service Catalog, MRN, Provenance Envelope are used exactly as defined there.

## Problem

A committed pilot hospital runs OPD on a legacy HMS plus Tally: patient registers at the front
desk, pays on the spot, doctor writes on paper. Billing and the day-book are the hospital's
lifeline; the current software is dated, and no system in this segment is AI-ready. We need a
deployable v0 that replaces the front office + billing path outright, is architecturally ready
for the ambient-AI wedge, and leaves accounting in Tally.

## Solution

Multi-tenant web HMS on the post-dash-stack architecture. One hospital = one Organization. v0
delivers: patient registration with per-org MRN and phone dedupe; departments/practitioners;
priced Service Catalog with tax classes; OPD Visit creation with queue and token; charges
accumulating on the Visit; immutable GST-capable Invoices with on-the-spot Receipt printing;
Credit Notes for corrections; daily reports and Tally day-book export; an optional per-doctor
consult screen (diagnosis, Rx print, orders that create Charges). AI ships later; v0 carries the
Provenance Envelope, per-aggregate state machines, and an append-only audit event log so AI
drafting slots in without rework.

## Validation / Evidence

Contracted/owner-funded: one committed pilot hospital (currently HMS + Tally). Market research
packet: `hms-docs/research/00-synthesis.md`. Not market-validated beyond the pilot; pricing and
broader demand remain open business questions deliberately excluded here.

## User Stories

1. As a **receptionist**, I register a walk-in patient (name, phone, age/DOB, sex, address) in
   under 30 seconds; the system assigns an MRN and warns me when the phone number matches an
   existing Patient so I reuse the record instead of duplicating it.
2. As a **receptionist**, I create an OPD Visit for a Patient with a department + practitioner;
   the consult fee Charge is created automatically and a token number prints on the Visit slip.
3. As a **billing clerk**, I see a Visit's pending Charges, add catalog items or a manual charge,
   apply a discount with a reason, issue an immutable numbered Invoice, record payment
   (cash/UPI/card), and print the Receipt — patient walks out with paper in hand.
4. As a **billing clerk**, I correct a wrong issued Invoice only via Credit Note (with reason
   and line-level tax breakup); the original Invoice never changes. If the invoice was already
   paid, the screen shows **refund due** and I record the Refund (cash/UPI/card) against the
   Credit Note, printing a refund voucher.
5. As a **doctor** (opt-in), I open my queue, see the waiting Visit, record diagnosis and Rx
   lines, order lab/radiology items from the catalog (which become pending Charges), sign the
   note, and print an A5 prescription on hospital letterhead. After signing, the note is
   immutable; corrections are addenda.
6. As a **hospital administrator**, I manage the Service Catalog, departments, practitioners,
   and organization settings (legal name, GSTIN/tax id, invoice/receipt/MRN prefixes, fiscal
   year start, currency).
7. As an **owner/accountant**, I get the daily collection report (by payment method), the OPD
   register, an unbilled-activity list (Visits with pending Charges), and a Tally-importable
   day-book export for a date range.

## Implementation Decisions

**Repo**: new top-level directory `accly-hms/`, copied from `post-dash-stack/` with fresh git
history, following that README's documented reuse path: keep `schema/auth.ts` (Better Auth CLI
owned) and the organization-files slice (future document uploads); delete `migrations/` and
regenerate. Package scope stays `@workspace/*`. post-dash-stack improvements are cherry-picked
deliberately, never auto-merged.

**Tenancy & authorization**: unchanged stack pattern — every domain table carries
`organizationId` FK; every db query function takes `(userId, slug)` and enforces membership in
the query (pattern: `packages/db/src/queries/organization-files.ts`); routers are
`protectedProcedure` with Zod contracts (pattern: `packages/api/src/routers/file.ts`).

**Roles (v0, deliberately coarse)**: Better Auth `owner`/`admin` gate settings, catalog,
department, practitioner, and credit-note writes. Any Member may register patients, create
Visits, and bill. Signing a consult note requires the session user to be the linked
`practitioners.memberUserId` for that Visit's practitioner. A `memberProfiles` table
(`organizationId`, `userId`, `appRole` enum `reception|doctor|billing|admin`) drives UI
navigation only, not API authorization, in v0.

**Domain schema** (new files in `packages/db/src/schema/`, all org-scoped, uuid PKs, check
constraints in-schema per stack convention):

- `organization-settings`: 1:1 with organization — legal name, address, tax id (GSTIN/PAN),
  currency (default INR), `mrnPrefix`, `invoicePrefix`, `receiptPrefix`, `creditNotePrefix`,
  `fiscalYearStartMonth` (default 4).
- `counters`: (`organizationId`, `key`, `value`) with unique (org, key); `nextCounter(tx, orgId,
  key)` helper increments under `SELECT … FOR UPDATE` in the caller's transaction. Keys:
  `mrn`, `token:<practitionerId>:<yyyy-mm-dd>` (tokens are per doctor queue per day, matching
  real OPD practice), `invoice:<fiscalYear>`, `receipt:<fiscalYear>`,
  `creditNote:<fiscalYear>`, `refund:<fiscalYear>`. Document numbers are
  `{prefix}{fiscalYear}/{seq}`; gapless within a
  series.
- `patients`: MRN (text, unique per org, assigned from counter at insert), name, phone, sex,
  `dateOfBirth` nullable + `ageYears` nullable (check: at least one present), address,
  `createdBy`. Index on (org, phone) for dedupe lookup; keyset-paginated search per stack
  pagination pattern.
- `departments`, `practitioners`: practitioner has name, `departmentId`, registration number,
  nullable `memberUserId` (doctors without logins exist), nullable `consultFeeItemId` →
  catalog.
- `catalog-items`: name, short code, category enum
  `consultation|procedure|lab|radiology|other`, `unitPrice numeric(12,2)`,
  `taxRatePercent numeric(4,2)` (0 for exempt healthcare services), `taxCode` (HSN/SAC,
  nullable), `active` flag. Soft-deactivate only — Charges snapshot price at creation.
- `visits`: patientId, practitionerId, departmentId, class enum `opd` (enum exists for later
  `ipd|er`), daily `tokenNumber`, status enum `waiting|in_consult|completed|cancelled`,
  timestamps per transition. State machine: waiting → in_consult → completed; waiting →
  cancelled. No other transitions.
- `charges`: visitId, nullable `catalogItemId`, description/unitPrice/taxRatePercent/taxCode
  **snapshotted**, qty, `sourceType` enum `consult_fee|order|manual`, nullable
  `sourceId`, status enum `pending|invoiced|voided`, nullable `invoiceId`. State machine:
  pending → invoiced (only by invoice issuance, sets invoiceId) | pending → voided (with
  reason). Invoiced charges are immutable.
- `invoices` + `invoice-lines`: issuance materializes the bill as immutable line snapshots —
  the snapshot-of-record for all later money math. Each `invoice-line` references its charge
  and stores: description, qty, `unitPrice`, `lineSubtotal` (qty × unitPrice),
  `allocatedDiscount` (the header discount allocated pro-rata by lineSubtotal, rounding
  remainder assigned to the largest line so the sum is exact), `taxableValue` (lineSubtotal −
  allocatedDiscount), `taxRatePercent`, `taxAmount` (round(taxableValue × rate, 2)), and
  `gross` (taxableValue + taxAmount). Invoice header stores `discountAmount` +
  `discountReason`, org tax id + patient snapshot for print, and totals computed as **sums of
  line values** (`subtotal`, `taxTotal`, `grandTotal`) so line-first rounding is the single
  source of truth. Rounding is half-up to 2 decimals everywhere. **No status column, no update
  path** — issuance is the only write.
- `credit-notes` + `credit-note-lines`: a Credit Note references one invoice; number from its
  series, reason, issuedBy. Each line references an **invoice-line** (not the charge) and
  stores its own `taxableValue`, `taxAmount`, and `gross` snapshots:
  - Full-line credit copies the invoice-line's remaining taxableValue/taxAmount/gross exactly —
    no re-derivation, no rounding drift; crediting every line reproduces the invoice totals.
  - Partial credit is entered as `gross` (what the patient is owed); the server derives
    `taxableValue = round(gross / (1 + rate), 2)` and `taxAmount = gross − taxableValue`, so
    the money amount stays exact.
  - Caps, cumulative per invoice-line across credit notes: taxableValue, taxAmount, and gross
    each ≤ the invoice-line's snapshot values. Header `subtotal`/`taxTotal`/`total` are sums of
    lines.
- `payments`: invoiceId, direction implicit (inflow), method enum `cash|upi|card`, amount,
  free-text reference, receivedBy, `receiptNumber` from series.
- `refunds`: invoiceId, creditNoteId (required — a refund exists only to settle a credit on a
  paid invoice), method enum `cash|upi|card`, amount, refundedBy, `refundNumber` from its own
  series (counter key `refund:<fiscalYear>`), free-text reference.
- **Money invariants** (all in gross terms unless stated; enforced inside the
  issuing/recording transaction with the invoice's related rows locked, not as DB constraints —
  each checked with tests):
  - Per invoice-line: cumulative credited taxableValue/taxAmount/gross ≤ that line's snapshots;
    `creditTotal` (sum of credit-line gross) ≤ `grandTotal`.
  - `recordPayment` caps against **current positive outstanding**: a payment is rejected unless
    `amount ≤ max(0, grandTotal − creditTotal − paymentsTotal + refundsTotal)` at recording
    time — you never collect value that has already been credited away (which would
    manufacture an avoidable refund-due).
  - `recordRefund` caps against **current refund-due**: a refund is rejected unless
    `amount ≤ max(0, −outstanding)` at recording time — you never return more than is actually
    owed, regardless of how much was credited or paid in aggregate (otherwise outstanding flips
    positive and authorizes collecting the same money again). Additionally, refunds are
    attributed per credit note: cumulative refunds for a `creditNoteId` ≤ that credit note's
    `total` — a large refund cannot ride on a small credit note just because other credits
    exist on the invoice. The invoice-level bounds `refundsTotal ≤ creditTotal` and
    `refundsTotal ≤ paymentsTotal` follow from these two but remain stated for test coverage.
  - Balance shown everywhere as `outstanding = grandTotal − creditTotal − paymentsTotal +
    refundsTotal`; a negative value renders as **"refund due"** on the billing screen and in
    reports until a Refund is recorded. Crediting a fully paid invoice is legal and simply
    surfaces refund-due; the correction flow is credit note → refund, never invoice mutation.
- `consult-notes`: visitId, practitionerId, status `draft|signed`, chiefComplaint, `signedAt`.
  Child tables: `diagnosis-lines` (text + nullable ICD code field, unused in v0),
  `prescription-lines` (drug free-text, dose, frequency, duration, instructions), `orders`
  (catalogItemId restricted to lab/radiology/procedure categories, status
  `draft|active|completed|cancelled`). Signing (single transaction): note → signed, orders →
  active, one pending Charge per order created. Signed note and children immutable;
  `note-addenda` table for corrections.
- **Provenance Envelope columns** on consult-notes, prescription-lines, orders, charges:
  `generatedBy` enum `member|ai` (default member), nullable `modelName`, `modelVersion`,
  `reviewedBy`. v0 writes `member`; columns exist so AI drafting is additive.
- `events`: append-only — organizationId, actorUserId, entityType, entityId, action, jsonb
  payload, createdAt. Written by a `recordEvent(tx, …)` helper inside the same transaction as
  every state-changing mutation. No update/delete path.

**Money**: `numeric(12,2)` throughout, org-level currency, no conversion. Tax is per-line rate;
invoice print groups by rate and, when org country is India, displays the CGST/SGST half-split
(display-time only; storage is the single rate).

**Printing**: browser print CSS. Invoice/receipt in A5 and 80mm-thermal layouts; prescription A5
with org letterhead block. No printer drivers/integrations.

**Tally export**: date-range export of invoices, payments, credit notes, and refunds as (a)
Tally XML with generic Sales/Receipt/Credit Note/Payment (refund) vouchers carrying the
credit-note tax breakup, and (b) CSV day-book fallback. Ledger-name mapping is
a fixed convention documented in the export screen; refinement with the pilot's accountant is an
explicitly deferred iteration.

**Routers** (`packages/api/src/routers/`): `settings`, `patient`, `staff` (departments +
practitioners), `catalog`, `visit`, `billing` (charges, invoices, payments, credit notes),
`consult`, `report` (collections, OPD register, unbilled), `export`. Registered in `appRouter`
beside existing `auth/file/health/organization/profile`.

**Web** (`apps/web`): route group per area — Front Desk (register/search, new visit, queue),
Billing (visit charges → invoice → payment → print), Consult (doctor queue, note editor, Rx
print), Admin (catalog, staff, settings), Reports. React Hook Form + Zod per stack constraint;
mutations refresh explicit query keys (no realtime).

**Out of the stack's way**: no new infrastructure — no queues, no workers, no websockets, no
search engine. Dedupe is an indexed phone lookup; reports are SQL.

## Test Seams

Existing seams only; prior art in `tests/`:

1. **DB integration** (`tests/integration/db`, real Postgres via `tests/support/database.ts`):
   counter concurrency (parallel `nextCounter` yields gapless unique sequence); charge/invoice
   state transitions (double-invoice attempt fails; voiding an invoiced charge fails); signed
   note immutability; org-scoping denial (member of org A cannot read/write org B rows) —
   the stack's mandated denial tests.
2. **API integration** (`tests/integration/api`): register→visit→bill→pay happy path through
   routers; credit-note over-issue rejected; crediting a partially and a fully paid invoice
   surfaces the correct refund-due balance; refund exceeding credited or paid amount rejected;
   sign-consult authorization (non-linked member
   rejected); every mutation writes an `events` row.
3. **Unit** (`tests/unit`): document-number formatting (fiscal year rollover); invoice-line
   math — pro-rata discount allocation whose lines sum exactly to header totals (incl. rounding
   remainder on the largest line), multi-rate tax; credit-note math — full credit of every line
   reproduces invoice totals exactly, partial-credit gross→taxable derivation; CGST/SGST
   display split; Tally XML builder output
   shape.

Verify commands are the repo's real ones: `bun run typecheck`, `bun run lint`,
`bun run test:unit`, `bun run test:integration`.

## Task Plan

- [ ] Slice 1: Bootstrap `accly-hms/` from post-dash-stack
  - Acceptance: fresh directory + git history; example domain slice retained per decisions
    (auth.ts, organization-files kept); migrations regenerated from scratch; `bun run dev`
    serves web+API locally; existing stack tests pass unchanged; this spec moved to
    `accly-hms/docs/specs/`.
  - Verify: `bun install && bun run db:dev:start && bun run db:migrate && bun run test`
  - Depends on: none
  - Owns/Touches: `accly-hms/` (entire new tree); `hms-docs/specs/accly-hms-v0.md` (replace with
    pointer)
  - Interfaces: produces the workspace all later slices edit.
- [ ] Slice 2: Foundation — settings, counters, events, member profiles (proof slice for schema
      conventions)
  - Acceptance: `organization-settings`, `counters`, `events`, `member-profiles` tables +
    migrations; `nextCounter(tx, organizationId, key)` and `recordEvent(tx, …)` exported from
    `@workspace/db`; `settings` router get/update (admin-gated); settings page in Admin UI.
  - Verify: counter-concurrency and org-denial integration tests pass;
    `bun run typecheck && bun run test:integration`
  - Depends on: Slice 1
  - Owns/Touches: `packages/db/src/schema/{organization-settings,counters,events,member-profiles}.ts`,
    `packages/db/src/queries/{settings,counters,events}.ts`, `packages/api/src/routers/settings.ts`,
    `apps/web/src/routes/**/admin/settings*`
  - Interfaces: `nextCounter(tx, orgId: string, key: string): Promise<number>`;
    `recordEvent(tx, { organizationId, actorUserId, entityType, entityId, action, payload })`;
    settings read used by every print view and numbering call.
- [ ] Slice 3: Patients — register, dedupe, search
  - Acceptance: registration form assigns MRN via counter; entering a phone number surfaces
    existing matches before save; keyset-paginated patient search (MRN, name, phone); edit
    demographics; every write audit-logged.
  - Verify: API integration test registers, detects duplicate phone, searches;
    denial test for cross-org patient read.
  - Depends on: Slice 2
  - Owns/Touches: `packages/db/src/schema/patients.ts`, `packages/db/src/queries/patients.ts`,
    `packages/api/src/routers/patient.ts`, `apps/web/src/routes/**/front-desk/*`
  - Interfaces: `patient.register/search/get/update` router contracts; Patient row shape
    consumed by visit + billing slices (id, mrn, name, phone, ageYears/dateOfBirth, sex).
- [ ] Slice 4: Catalog, departments, practitioners (admin CRUD)
  - Acceptance: admin-gated CRUD for all three; catalog items carry price/taxRate/taxCode/
    category; deactivation hides from pickers without breaking existing Charges; practitioner
    links optional `memberUserId` and consult-fee item.
  - Verify: API integration tests incl. non-admin write rejection.
  - Depends on: Slice 2
  - Owns/Touches: `packages/db/src/schema/{catalog-items,departments,practitioners}.ts`,
    matching queries, `packages/api/src/routers/{catalog,staff}.ts`,
    `apps/web/src/routes/**/admin/{catalog,staff}*`
  - Interfaces: `catalog.list({ category?, activeOnly })` used by visit, consult, billing
    slices; practitioner shape (id, name, departmentId, memberUserId, consultFeeItemId).
- [ ] Slice 5: Visits — OPD ticket + queue
  - Acceptance: create Visit (patient + department + practitioner) → daily token from counter +
    auto consult-fee Charge (pending, snapshot from practitioner's consult-fee item); queue view
    per practitioner/department with status transitions waiting→in_consult→completed,
    waiting→cancelled (cancel voids the visit's pending charges with reason); visit slip print.
  - Verify: integration test asserts charge auto-creation with snapshotted price and the legal
    transition set; illegal transition rejected.
  - Depends on: Slices 3, 4
  - Owns/Touches: `packages/db/src/schema/{visits,charges}.ts`, queries,
    `packages/api/src/routers/visit.ts`, front-desk queue routes
  - Interfaces: Charge row shape + `charges.listPendingByVisit` consumed by billing; visit
    status consumed by consult slice; `visit.create/transition` contracts.
- [ ] Slice 6: Billing — invoice, payment, receipt, credit note, refund (riskiest domain logic)
  - Acceptance: billing screen shows pending Charges per Visit; add manual/catalog Charge; void
    pending Charge with reason; issue Invoice in one transaction (number from fiscal series,
    invoice-lines materialized with allocated discount/taxableValue/taxAmount/gross, header
    totals as line sums, charges → invoiced, event recorded) — issued Invoice has no update
    path; record payments (cash/upi/card) each printing a numbered Receipt; Credit Note
    issuance with lines referencing invoice-lines (full-line = exact snapshot copy, partial =
    gross-entered), capped per invoice-line and in total, admin-gated; Refund recording
    against a Credit Note with refund-due surfaced on the billing screen; A5 + thermal print
    views render from snapshot data only.
  - Verify: integration tests — double-invoice race (two concurrent issuances of same charges:
    one wins), payment exceeding current positive outstanding rejected (incl. paying after a
    credit on an unpaid invoice), per-line and total credit over-issue rejected,
    discounted-invoice partial credit yields correct GST breakup, credit on
    fully/partially paid invoice yields correct refund-due, refund invariants enforced
    (refund above current refund-due rejected — named scenario: G=100, P=50, CN=80 → refund
    capped at 30, attempt of 50 rejected; per-credit-note: refund riding on a small credit
    note while a larger credit exists elsewhere on the invoice is rejected),
    numbering gapless under 20 concurrent issuances; unit tests for totals/tax-split.
  - Depends on: Slice 5
  - Owns/Touches: `packages/db/src/schema/{invoices,invoice-lines,credit-notes,payments,refunds}.ts`, queries,
    `packages/api/src/routers/billing.ts`, billing + print routes
  - Interfaces: `billing.issueInvoice(visitId, { discountAmount?, discountReason? })`,
    `billing.recordPayment`, `billing.issueCreditNote(invoiceId, { reason, lines: [{
    invoiceLineId, gross } | { invoiceLineId, full: true }] })`,
    `billing.recordRefund(creditNoteId, { method, amount, reference? })`, and a
    `billing.invoiceBalance` read (grandTotal, creditTotal, paymentsTotal, refundsTotal,
    outstanding); invoice/payment/credit-note/refund shapes consumed by reports + export slice.
- [ ] Slice 7: Consult screen — note, Rx, orders, signing
  - Acceptance: doctor queue lists own waiting/in_consult Visits; note editor (chief complaint,
    diagnosis lines, prescription lines, orders from lab/radiology/procedure catalog); sign is
    one transaction: note→signed, orders→active, one pending Charge per order, event recorded;
    signed content immutable — edits rejected, addenda appendable; A5 prescription print;
    signing rejected unless session user is the visit practitioner's linked member; provenance
    columns written as `member`.
  - Verify: integration tests for sign transaction effects, immutability, and authorization;
    manual print check.
  - Depends on: Slice 5 (and Slice 4 catalog categories)
  - Owns/Touches: `packages/db/src/schema/{consult-notes,note-addenda}.ts` (+ child line
    tables), queries, `packages/api/src/routers/consult.ts`, consult routes
  - Interfaces: order→Charge creation reuses Slice 5 Charge shape with
    `sourceType='order'`; no other slice consumes consult internals.
- [ ] Slice 8: Reports + Tally export
  - Acceptance: daily collections by method (payments minus refunds, credit notes listed
    separately), OPD register
    (visits + invoice totals per day), unbilled-activity list (visits with pending Charges older
    than N hours), refund-due list (invoices with negative outstanding); date-range Tally XML +
    CSV export downloads containing every invoice,
    payment, credit note, and refund exactly once; export documents ledger-name convention on
    screen.
  - Verify: integration test seeds a day of activity and asserts report totals equal the sum of
    issued documents; unit test validates Tally XML structure.
  - Depends on: Slice 6
  - Owns/Touches: `packages/db/src/queries/reports.ts`, `packages/api/src/routers/{report,export}.ts`,
    reports routes
  - Interfaces: consumes billing shapes from Slice 6; produces nothing downstream.

Parallelism: Slices 3 and 4 have disjoint write sets and may run concurrently after Slice 2.
Slices 6 and 7 both touch charge queries — run sequentially or coordinate on
`packages/db/src/queries/charges.ts` as coordinator-owned.

## Out of Scope

Pharmacy POS/stock, lab result entry, IPD/beds/ADT, surgery/OT, insurance/TPA, ABDM integration,
payment gateways, offline mode, general ledger/accounting, appointments/scheduling (walk-in
queue only in v0), SMS/WhatsApp messaging, patient portal, multi-branch organizations, any AI
feature (including the ambient scribe — separate spec after the speech feasibility spike).

## Explicitly Deferred

- Tally voucher/ledger mapping refinement with the pilot's accountant (generic mapping ships).
- GST rate table per service class from an accountant (v0 ships rates as org-editable catalog
  fields; engineering does not hard-code tax law).
- Fine-grained API-level role permissions (v0: admin-gated writes + practitioner-only signing;
  `appRole` is UI-only).
- ICD coding on diagnosis lines (column exists, unused).
- Thermal-printer format tuning against the pilot's actual hardware.
- Appointment booking (queue-first per pilot's walk-in reality).

## Open Questions

None. Business questions (pricing, ABDM timeline, speech spike) live in
`hms-docs/01-mvp-decisions.md` and do not block v0 implementation.
