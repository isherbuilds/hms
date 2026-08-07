# Spec: accly-hms v0 — OPD front office + billing (+ optional consult screen)

Status: ready
Authority: brainstorm decision record `docs/01-mvp-decisions.md` (2026-08-03) + user selections
in-session; advisory amendment on per-aggregate lifecycles applied.
Amended 2026-08-07: reconciled to the bootstrapped repo. The spec was written against
`post-dash-stack`; the actual base is **better-stack** (this repo, `accly-ai/hms`), whose
tenancy/authorization architecture differs materially. Domain decisions (schema shapes, state
machines, money invariants) are unchanged; every stack-integration decision (guards, paths,
roles, event log, verify commands) is restated in this repo's real conventions. Slice 1
(bootstrap) is complete — this repository is its output.
Amended 2026-08-07 (later, user decisions): forms use **React Hook Form in the midday-ai
shape** (`useZodForm`, shared `Form*` primitives and `SubmitButton` in `packages/ui`); the
audit trail stays **fire-and-forget `audit()` for sensitive actions only** — in-transaction
audit is explicitly deferred, not built. Slice 2 is complete.
Supersedes: the 2026-08-03 revision of this file.

Vocabulary: `docs/CONTEXT.md`. Terms Organization, Member, Patient, Visit, Charge, Invoice,
Credit Note, Service Catalog, MRN, Provenance Envelope are used exactly as defined there.

## Problem

A committed pilot hospital runs OPD on a legacy HMS plus Tally: patient registers at the front
desk, pays on the spot, doctor writes on paper. Billing and the day-book are the hospital's
lifeline; the current software is dated, and no system in this segment is AI-ready. We need a
deployable v0 that replaces the front office + billing path outright, is architecturally ready
for the ambient-AI wedge, and leaves accounting in Tally.

## Solution

Multi-tenant web HMS on the better-stack architecture. One hospital = one Organization. v0
delivers: patient registration with per-org MRN and phone dedupe; departments/practitioners;
priced Service Catalog with tax classes; OPD Visit creation with queue and token; charges
accumulating on the Visit; immutable GST-capable Invoices with on-the-spot Receipt printing;
Credit Notes for corrections; daily reports and Tally day-book export; an optional per-doctor
consult screen (diagnosis, Rx print, orders that create Charges). AI ships later; v0 carries the
Provenance Envelope, per-aggregate state machines, and an audit trail on sensitive actions so AI
drafting slots in without rework.

## Validation / Evidence

Contracted/owner-funded: one committed pilot hospital (currently HMS + Tally). Market research
packet: `docs/research/00-synthesis.md`. Not market-validated beyond the pilot; pricing and
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

**Repo**: this repository (`accly-ai/hms`, better-stack base) is the workspace — Slice 1's
bootstrap is done. Package scope is `@better-stack/*`. `files`, `members`, `audit`, and
`dashboard` are product, not examples. The `todo` worked example was deleted in Slice 2
(schema, router, route, tests, `access.ts` grants, drop migration), per
`docs/contributing/project-intent.md`.

**Tenancy & authorization** (repo hard rules; end-to-end path in
`.agents/skills/org-scoped-feature/SKILL.md`):

- Every domain table carries `orgId text NOT NULL` referencing `organization` with
  `onDelete: "cascade"`; `userId` columns are attribution only.
- Procedures are `orgProcedure({ resource: ["action"] }, orgInput.extend(...))`;
  the page's `/org/$orgSlug` route param travels as `input.orgSlug`, and the
  factory's internal guard resolves membership fresh per request and exposes
  verified `context.scope`.
- Every query — including PK lookups — carries `eq(table.orgId, context.scope.orgId)`.
  Mutations are single scoped `UPDATE`/`DELETE ... RETURNING`, never select-then-write, except
  where a multi-statement transaction is the point (invoice issuance, note signing) — those
  re-assert the tenant predicate on every statement inside the transaction.
- Keyset pagination only; tenant-leading indexes matching query order. Pattern files:
  `packages/api/src/routers/files.ts` (keyset-paginated list),
  `packages/api/src/routers/settings.ts` (singleton get/update, admin-gated write).

**Roles (v0, deliberately coarse)**: permissions live in `packages/auth/src/access.ts` only,
granted explicitly per role (no inheritance). New statements and grants:

- All roles (`member`, `admin`, `owner`): `patient: ["create","read","update"]`,
  `visit: ["create","read","update"]`, `billing: ["read","write"]` (charges, invoices,
  payments), `consult: ["read","write"]`, `catalog: ["read"]`, `staff: ["read"]`,
  `settings: ["read"]`, `report: ["read"]` (includes Tally export).
- `admin` + `owner` additionally: `settings: ["update"]`, `catalog: ["create","update"]`,
  `staff: ["create","update"]`, `billing: ["creditNote"]` (credit-note issuance and refund
  recording).
- Signing a consult note requires `consult: ["write"]` **and** the domain check that the
  session user is the Visit practitioner's linked `practitioners.memberUserId`.
- No stored "app role" (amended 2026-08-07): the earlier `member-profiles` table was dropped
  before it gained a writer — its values are derivable (doctor = linked
  `practitioners.memberUserId`; admin = the Better Auth role) and reception-vs-billing has no
  permission or navigation consumer in v0. Console routing derives at login: admin/owner →
  Admin area, linked practitioner → doctor queue, everyone else → front desk/billing (which
  are permission-open by design). A stored routing preference returns only if Slice 5/6 nav
  needs a value this derivation cannot supply. Clinical roles enter `access.ts` as real
  Better Auth roles only when their grants actually diverge (fine-grained roles explicitly
  deferred, to be decided with the pilot).

**Domain schema** (new files in `packages/db/src/schema/`, exported from `schema/index.ts`; all
org-scoped, text PKs (UUID strings) per repo convention, `withTimezone` timestamps, check
constraints in-schema):

- `organization-settings`: 1:1 with organization — legal name, address, tax id (GSTIN/PAN),
  currency (default INR), `mrnPrefix`, `invoicePrefix`, `receiptPrefix`, `creditNotePrefix`,
  `fiscalYearStartMonth` (default 4). Slice 5 adds `followUpValidityDays` (default 14,
  org-editable) for follow-up consult pricing.
- `counter`: (`orgId`, `key`, `value`) with composite PK (org, key); `nextCounter(tx, orgId,
key)` helper (exported from `@better-stack/db/counter`) increments with a single
  conflict-target upsert whose row lock is held until the caller's transaction ends. Keys: `mrn`,
  `token:<practitionerId>:<yyyy-mm-dd>` (tokens are per doctor queue per day, matching real OPD
  practice), `invoice:<fiscalYear>`, `receipt:<fiscalYear>`, `creditNote:<fiscalYear>`,
  `refund:<fiscalYear>`. Document numbers are `{prefix}{fiscalYear}/{seq}`; gapless within a
  series.
- `patients`: MRN (text, unique per org, assigned from counter at insert), name, phone, sex,
  `dateOfBirth` nullable + `ageYears` nullable (check: at least one present), address,
  `createdBy`. Index on (org, phone) for dedupe lookup; keyset-paginated search per stack
  pagination pattern.
- `departments`, `practitioners`: practitioner has name, `departmentId`, registration number,
  nullable `memberUserId` (doctors without logins exist), nullable `consultFeeItemId` →
  catalog. Slice 5 additions (amended 2026-08-07 after the catalog-flexibility review,
  `docs/research/01-catalog-flexibility.md`; mirrors Danphe's employee→department fallback and
  Frappe Health's practitioner→appointment-type→settings chain):
  - `departments.defaultConsultFeeItemId` (nullable → catalog) — the department's standard
    consult fee; a pricier doctor overrides it via their own `consultFeeItemId`.
  - `practitioners.followUpFeeItemId` (nullable → catalog) — follow-up consult pricing,
    first-class in both reference codebases.
  - `practitioners.followUpValidityDays` (nullable) — per-doctor follow-up window override;
    falls back to the org-level `organization_settings.followUpValidityDays`.
- `catalog-items`: name, short code, category enum
  `consultation|procedure|lab|radiology|other`, `unitPrice numeric(12,2)`,
  `taxRatePercent numeric(4,2)` (0 for exempt healthcare services), `taxCode` (HSN/SAC,
  nullable), `active` flag. Soft-deactivate only — Charges snapshot price at creation.
  `catalog.update` writes the new `unitPrice`/`taxRatePercent`/`active` into audit `meta`, so
  the audit trail doubles as the price-change history (the references keep a dedicated
  price-history table; ours is reconstructible from successive entries).
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

**Audit trail** (replaces the earlier `events` table — the base already ships one; amended
2026-08-07): sensitive and destructive successes are recorded in the append-only `auditLog`
via the existing **fire-and-forget `audit()`** (`packages/api/src/audit.ts`) — never awaited,
never able to fail a mutation. Mapping: `action` is the dotted verb (`settings.update`,
`patient.register`, `visit.transition`, `invoice.issue`, `payment.record`, `creditNote.issue`,
`refund.record`, `consultNote.sign`, `charge.void`), `target` is `"<entityType>:<id>"`, `meta`
carries the payload. Reads and list calls are never audited. In-transaction audit (the
repo-documented option for compliance-critical domains) is **deliberately not built now** —
see Explicitly Deferred. `audit.list` (admin/owner) is the read path; no new events router.

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
practitioners), `catalog`, `visit`, `billing` (charges, invoices, payments, credit notes,
refunds), `consult`, `report` (collections, OPD register, unbilled, refund-due, Tally export).
Registered in `appRouter` (`packages/api/src/routers/index.ts`) beside existing
`dashboard/audit/files/members`.

**Web** (`apps/web/src/routes/org/$orgSlug/`): route group per area — `front-desk/`
(register/search, new visit, queue), `billing/` (visit charges → invoice → payment → print),
`consult/` (doctor queue, note editor, Rx print), `admin/` (catalog, staff, settings),
`reports/`. Pages import the singleton `orpc` from `@/lib/orpc` and pass the route `orgSlug` in
every call and tenant-specific invalidation key; mutations refresh explicit query keys (no
realtime). Forms follow the midday-ai React Hook Form pattern: `useZodForm`
(`apps/web/src/hooks/use-zod-form.ts`, `react-hook-form` + `@hookform/resolvers`) with a local
Zod schema mirroring the router contract, defaultValues from the loaded query, and the shared
`Form`/`FormField`/`FormItem`/`FormLabel`/`FormControl`/`FormMessage` +
`SubmitButton` primitives in `packages/ui`. UI follows `packages/ui` (`base-lyra`: zero radius, `text-xs`,
compact); motion rationed per repo UI rules — this is an all-day console.

**Onboarding the pilot**: sign-up stays disabled (ADR 0013). The pilot hospital's Organization
is created by the founding account (`scripts/create-founder.ts`, ADR 0014); staff accounts by an
operator via `scripts/create-user.ts` and invited as members with Better Auth roles.

**Out of the stack's way**: no new infrastructure — no queues, no workers, no websockets, no
search engine. Dedupe is an indexed phone lookup; reports are SQL.

## Test Seams

Existing seams only; prior art in `tests/` (real Postgres via `tests/support/database.ts`,
helpers `createTestUser`/`createOrganization`/`joinOrganization`/`clientFor`/`expectORPCCode`
from `tests/support/`; assert oRPC codes, not message text):

1. **Tenancy** (`tests/integration/tenancy.test.ts`, extended per domain — the repo's mandated
   four questions): foreign-org data invisible; same client works against two orgs
   concurrently; a request naming a foreign org is `FORBIDDEN`; a removed member is `FORBIDDEN`
   on the very next request.
2. **Domain integration** (new files under `tests/integration/`): counter concurrency (parallel
   `nextCounter` yields gapless unique sequence); charge/invoice state transitions
   (double-invoice attempt fails; voiding an invoiced charge fails); signed note immutability;
   register→visit→bill→pay happy path through routers; credit-note over-issue rejected;
   crediting a partially and a fully paid invoice surfaces the correct refund-due balance;
   refund exceeding credited or paid amount rejected; sign-consult authorization (non-linked
   member rejected); every sensitive mutation records its `audit()` row (asserted with
   `eventually`, per the repo's audit testing guidance — the write is fire-and-forget).
3. **Unit** (`tests/unit/`): document-number formatting (fiscal year rollover); invoice-line
   math — pro-rata discount allocation whose lines sum exactly to header totals (incl. rounding
   remainder on the largest line), multi-rate tax; credit-note math — full credit of every line
   reproduces invoice totals exactly, partial-credit gross→taxable derivation; CGST/SGST
   display split; Tally XML builder output shape.

Verify commands are the repo's real ones: `bun run check-types`, `bun run check`,
`bun run test` (Postgres up via `bun run db:up`; the suite uses and wipes `better_stack_test`).

## Task Plan

- [x] Slice 1: Bootstrap — **done**. This repository (`accly-ai/hms`, better-stack base) is the
      workspace: fresh history, migrations regenerated (`0000_fine_starbolt.sql`), spec lives at
      `docs/specs/accly-hms-v0.md`, and the full gate passes (verified 2026-08-07:
      `bun run check-types && bun run check && bun run test` → 40/40).
- [x] Slice 2: Foundation — settings, counter; RHF form stack; `todo`
      deleted — **done** (2026-08-07, this session).
  - Delivered: `organization_settings` and `counter` tables + generated
    migration `0001_graceful_moon_knight.sql`; `nextCounter(tx, orgId, key)` exported from
    `@better-stack/db/counter`; `settings` router get/update declared with
    `orgProcedure({ settings: [...] }, orgInput.extend(...))` and per-role grants
    in `access.ts` (read: all roles; update: admin/owner); `settings.update`
    audited fire-and-forget;
    settings page under `org/$orgSlug/admin/settings` built on the new RHF primitives
    (`packages/ui` `form.tsx` + `submit-button.tsx`, `useZodForm` hook); `todo` domain fully
    removed (schema, router, route, nav, dashboard tile, seed, grants, tests) with its drop
    migration; seed now writes Mercy's settings row.
  - Verified: `bun run check-types && bun run check && bun run test` → 45/45 (counter
    concurrency gapless under 25 parallel transactions, rollback leaves no gap; tenancy
    four-questions for `settings`; admin-gating; audit-trail keyset paging); browser
    smoke test — form renders seeded values, pristine-disabled save, dirty save → toast,
    exact value round-trip after reload.
  - Interfaces delivered: `nextCounter(tx, orgId: string, key: string): Promise<number>`;
    `settings.get/update({ orgSlug, … }) → SettingsFields`; `SETTINGS_DEFAULTS` in
    `@better-stack/db/schema/organization-settings`; settings read used by every print view
    and numbering call.
- [x] Slice 3: Patients — register, dedupe, search — **done** (2026-08-07, this session).
  - Delivered: `patients` table (org-scoped, unique (org, mrn), (org, phone) dedupe index,
    (org, createdAt desc, id desc) keyset index, sex/age/dob check constraints) + generated
    migration `0002_thick_roxanne_simpson.sql`; `patient` router
    (`register`/`search`/`get`/`update`) — register allocates MRN
    `{mrnPrefix}{seq padStart 6}` from counter key `mrn` inside one transaction, search is
    keyset-paginated with exact-phone dedupe filter and name/MRN/phone substring query,
    update is a single scoped `UPDATE … RETURNING`; `patient: ["create","read","update"]`
    granted to all three roles in `access.ts`; `patient.register`/`patient.update` audited
    fire-and-forget; front-desk pages (search index, register with live duplicate-phone
    warning panel, patient detail/edit) on the RHF form stack plus a permission-gated
    "Front desk" nav entry.
  - Verified: `bun run check-types && bun run check && bun run test` → 56/56 (MRN
    sequencing per org and with prefix; phone dedupe; substring search; keyset pagination
    walk without gaps/duplicates; NOT_FOUND on foreign/unknown ids; dob-or-age validation;
    audit rows via `eventually`; tenancy four-questions for `patient` incl. the
    guarded-call sweep); browser smoke — register → MRN `000001` toast + detail page,
    duplicate-phone warning lists the existing patient, search by name returns the row.
  - Interfaces delivered: `patient.register/search/get/update({ orgSlug, … })`; Patient row
    shape for visit + billing slices (id, mrn, name, phone, sex ("male"|"female"|"other"),
    dateOfBirth `YYYY-MM-DD`|null, ageYears|null, address).
- [x] Slice 4: Catalog, departments, practitioners (admin CRUD) — **done** (2026-08-07, this
      session).
  - Delivered: `departments` (unique (org, name)), `catalog_items` (unique (org, code),
    category/price/tax checks, `active` soft-deactivation flag, name-ordered tenant indexes),
    and `practitioners` (nullable `memberUserId`/`consultFeeItemId`, org+name and
    org+department indexes) tables + generated migration `0003_sudden_living_lightning.sql`;
    `catalog` router (`list` with category/activeOnly filters as an unpaginated picker feed,
    `create`, `update` — deactivation is `update { active: false }`, duplicate code →
    `CONFLICT`) and `staff` router
    (`listDepartments`/`createDepartment`/`updateDepartment`/`listPractitioners`/
    `createPractitioner`/`updatePractitioner`) with org-scoped existence checks on
    `departmentId`, `consultFeeItemId`, and `memberUserId` (foreign ids → `NOT_FOUND`; FKs
    alone never prove tenancy); `catalog`/`staff` statements granted read to all roles,
    create/update to admin/owner only, in `access.ts`; all six mutations audited
    fire-and-forget; admin pages `org/$orgSlug/admin/catalog` (filterable table,
    create/edit dialogs on the RHF stack, deactivate via edit) and `admin/staff`
    (departments + practitioners sections, member and consultation-fee pickers) plus
    permission-gated Catalog/Staff nav entries.
  - Verified: `bun run check-types && bun run check && bun run test` → 74/74 (CRUD
    roundtrips; duplicate code/name `CONFLICT` in-org but legal cross-org; deactivation
    hidden from `activeOnly` but not plain list; member-role writes `FORBIDDEN` while reads
    pass; cross-org department/consult-fee/member references `NOT_FOUND`; audit rows via
    `eventually`; tenancy four-questions for `catalog` and `staff` incl. the guarded-call
    sweep; access-matrix rows). Browser smoke — create item → row + toast, deactivate →
    Inactive badge + hidden under Active-only, reactivate, create department, create
    practitioner linked to department + member + consult-fee item, row resolves all three.
  - Interfaces delivered: `catalog.list({ orgSlug, category?, activeOnly? })` →
    name-ordered rows for visit/consult/billing pickers; practitioner shape (id, name,
    departmentId, registrationNumber, memberUserId, consultFeeItemId) for Slice 5;
    `catalog.update` audits new price/tax/active values in `meta` (price-change history,
    added 2026-08-07 after the catalog-flexibility review).
- [ ] Slice 5: Visits — OPD ticket + queue
  - Acceptance: create Visit (patient + department + practitioner) → daily token from counter +
    auto consult-fee Charge (pending, snapshotted). Fee item resolution, in order:
    1. follow-up — the practitioner's `followUpFeeItemId`, when set and the patient has a
       non-cancelled visit with the same practitioner within the follow-up window
       (practitioner's `followUpValidityDays`, else the org setting);
    2. the practitioner's `consultFeeItemId` (the "this doctor charges more" override);
    3. the department's `defaultConsultFeeItemId`;
    4. none resolved → the visit is still created, with no auto charge — the front desk adds
       a catalog/manual charge in billing (fail-open here is a workflow choice: registration
       must never block on fee configuration).
       Queue view per practitioner/department with status transitions waiting→in_consult→completed,
       waiting→cancelled (cancel voids the visit's pending charges with reason); visit slip print;
       creation and transitions audited via `audit()`.
  - Verify: integration test asserts charge auto-creation with snapshotted price and the legal
    transition set; illegal transition rejected; fee resolution covers all four rungs
    (follow-up inside the window, practitioner override, department default, no-charge
    fallback) and the per-practitioner window overrides the org default; tenancy
    four-questions for `visit`.
  - Depends on: Slices 3, 4
  - Owns/Touches: `packages/db/src/schema/{visits,charges}.ts`, additive migrations extending
    `practitioners` (`followUpFeeItemId`, `followUpValidityDays`), `departments`
    (`defaultConsultFeeItemId`), and `organization_settings` (`followUpValidityDays`),
    `packages/api/src/routers/visit.ts` (+ `staff`/`settings` router fields for the new
    columns), `apps/web/src/routes/org/$orgSlug/front-desk/*`
    (queue routes); adds `visit` statement/grants in `access.ts` (coordinator-owned).
  - Interfaces: Charge row shape + `billing.listPendingCharges({ orgSlug, visitId })` consumed
    by billing; visit status consumed by consult slice; `visit.create/transition` contracts.
- [ ] Slice 6: Billing — invoice, payment, receipt, credit note, refund (riskiest domain logic)
  - Acceptance: billing screen shows pending Charges per Visit; add manual/catalog Charge; void
    pending Charge with reason; issue Invoice in one transaction (number from fiscal series,
    invoice-lines materialized with allocated discount/taxableValue/taxAmount/gross, header
    totals as line sums, charges → invoiced, `invoice.issue` audited) — issued
    Invoice has no update path; record payments (cash/upi/card) — **partial payments are
    normal**, each capped at the current positive outstanding and each printing its own
    numbered Receipt (the invoice is the itemized service record; a receipt only proves a
    payment); Credit Note issuance with lines referencing invoice-lines (full-line = exact
    snapshot copy, partial = gross-entered), capped per invoice-line and in total, guarded by
    `billing: ["creditNote"]` (admin/owner); Refund recording against a Credit Note with
    refund-due surfaced on the billing screen; A5 + thermal print views render from snapshot
    data only.
  - Verify: integration tests — double-invoice race (two concurrent issuances of same charges:
    one wins), payment exceeding current positive outstanding rejected (incl. paying after a
    credit on an unpaid invoice), per-line and total credit over-issue rejected,
    discounted-invoice partial credit yields correct GST breakup, credit on fully/partially
    paid invoice yields correct refund-due, refund invariants enforced (refund above current
    refund-due rejected — named scenario: G=100, P=50, CN=80 → refund capped at 30, attempt of
    50 rejected; per-credit-note: refund riding on a small credit note while a larger credit
    exists elsewhere on the invoice is rejected), numbering gapless under 20 concurrent
    issuances; member-role credit-note attempt `FORBIDDEN`; tenancy four-questions for
    `billing`; unit tests for totals/tax-split.
  - Depends on: Slice 5
  - Owns/Touches:
    `packages/db/src/schema/{invoices,invoice-lines,credit-notes,credit-note-lines,payments,refunds}.ts`,
    `packages/api/src/routers/billing.ts`, `apps/web/src/routes/org/$orgSlug/billing/*` incl.
    print views; adds `billing` statement/grants in `access.ts` (coordinator-owned); invoice
    math helpers in `packages/api/src/lib/` (unit-testable pure functions).
  - Interfaces: `billing.issueInvoice({ orgSlug, visitId, discountAmount?, discountReason? })`,
    `billing.recordPayment`, `billing.issueCreditNote({ orgSlug, invoiceId, reason, lines:
[{ invoiceLineId, gross } | { invoiceLineId, full: true }] })`,
    `billing.recordRefund({ orgSlug, creditNoteId, method, amount, reference? })`, and a
    `billing.invoiceBalance` read (grandTotal, creditTotal, paymentsTotal, refundsTotal,
    outstanding); invoice/payment/credit-note/refund shapes consumed by the reports slice.
- [ ] Slice 7: Consult screen — note, Rx, orders, signing
  - Acceptance: doctor queue lists own waiting/in_consult Visits; note editor (chief complaint,
    diagnosis lines, prescription lines, orders from lab/radiology/procedure catalog); sign is
    one transaction: note→signed, orders→active, one pending Charge per order,
    `consultNote.sign` audited; signed content immutable — edits rejected, addenda
    appendable; A5 prescription
    print; signing rejected unless session user is the visit practitioner's linked member;
    provenance columns written as `member`.
  - Verify: integration tests for sign transaction effects, immutability, and authorization;
    tenancy four-questions for `consult`; manual print check.
  - Depends on: Slice 5 (and Slice 4 catalog categories)
  - Owns/Touches: `packages/db/src/schema/{consult-notes,diagnosis-lines,prescription-lines,orders,note-addenda}.ts`,
    `packages/api/src/routers/consult.ts`, `apps/web/src/routes/org/$orgSlug/consult/*`; adds
    `consult` statement/grants in `access.ts` (coordinator-owned).
  - Interfaces: order→Charge creation reuses Slice 5 Charge shape with `sourceType='order'`;
    no other slice consumes consult internals.
- [ ] Slice 8: Reports + Tally export
  - Acceptance: daily collections by method (payments minus refunds, credit notes listed
    separately), OPD register (visits + invoice totals per day), unbilled-activity list (visits
    with pending Charges older than N hours), refund-due list (invoices with negative
    outstanding); date-range Tally XML + CSV export downloads containing every invoice,
    payment, credit note, and refund exactly once; export documents ledger-name convention on
    screen.
  - Verify: integration test seeds a day of activity and asserts report totals equal the sum of
    issued documents; unit test validates Tally XML structure; tenancy four-questions for
    `report`.
  - Depends on: Slice 6
  - Owns/Touches: `packages/api/src/routers/report.ts`,
    `apps/web/src/routes/org/$orgSlug/reports/*`; Tally XML builder in
    `packages/api/src/lib/tally.ts`; adds `report` statement/grants in `access.ts`
    (coordinator-owned).
  - Interfaces: consumes billing shapes from Slice 6; produces nothing downstream.

Parallelism: Slices 3 and 4 have disjoint write sets and may run concurrently after Slice 2.
Slices 6 and 7 both write charge state — run sequentially or coordinate on the charge
transition queries. Shared files touched by every slice — `packages/auth/src/access.ts`,
`packages/db/src/schema/index.ts`, `packages/api/src/routers/index.ts`,
`tests/integration/tenancy.test.ts` — are coordinator-owned: each slice appends its own
statements/exports/cases only.

## Out of Scope

Pharmacy POS/stock, lab result entry, IPD/beds/ADT, surgery/OT, insurance/TPA, ABDM integration,
payment gateways, offline mode, general ledger/accounting, appointments/scheduling (walk-in
queue only in v0), SMS/WhatsApp messaging, patient portal, multi-branch organizations, any AI
feature (including the ambient scribe — separate spec after the speech feasibility spike).

## Explicitly Deferred

- Tally voucher/ledger mapping refinement with the pilot's accountant (generic mapping ships).
- GST rate table per service class from an accountant (v0 ships rates as org-editable catalog
  fields; engineering does not hard-code tax law).
- Fine-grained API-level role permissions (v0: coarse `access.ts` grants above + linked
  practitioner-only signing).
- ICD coding on diagnosis lines (column exists, unused).
- Thermal-printer format tuning against the pilot's actual hardware.
- Catalog satellite tables (deferred 2026-08-07 after the catalog-flexibility review,
  `docs/research/01-catalog-flexibility.md` — each is additive beside the flat catalog
  because Charges snapshot price/tax, so adopting one never reprices history):
  price categories/schemes (per-payer tariffs — v0 pilot is cash-only; becomes a
  `(priceCategoryId, catalogItemId) → price` map when insurance/TPA enters the roadmap),
  packages/panels (bundle master + member items), per-line performer attribution for
  doctor-share payouts, billing-department linkage on catalog items, and an org-editable
  category master (the closed enum is load-bearing for Slice 7 order restrictions and Tally
  mapping; new values are one additive enum migration).
- In-transaction audit for clinical/financial mutations (user decision 2026-08-07: keep
  fire-and-forget `audit()` for now; revisit when a compliance requirement demands
  commit-atomic entries).
- Appointment booking (queue-first per pilot's walk-in reality).

## Open Questions

None. Business questions (pricing, ABDM timeline, speech spike) live in
`docs/01-mvp-decisions.md` and do not block v0 implementation.
