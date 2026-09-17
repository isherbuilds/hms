# Spec: Payment methods, bank transfer, and sponsor capture

Status: ready
Authority: user request, 2026-09-04 — add bank transfer and capture a patient's
sponsor so payer volume can be measured.
Evidence: [research ledger](../research/README.md#adopted-findings) (Payer model).
Supersedes: none

## Problem

Two separate gaps, all at the cash counter.

1. **The desk can only record cash, UPI, and card.** Bank transfers have
   nowhere to go, so they get recorded as whichever of the three is closest.
   The ledger then describes money that never moved that way.
2. **Nothing records that a patient is covered by an employer or insurer.** So
   there is no way to answer the question that decides whether the payer domain
   is worth building at all: what fraction of visits involve someone other than
   the patient paying.

## Solution

The desk gets four payment methods: Cash, UPI, Card, and Bank transfer. A Bank
transfer requires a reference and posts to Bank like UPI and Card.

Registration gains a **Sponsor** section, collapsed by default. Most patients
are self-paying and the desk sees nothing extra. When a patient is covered, the
receptionist picks the organisation from a list an admin maintains, and records
the policy or employee number. This changes no bill: the patient is still
invoiced, and an uncovered balance still reads as outstanding. It is measurement,
not billing.

## Validation / Evidence

Owner-funded, pre-pilot. Not externally validated, and one part is explicitly a
measurement instrument rather than a bet.

- The research memo pins Bahmni `04a529`, Danphe `9963822`, and Marley `4d8bfc3`
  and establishes: modelling a payer as a payment-method value makes an unpaid
  bill read as settled (Bahmni seeds RSBY as a cash journal), and both peers
  with a payer model post the payer's share to a separate receivable at invoice
  time.
- **Baseline:** zero of the four methods beyond cash/UPI/card exist; zero
  sponsor data is captured.
- **Target outcome:** after one month of pilot use, two counts are answerable
  from our own data — the share of collections by Bank transfer, and the share
  of registered patients carrying a sponsor. Those two numbers decide whether
  the payer domain (out of scope here) gets built.
- **Unproved volume:** OPD cheque demand is unmeasured. Cheque acceptance and
  its clearing lifecycle remain out of scope until pilot evidence.

## User Stories / Scenarios

1. As a **cashier**, I want to record a bank transfer against an
   invoice, so that the Receipt names how the money actually arrived.
2. As an **accountant**, I want bank transfers to post to Bank with UPI and
   Card, so that the bank balance I reconcile matches the bank.
3. As a **cashier**, I want a bank-transfer reference required, so that each
   Payment is traceable.
4. As an **accountant**, I want bank transfers in the daily method mix, so that
   I can reconcile collections by method.
5. As an **administrator**, I want the Payment method set fixed, so unsupported
   methods cannot enter the ledger.
6. As a **receptionist**, I want to record that a patient is covered by an
   employer or insurer, including their policy or employee number, without it
   slowing down the ordinary self-paying registration.
7. As an **administrator**, I want the list of sponsor organisations to be a
   maintained master, so that the same insurer is not spelled three ways.

## Implementation Decisions

### Payment methods

- `paymentMethod` in `packages/api/src/lib/schemas.ts` becomes
  `["cash", "upi", "card", "bank"]`. It stays a **fixed enum**, not a
  deployer-editable master. The research is decisive: Danphe's editable master
  ships with no create endpoint and a ledger mapping the posting code ignores;
  ERPNext ships four of five modes unmapped, so a fresh install throws at the
  counter. A closed enum with an exhaustive `settlementAccountFor` is the
  safety both lack.
- The `payments_method_check` and `refunds_method_check` constraints in
  `packages/db/src/schema/payments.ts` and `refunds.ts` list the same four
  values.
- `needsReference` in `apps/web/src/lib/settlement.ts` is unchanged — "anything
  but cash" already covers bank transfers.
- `PAYMENT_METHODS` gains `bank` → "Bank transfer". `methodLabel`'s
  capitalisation rule still holds for all four methods.
- The split-line cap stays at four (`billing.recordPayments`, `opd.settle`).
  Both references that support split tender are unbounded, and Danphe validates
  the sum nowhere; our bound and our server-side total check stay.

### Ledger

- `SYSTEM_ACCOUNTS` gains no new account. `settlementAccountFor` maps `cash` →
  `cash`; `upi`, `card`, and `bank` → `bank`. It keeps throwing on an unknown
  method — no fallback account.

### Dashboard collections

`packages/api/src/routers/dashboard.ts` currently hardcodes three `filter`
columns for cash, UPI, and card, and the card renders only two of them. With
four methods the "Collected today" total includes bank transfer while the
breakdown would omit it. Replace the three columns with a single `group by
method` and render the breakdown from what actually came in.

### Sponsor capture

- **New table `payers`** — `id`, `orgId`, `name`, `type`
  (`insurer | tpa | corporate | scheme`), `active`, `createdAt`. Unique on
  `(orgId, name)`. This is a master, not free text: without it, "Star Health",
  "star health ltd", and "STAR" all land in the same column and the month of data
  cannot be counted, which defeats the only reason this slice exists.
- **New table `patient_payers`** — `id`, `orgId`, `patientId`, `payerId`,
  `policyNumber`, `employeeNumber`, `createdAt`. Composite tenant foreign keys
  `(orgId, patientId)` and `(orgId, payerId)`; unique on `(orgId, patientId)`.
- **One sponsor per patient.** The unique index makes the write an upsert:
  `patient.register` / `patient.update` accept an optional
  `sponsor: { payerId, policyNumber?, employeeNumber? } | null` and upsert or
  delete that one row inside the same transaction as the patient write. No
  separate mutation, no new optimistic-concurrency token. Several concurrent
  plans, validity windows, and claim numbers all wait for the payer domain.
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

- The Sponsor section in `apps/web/src/components/patient-form.tsx` defaults to
  self-paying; the payer picker, policy number, and employee number are revealed
  only when a sponsor is chosen. The patient Record tab exposes the same fields
  after registration so a receptionist can correct or remove the sponsor.
- The payer master is administered from a Settings page, following the existing
  catalog settings pattern.

## Test Seams

Prior art: `tests/integration/accounting.test.ts` already asserts ledger lines by
system key and code and checks entries balance (`journalFor`, `lineBySystemKey`,
`lineByCode`, `expectBalanced`); `tests/integration/billing.test.ts` covers
split payments and refunds through the oRPC client; `tests/unit/settlement.test.ts`
covers the pure settlement rules; `tests/integration/tenancy.test.ts` is the
four-question tenancy harness.

- **`billing.recordPayments` (existing oRPC seam)** — a bank transfer Payment
  posts to `bank` (1100), and its reference is required.
- **`patient.register` / `patient.update` (existing oRPC seams)** — a sponsor
  round-trips; passing `null` removes it; a `payerId` from another org is
  `NOT_FOUND`.
- **`payer.*` (new oRPC seam)** — the four tenancy questions, plus reception
  being `FORBIDDEN` on create.
- **`settlement.ts` (existing unit seam)** — `needsReference` and
  `nextPaymentLine` over all four methods.

## Task Plan

- [x] **Slice 1: Four payment methods**
  - Acceptance: a cashier can record a bank transfer with a reference; bank
    posts to 1100; the Receipt PDF prints a readable method label rather than a
    shouted enum; the dashboard's collections breakdown is derived from a
    `group by method` and names every method that was actually collected today.
  - Verify: `bun run check-types && bun run check && bun run test`, plus a new
    accounting assertion that a bank payment debits code 1100.
  - Depends on: none
  - Owns/Touches: `packages/api/src/lib/schemas.ts`,
    `packages/api/src/lib/ledger.ts`, `packages/db/src/schema/payments.ts`,
    `packages/db/src/schema/refunds.ts`, `packages/db/src/migrations/` (generated),
    `apps/web/src/lib/settlement.ts`,
    `apps/web/src/components/pdf/billing-documents.tsx`,
    `packages/api/src/routers/dashboard.ts`,
    `apps/web/src/routes/$orgSlug/dashboard.tsx`,
    `tests/integration/accounting.test.ts`, `tests/unit/settlement.test.ts`
  - Interfaces: produces `PaymentMethod = "cash" | "upi" | "card" | "bank"`;
    `settlementAccountFor(method): SystemAccountKey` returns `"bank"` for bank,
    UPI, and card; `SystemAccountKey` is unchanged.

- [x] **Slice 2: Payer master and patient link**
  - Acceptance: an admin can create, rename, and deactivate a payer; two payers
    cannot share a name within one org; reception can read the list but is
    `FORBIDDEN` on create; the four tenancy questions pass for `payer`; a
    `patient_payers` row cannot reference a payer from another org.
  - Verify: `bun run check-types && bun run check && bun run test`
  - Depends on: none — independent of Slice 1, with a disjoint write set.
  - Owns/Touches: `packages/db/src/schema/payers.ts` (new),
    `packages/db/src/schema/patient-payers.ts` (new),
    `packages/db/src/schema/index.ts`, `packages/db/src/migrations/` (generated),
    `packages/auth/src/access.ts`,
    `packages/api/src/routers/payer.ts` (new),
    `packages/api/src/routers/index.ts`, a Settings route under
    `apps/web/src/routes/$orgSlug/`, `tests/integration/tenancy.test.ts`
  - Interfaces: produces the `payers` and `patient_payers` tables; the `payer:
["create", "read", "update"]` permission statement; `payer.list`,
    `payer.create`, `payer.update`.

- [x] **Slice 3: Sponsor capture**
  - Acceptance: registration defaults to self-paying; choosing a sponsor reveals
    the payer picker, policy number, and employee number; the patient Record tab
    permits those fields to be corrected or cleared after registration; the
    sponsor round-trips through register and update; clearing it removes the link
    row in the same transaction as the patient write; a foreign `payerId` is
    `NOT_FOUND`; help text states that the bill is still addressed to the
    patient; a self-paying registration requires no extra keystrokes.
  - Verify: `bun run check-types && bun run check && bun run test`
  - Depends on: Slice 2
  - Owns/Touches: `packages/api/src/routers/patient.ts`,
    `apps/web/src/lib/form-schema.ts`,
    `apps/web/src/components/patient-form.tsx`,
    `apps/web/src/components/patient-record/` (sponsor readout),
    `tests/integration/patient.test.ts`
  - Interfaces: consumes `payer.list`; extends `patient.register` and
    `patient.update` input with `sponsor: { payerId, policyNumber?,
employeeNumber? } | null`.

- [x] **Slice 4: Record the decisions**
  - Acceptance: a decision entry states that insurance, TPA, and corporate
    credit are never payment-method values, cites the research memo, and names
    the payer-domain shape that evidence settled; the research ledger's memo
    line notes that it produced D029; Product and Architecture describe the four
    methods and Sponsor capture as measurement only.
  - Verify: `bun run check`
  - Depends on: Slice 3
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
- **Cheque acceptance:** out of scope because OPD cheque volume is unproven.
- **Cheque clearing lifecycle:** out of scope because a permanent
  bounced-exclusion tax applies to every aggregate.
- **Other method:** out of scope because 1150 has no clearing path without a
  manual journal UI.

## Explicitly Deferred

Accepted omissions. A later review must not treat these as blockers.

- **No report counts sponsor coverage or method mix.** The data lands in tables
  that plain SQL can answer, and the falsification step in the research memo is a
  one-off question, not a screen.
- **A patient carries at most one sponsor.** Concurrent plans and validity
  windows are payer-domain work.
- **No bulk import of payers.** An admin types them, and there will be few.
- **Deactivating a payer does not touch existing links.** History stays as it
  was recorded.

## Open Questions

None. Bank transfer is the fourth Payment method; the payer-domain go/no-go
remains tied to one month of pilot method-mix and Sponsor counts.
