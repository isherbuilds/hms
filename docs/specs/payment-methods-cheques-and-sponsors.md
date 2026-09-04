# Spec: Payment methods, cheque lifecycle, and sponsor capture

Status: ready
Authority: user request, 2026-09-03 — extend payment methods, handle cheques
honestly, and capture a patient's sponsor so payer volume can be measured.
Evidence: [reference payment methods and payers](../research/reference-payment-methods-and-payers.md).
Supersedes: none

## Problem

Three separate gaps, all at the cash counter.

1. **The desk can only record cash, UPI, and card.** Bank transfers, cheques,
   and the once-a-month oddity have nowhere to go, so they get recorded as
   whichever of the three is closest. The ledger then describes money that never
   moved that way.
2. **A cheque is not cash on the day it is handed over.** Recording one as a
   bank receipt inflates the bank balance for the weeks it takes to clear, and a
   bounced cheque leaves an invoice marked paid with the money never arriving —
   the bill silently leaves the billing worklist and nobody chases it.
3. **Nothing records that a patient is covered by an employer or insurer.** So
   there is no way to answer the question that decides whether the payer domain
   is worth building at all: what fraction of visits involve someone other than
   the patient paying.

## Solution

The desk gets six payment methods: Cash, UPI, Card, Bank transfer, Cheque, and
Other. Everything but cash still requires a reference. Cheque and Other post to a
new **Other Settlements** clearing account rather than to Bank, so an uncleared
cheque never pretends to be money in the bank.

A cheque then has two more moments. When it clears, back office marks it cleared
and the money moves from Other Settlements to Bank. When it bounces, they mark it
bounced: the ledger entry is reversed, the invoice goes back to outstanding, and
it reappears in the billing worklist. Uncleared cheques are listed so none is
forgotten.

Registration gains a **Sponsor** section, collapsed by default. Most patients are
self-paying and the desk sees nothing extra. When a patient is covered, the
receptionist picks the organisation from a list an admin maintains, and records
the policy or employee number. This changes no bill: the patient is still
invoiced, and an uncovered balance still reads as outstanding. It is measurement,
not billing.

## Validation / Evidence

Owner-funded, pre-pilot. Not externally validated, and one part is explicitly a
measurement instrument rather than a bet.

- The research memo pins Bahmni `04a5299`, Danphe `9963822`, and Marley `4d8bfc3`
  and establishes: modelling a payer as a payment-method value makes an unpaid
  bill read as settled (Bahmni seeds RSBY as a cash journal); no reference ships
  a cheque clearing account; both peers with a payer model post the payer's share
  to a separate receivable at invoice time.
- **Baseline:** zero of the six methods beyond cash/UPI/card exist; zero sponsor
  data is captured; a bounced cheque is unrepresentable.
- **Target outcome:** after one month of pilot use, two counts are answerable
  from our own data — the share of collections by method outside cash/UPI/card,
  and the share of registered patients carrying a sponsor. Those two numbers
  decide whether the payer domain (out of scope here) gets built.
- **Unproved risk, accepted:** we do not know that cheque volume justifies the
  clear/bounce lifecycle. It is built anyway because the failure mode without it
  is silent uncollected money, which is not acceptable at any volume.

## User Stories / Scenarios

1. As a **cashier**, I want to record a bank transfer or cheque against an
   invoice, so that the receipt names how the money actually arrived.
2. As an **accountant**, I want an uncleared cheque to sit in its own account
   until it clears, so that the bank balance I reconcile matches the bank.
3. As an **accountant**, I want to mark a cheque cleared, so that the money moves
   to Bank on the day it actually arrived.
4. As an **accountant**, I want to mark a cheque bounced, so that the invoice
   returns to outstanding and the desk chases the patient again.
5. As an **accountant**, I want to see every cheque still uncleared, so that none
   is forgotten between collection and the bank statement.
6. As a **receptionist**, I want to record that a patient is covered by an
   employer or insurer, including their policy or employee number, without it
   slowing down the ordinary self-paying registration.
7. As an **administrator**, I want the list of sponsor organisations to be a
   maintained master, so that the same insurer is not spelled three ways.

## Implementation Decisions

### Payment methods

- `paymentMethod` in `packages/api/src/lib/schemas.ts` becomes
  `["cash", "upi", "card", "bank", "cheque", "other"]`. It stays a **fixed enum**,
  not a deployer-editable master. The research is decisive: Danphe's editable
  master ships with no create endpoint and a ledger mapping the posting code
  ignores; ERPNext ships four of five modes unmapped, so a fresh install throws
  at the counter. A closed enum with an exhaustive `settlementAccountFor` is the
  safety both lack.
- The `payments_method_check` and `refunds_method_check` constraints in
  `packages/db/src/schema/payments.ts` and `refunds.ts` list the same six values.
- `needsReference` in `apps/web/src/lib/settlement.ts` is unchanged — "anything
  but cash" already covers the three new methods correctly.
- `PAYMENT_METHODS` gains `bank` → "Bank transfer", `cheque` → "Cheque",
  `other` → "Other". `methodLabel`'s capitalisation rule still holds for all six.
- The split-line cap stays at four (`billing.recordPayments`,
  `opd.settle`). Both references that support split tender are unbounded, and
  Danphe validates the sum nowhere; our bound and our server-side total check
  stay.

### Ledger

- `SYSTEM_ACCOUNTS` in `packages/api/src/lib/ledger.ts` gains
  `settlement_other`, code **1150**, name **Other Settlements**, type `asset`.
  `ensureChartOfAccounts` already back-fills missing system accounts per org on
  the next posting, so existing orgs need no migration.
- `settlementAccountFor` maps `cash` → `cash`; `upi`, `card`, `bank` → `bank`;
  `cheque`, `other` → `settlement_other`. It keeps throwing on an unknown method
  — no fallback account.

### Cheque lifecycle

- `payments` gains `clearedAt` and `bouncedAt`, both nullable timestamps, plus
  `outcomeNote` (nullable text, the bounce reason or the clearing remark). A
  partial index on `(orgId, businessDate)` where both are null serves the
  uncleared list.
- New procedure **`billing.recordChequeOutcome`** — `{ orgSlug, paymentId,
outcome: "cleared" | "bounced", note? }`. One scoped conditional `UPDATE ...
RETURNING` guarded on `clearedAt is null and bouncedAt is null`; no row
  returned collapses missing and already-settled into one `CONFLICT`, per D026.
- **Permission is `billing: ["creditNote"]`, not `billing: ["write"]`.** A bounce
  reopens a settled bill, which is a correction, and the research found
  corrections gated above collection in every reference that gates them at all.
  This also keeps clearing off the front desk, where it is not desk work. Roles
  affected: `owner`, `admin`, `accountant` gain it; `cashier` and `reception` do
  not.
- Journal entries. `journal_entries` is unique on `(orgId, sourceType, sourceId)`,
  so the outcome cannot reuse `sourceType: "payment"`. Cleared posts
  `sourceType: "payment_cleared"`, debit `bank` / credit `settlement_other`.
  Bounced posts `sourceType: "payment_bounced"`, debit `patient_receivables` /
  credit `settlement_other` — the exact reverse of the original receipt.
- **A bounced payment stops counting as paid.** The payment row is never deleted,
  so its receipt number and audit trail survive, but every place that sums
  payments must exclude `bouncedAt is not null`. There are four such places and
  missing one makes the invoice and the worklist disagree:
  `packages/api/src/lib/invoice-balance.ts` (the `movements` CTE),
  `packages/api/src/routers/billing-worklist.ts` (the outstanding predicate and
  the day's collections aggregate), and `packages/api/src/routers/dashboard.ts`
  (today's collections). This is the riskiest edit in the spec.
- A receipt for a bounced cheque stays printable — it is a real historical
  document — but must be visibly marked as bounced, or the desk can hand out
  proof of money that never arrived.

### Dashboard collections

`packages/api/src/routers/dashboard.ts` currently hardcodes three `filter`
columns for cash, UPI, and card, and the card renders only two of them. With six
methods the "Collected today" total would include bank and cheque while the
breakdown pretends they do not exist. Replace the three columns with a single
`group by method` and render the breakdown from what actually came in.

### Sponsor capture

- **New table `payers`** — `id`, `orgId`, `name`, `type`
  (`insurer | tpa | corporate | scheme`), `active`, `createdAt`. Unique on
  `(orgId, name)`. This is a master, not free text: without it, "Star Health",
  "star health ltd", and "STAR" all land in the same column and the month of data
  cannot be counted, which defeats the only reason this slice exists.
- **New table `patient_payers`** — `id`, `orgId`, `patientId`, `payerId`,
  `policyNumber`, `employeeNumber`, `validFrom`, `validTill`, `createdAt`.
  Composite tenant foreign keys `(orgId, patientId)` and `(orgId, payerId)`.
- **The table allows many rows per patient; the API writes at most one.** A
  patient can hold a corporate plan and an insurance policy at once and both
  expire, so the shape must permit it — but v1 registration captures a single
  sponsor, so `patient.register` / `patient.update` accept an optional
  `sponsor: { payerId, policyNumber?, employeeNumber? } | null` and upsert or
  delete that one row inside the same transaction as the patient write. No
  separate mutation, no new optimistic-concurrency token.
- **The sponsor type is derived from `payers.type`, never stored on the link.**
  "General / self-paying" is the absence of a `patient_payers` row, not an enum
  value.
- **New permission statement `payer: ["create", "read", "update"]`.** `owner` and
  `admin` get all three; `reception`, `cashier`, and `accountant` get `read`
  only. Reception deliberately cannot create a payer — uncontrolled creation at
  the counter is exactly how a master degrades into free text.
- **Claim number and referral number are not captured.** They belong to a visit,
  not a person — a patient has many claims over the years — and there is no claim
  to number until the payer domain exists.
- **This changes no billing behaviour.** The invoice is still addressed to the
  patient, `calculateInvoiceBalance` is untouched, and an uncovered balance stays
  outstanding. The registration section carries help text saying so, because the
  failure mode is a receptionist assuming the bill now goes to the company and
  stopping the chase.

### UI

- The Sponsor section is a `FieldSet` in `apps/web/src/components/patient-form.tsx`,
  which currently has no section boundaries. Default is self-paying; the payer
  picker, policy number, and employee number are revealed only when a sponsor
  type is chosen. Label it **Sponsor** — "Advanced" is developer language and the
  page-header grammar in Design calls for a plain noun.
- The uncleared-cheque list is a `Panel` under `ListState` on a route beneath
  `$orgSlug/billing/`, following the list grammar in Design (toolbar above,
  panel holds its height when empty, count in the footer).
- The payer master is administered from a Settings page, following the existing
  catalog settings pattern.

## Test Seams

Prior art: `tests/integration/accounting.test.ts` already asserts ledger lines by
system key and code and checks entries balance (`journalFor`, `lineBySystemKey`,
`lineByCode`, `expectBalanced`); `tests/integration/billing.test.ts` covers
split payments and refunds through the oRPC client; `tests/unit/settlement.test.ts`
covers the pure settlement rules; `tests/integration/tenancy.test.ts` is the
four-question tenancy harness.

- **`billing.recordPayments` (existing oRPC seam)** — a cheque payment posts to
  `settlement_other` (1150) and a bank payment posts to `bank` (1100); a
  reference is required for both.
- **`billing.recordChequeOutcome` (new oRPC seam)** — clearing moves 1150 → 1100
  and leaves the invoice settled; bouncing reverses to patient receivables and
  the invoice's `outstanding` returns to its pre-payment figure; a second outcome
  on the same payment is `CONFLICT`; a cashier is `FORBIDDEN`.
- **`billing.listInvoices` / the worklist procedure (existing seams)** — after a
  bounce the invoice reappears in the outstanding worklist and the day's
  collections figure drops by the bounced amount. This is the assertion that
  proves all four payment-sum sites were updated together.
- **`patient.register` / `patient.update` (existing oRPC seams)** — a sponsor
  round-trips; passing `null` removes it; a `payerId` from another org is
  `NOT_FOUND`.
- **`payer.*` (new oRPC seam)** — the four tenancy questions, plus reception
  being `FORBIDDEN` on create.
- **`settlement.ts` (existing unit seam)** — `needsReference` and
  `nextPaymentLine` over all six methods.

## Task Plan

- [ ] **Slice 1: Six payment methods and the 1150 account**
  - Acceptance: a cashier can record a bank, cheque, or other payment with a
    reference; cheque and other post to a new asset account coded 1150 named
    "Other Settlements"; bank posts to 1100; the receipt PDF prints a readable
    method label rather than a shouted enum; the dashboard's collections
    breakdown is derived from a `group by method` and names every method that
    was actually collected today.
  - Verify: `bun run check-types && bun run check && bun run test`, plus a new
    accounting assertion that a cheque payment debits code 1150.
  - Depends on: none
  - Owns/Touches: `packages/api/src/lib/schemas.ts`,
    `packages/api/src/lib/ledger.ts`, `packages/db/src/schema/payments.ts`,
    `packages/db/src/schema/refunds.ts`, `packages/db/src/migrations/` (generated),
    `apps/web/src/lib/settlement.ts`,
    `apps/web/src/components/pdf/billing-documents.tsx`,
    `packages/api/src/routers/dashboard.ts`,
    `apps/web/src/routes/$orgSlug/dashboard.tsx`,
    `tests/integration/accounting.test.ts`, `tests/unit/settlement.test.ts`
  - Interfaces: produces `PaymentMethod = "cash" | "upi" | "card" | "bank" |
"cheque" | "other"`; `settlementAccountFor(method): SystemAccountKey` now
    returns `"settlement_other"` for cheque and other; `SystemAccountKey` gains
    `"settlement_other"`.

- [ ] **Slice 2: Cheque clear and bounce** — riskiest slice
  - Acceptance: an accountant can mark an uncleared cheque cleared, moving 1150 →
    1100 with a balanced entry; or bounced, reversing to patient receivables; a
    bounced payment no longer counts toward the invoice's paid total, the
    invoice's outstanding returns to its pre-payment figure, it reappears in the
    outstanding worklist, and the day's collections drop by that amount; a second
    outcome on the same payment returns `CONFLICT`; a cashier is `FORBIDDEN`; the
    receipt for a bounced payment still renders and is visibly marked bounced.
  - Verify: `bun run check-types && bun run check && bun run test`, with a new
    integration test covering clear, bounce, double-outcome conflict, and the
    worklist reappearance.
  - Depends on: Slice 1
  - Owns/Touches: `packages/db/src/schema/payments.ts` (coordinator-owned —
    also written by Slice 1, so these must run in sequence, never in parallel),
    `packages/db/src/migrations/` (generated), `packages/auth/src/access.ts`,
    `packages/api/src/routers/billing.ts`,
    `packages/api/src/lib/invoice-balance.ts`,
    `packages/api/src/routers/billing-worklist.ts`,
    `packages/api/src/routers/dashboard.ts` (coordinator-owned — also Slice 1),
    `apps/web/src/components/billing-document-view.tsx`,
    `tests/integration/billing.test.ts`, `tests/integration/accounting.test.ts`
  - Interfaces: produces `billing.recordChequeOutcome({ orgSlug, paymentId,
outcome: "cleared" | "bounced", note? })`; `payments.clearedAt`,
    `payments.bouncedAt`, `payments.outcomeNote`; journal `sourceType` values
    `"payment_cleared"` and `"payment_bounced"`.

- [ ] **Slice 3: Uncleared cheque list**
  - Acceptance: a route under billing lists every cheque with neither outcome
    recorded, newest first, showing patient, invoice number, amount, cheque
    reference, and days since collection; each row offers Cleared and Bounced;
    the panel holds its height and says what would be there when empty; the list
    is empty for a different org.
  - Verify: `bun run check-types && bun run check && bun run test`
  - Depends on: Slice 2
  - Owns/Touches: `packages/api/src/routers/billing.ts` (coordinator-owned —
    also Slice 2), a new route file under
    `apps/web/src/routes/$orgSlug/billing/`, `tests/integration/billing.test.ts`
  - Interfaces: consumes `billing.recordChequeOutcome`; produces a list
    procedure returning uncleared cheque payments with their invoice and patient
    identity.

- [ ] **Slice 4: Payer master and patient link**
  - Acceptance: an admin can create, rename, and deactivate a payer; two payers
    cannot share a name within one org; reception can read the list but is
    `FORBIDDEN` on create; the four tenancy questions pass for `payer`; a
    `patient_payers` row cannot reference a payer from another org.
  - Verify: `bun run check-types && bun run check && bun run test`
  - Depends on: none — independent of Slices 1–3, and its write set is disjoint
    from theirs except `packages/auth/src/access.ts`, which Slice 2 also edits.
    Run it before Slice 2 or after Slice 3, not concurrently.
  - Owns/Touches: `packages/db/src/schema/payers.ts` (new),
    `packages/db/src/schema/patient-payers.ts` (new),
    `packages/db/src/schema/index.ts`, `packages/db/src/migrations/` (generated),
    `packages/auth/src/access.ts` (coordinator-owned — also Slice 2),
    `packages/api/src/routers/payer.ts` (new),
    `packages/api/src/routers/index.ts`, a Settings route under
    `apps/web/src/routes/$orgSlug/`, `tests/integration/tenancy.test.ts`
  - Interfaces: produces the `payers` and `patient_payers` tables; the `payer:
["create", "read", "update"]` permission statement; `payer.list`,
    `payer.create`, `payer.update`.

- [ ] **Slice 5: Sponsor on registration**
  - Acceptance: registration shows a collapsed Sponsor section defaulting to
    self-paying; choosing a sponsor reveals the payer picker, policy number, and
    employee number; the sponsor round-trips through register and update;
    clearing it removes the link row in the same transaction as the patient
    write; a foreign `payerId` is `NOT_FOUND`; help text states that the bill is
    still addressed to the patient; a self-paying registration requires no extra
    keystrokes.
  - Verify: `bun run check-types && bun run check && bun run test`
  - Depends on: Slice 4
  - Owns/Touches: `packages/api/src/routers/patient.ts`,
    `apps/web/src/lib/form-schema.ts`,
    `apps/web/src/components/patient-form.tsx`,
    `apps/web/src/components/patient-record/` (sponsor readout),
    `tests/integration/patient.test.ts`
  - Interfaces: consumes `payer.list`; extends `patient.register` and
    `patient.update` input with `sponsor: { payerId, policyNumber?,
employeeNumber? } | null`.

- [ ] **Slice 6: Record the decisions**
  - Acceptance: a new decision entry states that insurance, TPA, and corporate
    credit are never payment-method values, cites the research memo, and names
    the payer-domain shape that evidence settled; a second states that cheque and
    other settle through a 1150 clearing account with an explicit outcome; the
    research ledger's memo line notes the decisions it produced; Product and
    Architecture describe the six methods, the cheque lifecycle, and sponsor
    capture as measurement only.
  - Verify: `bun run check`
  - Depends on: Slice 5
  - Owns/Touches: `docs/decisions.md`, `docs/product.md`,
    `docs/architecture.md`, `docs/research/README.md`
  - Interfaces: none.

## Out of Scope

- The payer domain itself: coverage percentages, a payer receivable, the split of
  patient share from payer share, claim documents and states, claims worklists,
  remittance reconciliation, disallowance write-offs, per-payer price lists, and
  pre-authorisation. The research settles the shape; only pilot data settles
  whether to build it.
- Claim numbers and referral numbers on registration.
- Any change to how an invoice is addressed or how its outstanding is computed.
- Bank charges on a bounced cheque.
- Post-dated cheques, and any automatic clearing from a bank statement import.
- A configurable payment-method master.

## Explicitly Deferred

Accepted omissions. A later review must not treat these as blockers.

- **No report counts sponsor coverage or method mix.** The data lands in tables
  that plain SQL can answer, and the falsification step in the research memo is a
  one-off question, not a screen.
- **No reminder or ageing alert on an uncleared cheque.** The list shows days
  since collection; a human reads it.
- **A patient carries at most one sponsor through the API**, though the schema
  permits several.
- **No bulk import of payers.** An admin types them, and there will be few.
- **Deactivating a payer does not touch existing links.** History stays as it
  was recorded.

## Open Questions

None. The two that governed this spec — scope, and where cheque and other settle
— were answered on 2026-09-03: all three areas, and a new 1150 Other Settlements
clearing account.
