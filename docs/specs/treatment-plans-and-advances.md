# Spec: Treatment plans, sittings, and advance receipts

Status: ready
Authority: user request, 2026-09-14 — replace the "invoice the whole RCT on
day one, record payments against it later" workaround with a model that tracks
sittings, tells the desk whom to call next, and keeps money honest for the
accountant.
Evidence: [treatment plans and advances](../research/treatment-plans-and-advances.md).
Supersedes: none

## Problem

A root canal takes three or four sittings on no fixed dates. A physiotherapy
course takes ten sessions. The patient pays in whatever amounts they bring and
may add work mid-way (a crown). Today the desk types the whole procedure on the
first OPD Appointment, issues that Invoice unpaid, and on each later visit
opens that first Invoice and records a Payment.

Four things go wrong:

1. Revenue and a receivable post on day one for work not yet done. If the
   patient stops after two sittings the only correction is a Credit Note.
2. Money paid on sitting three sits on sitting one's Invoice, so the OPD
   register and the money disagree.
3. A crown added later becomes a separate Invoice on whichever visit it was
   typed, with no link to the course.
4. Nothing records "sitting 2 of about 4" or "call back after 10 days", so
   nobody can list who is due next, and the patient record does not say that
   this person is mid-treatment.

## Solution

Two small records over the existing OPD and finance spine.

**Treatment plan.** A course of quoted work for one Patient and one
Practitioner, named by its own items ("Root canal treatment + Crown",
"Physiotherapy session ×10") and held at the doctor's quoted price. Each
sitting is an ordinary OPD Appointment (walk-in or booked) linked to
the plan, so the token, practitioner time, and follow-up fee work as today. When
work is delivered the desk posts the item to that visit; that creates the Charge
on that appointment, and the existing Billing tab prices and settles it. The plan
carries the next sitting date the doctor asked for. A **Follow-ups** list shows
open plans that are due and not yet booked. The patient header shows **Under
treatment** while a plan is open.

**Advance receipt.** Money taken before the work is done is recorded against
the Patient, not against an Invoice. It prints as an Advance Receipt, posts to a
Patient Advances liability, and shows on the patient as credit. At settlement or
Record payment the cashier applies credit against the Invoice. Unused credit is
refunded through the existing Refund document.

Nothing changes for a single-visit OPD: immutable documents, four payment
methods, Charge snapshots, and per-category revenue. D025 is untouched, and it
was never a cap: work posted to a sitting that was already settled raises a
second Invoice on the same appointment, which the Billing tab lists.

## Validation / Evidence

Owner-funded, in pilot production. The workaround is in daily use, so demand
is observed, not assumed.

- The research memo establishes that the references with a real design (Open
  Dental, Cliniko, ADA/AAE dental coding) post a multi-sitting fee on delivery
  and hold earlier money as a liability. Ind AS 115 requires revenue when the
  promised service is delivered and presents earlier money as a contract
  liability; it does not fix the earning milestone for a one-fee RCT, which is
  the CA's call. The model supports either answer: post the RCT item at
  completion, or add and post a partial-work item. Frappe Health's plan
  billing is the weakest donor; only its derived session count (no stored
  counter) is copied.
- **Pilot acceptance cases** (the memo's falsification set): an RCT abandoned
  after two sittings; a ten-session physiotherapy course paid in three
  irregular advance receipts settled across several sitting Invoices; an RCT
  with a crown accepted mid-course. The model fails if staff must issue a
  future-service Invoice to accept money, cannot reconcile cash to the
  receipt's business date, or cannot show which sitting earned each Charge.
- **Baseline:** zero advance records exist; every multi-sitting course is one
  day-one Invoice with later Payments; no list of due follow-ups exists.
- **Target outcome:** after one month, every open course in the pilot is a
  Treatment plan, no Invoice is issued before its item is posted, and the
  Follow-ups list is the desk's morning call sheet. The ledger shows Patient
  Advances separately from revenue.
- **Unproved:** whether staff will maintain the next sitting date. If they do
  not, the Follow-ups list degrades to "open plans by last sitting", which is
  still useful and is the fallback ordering.

## User Stories / Scenarios

1. As **reception**, I want to start a treatment plan for a patient with the
   items the doctor quoted, so that later visits are sittings of one course.
2. As **reception**, I want to book or walk in a patient as a sitting of an
   open plan, so that the OPD record and the plan know about each other.
3. As a **cashier**, I want to take an advance from a patient and hand over a
   printed Advance Receipt, so that the money is recorded without inventing an
   Invoice.
4. As a **cashier**, I want to post a delivered item to today's visit and settle
   it using the patient's credit, so that revenue posts when the work is done
   and the Invoice sits on the visit that did it.
5. As **reception**, I want to add a crown to an open plan, so that the course
   stays one record.
6. As **reception**, I want to record the next sitting date and a note ("after
   crown arrives"), so that the Follow-ups list tells me whom to call.
7. As **reception**, I want the patient record to say **Under treatment** with
   the plan, sittings done, next date, and credit held, so that I get the gist
   without opening every visit.
8. As **reception**, I want to close an abandoned plan with a reason, and as a
   **cashier** to refund the unused advance, so that the liability is cleared
   with a Refund voucher. Closing is `treatment:update`; the refund is
   `billing:advanceRefund`, and no role needs both.
9. As an **accountant**, I want Patient Advances on the trial balance and
   balance sheet, advances in Daily Collections, and a list of advances held,
   so that advance received and revenue recognised are separate.

Before/after for the abandoned root canal: today it is an issued ₹7,000
Invoice, ₹3,000 paid, needing a ₹4,000 Credit Note. After: a ₹3,000 Advance
Receipt, a closed plan with reason, and a Refund of the remainder. If the
doctor wants to bill the work done, reception adds the partial-work catalog
item (dental coding reports an incomplete root canal as pulpal debridement,
not as a fraction of endodontic therapy), the desk posts it to the last
sitting and settles it from credit, and the RCT item is dropped. The RCT
item itself is never posted at a partial quantity.

## Implementation Decisions

Record these in `docs/decisions.md` as D033–D035 in the slice that lands them.

**D033 — A treatment plan item is a quote and may price below catalog.**
The item defaults to the catalog price; any change needs a note; the posted
Charge snapshots the plan price. This is the one exception to the intake rule
that a rate never drops below catalog. Reporting keeps both numbers because
the Charge snapshot carries the plan price and the catalog item is unchanged.

**D034 — Course fees post on delivery.** A plan item creates no Charge until
the desk posts it to a checked-in OPD Appointment. Money received earlier is
an Advance Receipt, a liability until allocated.

**D035 — Advance money is a separate document, not a Payment.** `payments`
stays Invoice-only. Advance Receipts have their own numbering series and print
as an **Advance Receipt**; allocation to an Invoice is its own row and journal.
The document does not claim to be a GST Receipt Voucher (CGST Rule 50) until
the pilot's CA approves the printed particulars; see Open Questions.

**Plan label.** A plan carries no free-text title. A course is named by the
work it contains, so the label is derived on the server from the plan's item
descriptions in quoted order, joined with " + " and suffixed " ×N" when a
planned quantity is above one. `planLabel(orgId)` in
`packages/api/src/lib/treatment-label.ts` owns the expression and every read
path selects it as `label`. Which tooth or site the work is for, and any other
per-line detail, belongs on that item's `note`, not in a name the desk has to
keep in step with the items.

### Ledger

- New system account `patient_advances`, code `2200`, name **Patient
  Advances**, type `liability`, added to `SYSTEM_ACCOUNTS` in
  `packages/api/src/lib/ledger.ts`. Existing lazy seeding creates it per
  organization on first use.
- Advance receipt: Dr Cash/Bank (by `settlementAccountFor`), Cr Patient
  Advances. `sourceType = "advance_receipt"`.
- Allocation: Dr Patient Advances, Cr Patient Receivables.
  `sourceType = "advance_allocation"`.
- Advance refund: Dr Patient Advances, Cr Cash/Bank. `sourceType = "refund"`
  as today; the refund row names its source.
- Invoice issuance and Payment journals are unchanged.

### Schema (`packages/db/src/schema/`)

All new tables carry `orgId NOT NULL`, the `(orgId, id)` unique, composite
tenant foreign keys, and tenant-leading indexes. Migrations are CLI-generated
and additive; production data is retained, so nothing rewrites existing rows.

`advance_receipts` (new file `advance-receipts.ts`):
`id`, `orgId`, `patientId`, `treatmentPlanId` nullable (added in Slice 2),
`method` (payment method check), `amount > 0`, `reference` nullable, `note`
nullable, `purpose` text NOT NULL (the plan's derived label when tagged, else
"Future services"), `receiptNumber` unique per org, `fiscalYear`,
`businessDate`, `receivedBy`, `createdAt`, plus the same print snapshots
`invoices` carries: `orgLegalName`, `orgAddress`, `orgTaxId`, `currency`,
`patientName`, `patientMrn`, `patientPhone`, `patientAddress` nullable,
`patientGuardian` nullable. The receipt is a printed document, so a later
profile edit must not change it; production data is retained, so the
snapshots land in Slice 1 rather than being backfilled. Place of supply, tax
rate, and tax amount are not stored: the supply is exempt and the CA decides
whether they print (Open Questions). Indexes: `(orgId, patientId, createdAt)`,
`(orgId, createdAt, id)` for the advances-held keyset, `(orgId, businessDate)`,
and `(orgId, treatmentPlanId)` partial on `treatment_plan_id IS NOT NULL` for
the Follow-ups credit subquery.

`advance_allocations` (new file `advance-allocations.ts`):
`id`, `orgId`, `advanceReceiptId`, `invoiceId`, `amount > 0`, `allocatedBy`,
`createdAt`. Indexes: `(orgId, invoiceId)`, `(orgId, advanceReceiptId)`.
The rule "allocations plus advance refunds never exceed the receipt" is
enforced in the transaction under `FOR UPDATE` on the receipt row, not by a
check constraint.

`organization_settings`: `advanceReceiptPrefix` text NOT NULL default `ADV`.

`treatment_plans` (new file `treatment-plans.ts`):
`id`, `orgId`, `patientId`, `practitionerId`, `status`
in `open | completed | closed`, `nextSittingOn` date nullable,
`nextSittingNote` nullable, `closeReason` nullable (check: NOT NULL when
`closed`), `completedAt`, `closedAt`, `createdBy`, `createdAt`, `updatedAt`.
Indexes: `(orgId, patientId, status)`, `(orgId, status, nextSittingOn)`.

`treatment_plan_items` (new file `treatment-plan-items.ts`):
`id`, `orgId`, `treatmentPlanId`, `catalogItemId`, `description`,
`unitPrice >= 0`, `taxRatePercent`, `taxCode`, `revenueCategory` (snapshotted
like `charges`), `qtyPlanned > 0`, `note` nullable (tooth, site, or why the
price differs from catalog), `status` in
`open | dropped`, `dropReason` nullable (NOT NULL when `dropped`),
`createdBy`, `createdAt`, `updatedAt`. Index `(orgId, treatmentPlanId)`.
"Done" is derived: posted quantity, the sum of `qty` over non-voided Charges
with `sourceType = 'treatment_plan'` and `sourceId = item.id`, is at least
`qtyPlanned`.

`charges`: `sourceType` check gains `'treatment_plan'`; `sourceId` then names
the plan item. Index `(orgId, sourceId)` partial on `source_id IS NOT NULL`
supports batched plan detail loading; `sourceType` filters after it, and the
partial index skips every charge that has no source.

`opd_appointments`: `treatmentPlanId` nullable, composite FK to
`treatment_plans`, index `(orgId, treatmentPlanId, businessDate)` partial on
`treatment_plan_id IS NOT NULL`.

`refunds` (Slice 4): `invoiceId` and `creditNoteId` become nullable,
`advanceReceiptId` nullable is added, with a check that exactly one of
`creditNoteId` or `advanceReceiptId` is set and `invoiceId` is set iff
`creditNoteId` is.

### Permissions (`packages/auth/src/access.ts`)

New statement `treatment: ["create", "read", "update"]`. Grants: reception,
admin, owner get all three; cashier and accountant get `read`. Taking an
advance, applying credit, and posting an item to a visit are `billing: write`.
Advance refunds use `billing:advanceRefund`, granted to cashier, accountant,
admin, and owner. Credit-note refunds remain under `billing:creditNote`;
reception gets neither refund grant.

### API (`packages/api/src/routers/`)

New `treatment.ts`, registered in `routers/index.ts`:

- `create({ patientId, practitionerId, appointmentId?, item, nextSittingOn?, nextSittingNote? })`
  — `treatment:create`. A plan starts with one accepted item and grows through
  `addItem`, so both take the same shape: `catalogItemId`, `qtyPlanned`, optional
  `unitPrice` (paise) and `note`; the server re-reads the catalog item,
  requires it active and of category `procedure`, snapshots
  description/tax/category, and rejects a `unitPrice` that differs from
  catalog without a `note` (`BAD_REQUEST` "Add a note for <name>'s price.").
  When `appointmentId` is given, that visit becomes the plan's first sitting
  in the same transaction; a visit that is not `booked` or `checked_in`,
  belongs to another patient, or is already linked to a plan refuses
  `CONFLICT` "That visit cannot be a sitting of this plan."
- `addItem({ planId, item })` — same rules; plan must be `open`.
- `dropItem({ itemId, reason })` — one conditional UPDATE guarded by item
  `open` and plan `open`; `CONFLICT` when it matches no row.
- `setNextSitting({ planId, nextSittingOn | null, note | null })`.
- `linkVisit({ planId, appointmentId })` — `treatment:update`. The same visit
  rule as `create`, and it also refuses `CONFLICT` when the plan is not
  `open`.
- `postToVisit({ itemId, appointmentId, qty = 1 })` — `billing:write`.
  Locks the appointment row (`FOR UPDATE`), requires `status = checked_in`,
  same patient as the plan, plan `open`, item `open`; links the appointment to
  the plan if `treatmentPlanId` is null and refuses `CONFLICT` if it names a
  different plan; refuses `CONFLICT` when posted + `qty` exceeds `qtyPlanned`;
  refuses `CONFLICT` when the visit already carries a non-voided Charge for the
  same catalog item, which is the one place plan work is kept from being billed
  twice (D038);
  inserts one Charge from the item snapshot with `sourceType = 'treatment_plan'`
  and `sourceId = itemId`; advances `chargeRevision`. Audits `treatment.post`.
- `complete({ planId })` — refuses `CONFLICT` unless every item is dropped or
  done.
- `close({ planId, reason })` — any open plan; audits `treatment.close`.
- `listForPatient({ patientId })` — the only plan read: every plan of that
  patient as `{ ...plan, label, practitionerName, items[{ ...item, postedQty,
done }], sittings[{ id }], quotedTotal }`, open plans first, then by `createdAt`
  desc. Posted quantity is the non-voided posted `qty` per item and `done` is
  `postedQty >= qtyPlanned`; `quotedTotal` sums non-dropped items. Child rows
  load in two batched queries rather than once per plan. There is no money
  summary: no unposted quote, no outstanding, no pending, no credit held, and no
  per-sitting list of posted items; money lives on the sitting's Billing tab and
  in `billing.patientCredit`. The OPD record layout fetches it once, so the
  Clinical panel takes the linked plan with `find` and the pickers take the open
  plans with `filter` — there is no per-plan and no open-plans-only procedure.
- `followUps({ query, cursor, limit })` —
  `treatment:read`. Open plans with no future `booked` appointment on the plan,
  kept when `nextSittingOn <= today` or `nextSittingOn IS NULL`. Order:
  `nextSittingOn ASC NULLS LAST, lastSittingOn ASC, id`. Rows: patient name,
  MRN, phone, plan `label`, practitioner, sittings done, last sitting date,
  next sitting date and note, credit held. Keyset paged.

`opd.ts`: `book` and `createWalkIn` accept optional `treatmentPlanId`; the
server requires an `open` plan of the same patient in the same organization
and stores it, in one existence read with no lock and no service check (D038).
`opd.get` does not return the plan; the record layout loads
`treatment.listForPatient` for the visit's patient, and both tabs read it.
`checkIn` is unchanged. Cancelling or no-showing a sitting leaves the plan
untouched.

`billing.ts`:

- `recordAdvance({ patientId, treatmentPlanId?, method, amount, reference?, note? })`
  — `billing:write`; non-cash requires a reference (`requirePaymentReference`);
  numbering `advance:${fiscalYear}` with `advanceReceiptPrefix`; snapshots the
  org and patient print fields the way invoice issuance does; posts the
  journal; audits `advance.record`.
- `settleCharges` and `recordPayments` gain `applyCredit: money.default(0n)`.
  Inside the existing transaction, after the Invoice exists: lock the patient's
  advance receipts with remaining balance `FOR UPDATE` ordered by `createdAt`,
  refuse `CONFLICT` when `applyCredit` exceeds credit held or the outstanding
  balance, insert allocations from receipts tagged to the Invoice's plan first
  (untagged receipts first when the visit has no plan), each group oldest-first,
  and post one journal per allocation.
  Payment lines are validated against `outstanding - applyCredit`. The
  "add a reason for the outstanding balance" rule counts credit as collected.
- `recordAdvanceRefund({ advanceReceiptId, method, amount, reference?, note? })`
  caps the refund at the receipt's unallocated remainder.
- `patientCredit({ patientId })` — the patient's unused credit as one `total`.
  `billing:read`. The overlay that spends credit reads it when it opens and
  holds the figure for that submission; nothing mounts it to gate a button.
- `getAdvanceReceipt({ advanceId })` and the PDF route reuse the receipt
  renderer with the title **Advance Receipt** and the line "Received towards
  future services. This is not an invoice."

`patient.account` adds `creditHeld`, the advance receipts, and
`advanceRefunds: { id, advanceReceiptId, amount, businessDate }[]` so a voucher
stays reprintable after its dialog closed. `patient.get` adds
`openTreatmentPlans: { id, label }[]`.

`report.dailyCollections` adds advance receipts and advance refunds by
business date and method; the printed total is payments + advances − refunds
(both kinds). `billing-worklist.ts` adds `advancesHeld({ query, cursor, limit })` — one row
per receipt with unused credit, oldest first, carrying the receipt's stored
`purpose` and its plan's status, so the list and the printed document cannot
disagree.

### Web (`apps/web/src/`)

Follow `docs/design.md`; `packages/ui` primitives; popups behind `ClientOnly`.

- OPD intake (`components/opd-intake-form.tsx`): when the chosen patient has
  open plans, a **Sitting for** select appears above Services, default none.
  The Services search is unfiltered: the desk may bill a service directly or
  post it from the plan, and whichever happens first wins, because
  `postToVisit` refuses an item the visit already carries (D038).
- OPD record Clinical tab (`routes/$orgSlug/opd/$appointmentId/index.tsx`,
  `components/opd-treatment-panel.tsx`): a **Treatment** panel — the one place
  a plan is started and worked. Unlinked: **New plan** (practitioner preset
  from the visit, the visit auto-linked as the first sitting) or **Link to
  plan** (open plans). Linked: plan label, sitting number, items with
  posted/planned and **Post to this visit** (billing write, checked-in only),
  plus **Add item**, **Next sitting**, **Complete** and per-item **Drop**.
  The New plan, Add item and Next sitting forms are overlays the panel opens
  from local state; the forms themselves live in
  `components/treatment-dialogs.tsx`.
- OPD Billing tab (`components/opd-billing/charge-checkout.tsx`,
  `components/opd-settlement-overlay.tsx`, `components/record-payment-form.tsx`):
  **Credit available ₹X** with an amount field pre-filled to
  min(credit, payable) and the cash line seeded with the remainder — credit is
  applied unless the cashier lowers it. A
  **Take advance** action opens an advance form (method, amount, reference,
  note, plan). The plan defaults to the patient's only open plan, or to the
  plan the current sitting is linked to; an untagged advance is patient-level
  credit and is not tied to any plan.
- Patient record (`routes/$orgSlug/patients/$patientId.tsx`,
  `components/patient-record/treatment.tsx`): header chip **Under treatment**
  when any plan is `open`; a **Treatment** tab that is history, not a
  workspace — label, practitioner, status, sittings done, next sitting,
  quoted total and items, with only **Close** on the plan and **Drop** on an
  open item. Starting a plan, adding an item and setting the next sitting
  belong to the visit record, so the tab has no such actions and no
  `treatmentAction` or `planId` search params. Billing tab shows credit held
  and advance receipts with print links. **Take advance** lives here too.
- Follow-ups (`components/opd-follow-ups.tsx`): an option of the OPD desk's
  **Status** filter — **Open / All / Follow-ups** — not its own page, and the
  status the URL names is the list the loader fetches. Follow-ups shows due and
  undated plans only, and the day stepper belongs to the queue alone. Rows
  link to the patient and offer **Book sitting**, which opens intake with patient and plan preset and is shown only
  to a member who may create an appointment. The option appears only with
  `treatment:read`, and `?status=follow-ups` without that grant falls back to the
  open queue.
- Billing: **Advances held** list at `routes/$orgSlug/billing/advances.tsx`;
  Advance Receipt print route beside the existing receipt route.
- Reports: Daily Collections gains Advances and Advance refunds columns.

Below `md` every new list renders the compact row pattern the OPD register
uses.

### Vocabulary

Staff labels: **Treatment plan**, **Sitting** (a plan-linked OPD Appointment),
**Follow-ups**, **Advance Receipt**, **Credit** (advance held), **Post to this
visit**. Add these to the language table in `docs/product.md`.

## Test Seams

Prior art: `tests/integration/billing.test.ts` (settlement, partial payments,
refunds), `tests/integration/opd.test.ts`, `tests/integration/tenancy.test.ts`
(four questions), `tests/unit/invoice-balance.test.ts`.

- **oRPC client (`clientFor`) against real Postgres** — the primary seam. New
  `tests/integration/treatment.test.ts` for plan lifecycle, posting, sittings,
  follow-ups; new cases in `billing.test.ts` for advances, credit application,
  advance refunds, and the ledger lines they post. The three pilot acceptance
  cases from Validation are the scenarios: the physio case must prove several
  receipts allocate oldest-first across several sitting Invoices.
- **`tenancy.test.ts`** — the four questions for `treatment.*` and for
  `billing.recordAdvance` / `patientCredit`.
- **`calculateInvoiceBalance`** unit seam gains `allocationsTotal`.
- **Browser** — desk flows are exercised in the running app at desktop and
  390px, light and dark, per `CLAUDE.md`.

## Task Plan

Slices run in order. Slices 1 and 2 touch different domain files but share
coordinator-owned files (`packages/db/src/schema/index.ts`,
`packages/api/src/routers/index.ts`, `packages/auth/src/access.ts`,
`docs/`) and migration numbering, so they are sequential, not parallel.

- [x] **Slice 1: Advance Receipt and credit at settlement** (riskiest: money
      and ledger)
  - Acceptance: `billing.recordAdvance` creates a numbered receipt and a
    balanced journal (Dr cash/bank, Cr Patient Advances); `patientCredit`
    reports it; `settleCharges` and `recordPayments` with `applyCredit`
    insert allocations oldest-first with journals (Dr Patient Advances, Cr
    Patient Receivables) and reduce the invoice outstanding; `applyCredit`
    above credit or above outstanding is `CONFLICT`; non-cash advance without
    reference is `BAD_REQUEST`; trial balance shows account 2200; the Advance
    Receipt PDF renders; the Billing tab and Record payment show and apply
    credit in the browser.
  - Verify: `bun run check-types`, `bunx oxlint`, `bunx oxfmt --check`,
    `bun run test` (this session owns the wipe), browser check of Take
    advance, Apply credit at settle, Apply credit at Record payment, and the
    printed Advance Receipt at desktop and 390px.
  - Depends on: none
  - Owns/Touches: `packages/db/src/schema/advance-receipts.ts`,
    `advance-allocations.ts`, `organization-settings.ts`, generated
    migration; `packages/api/src/lib/ledger.ts`, `invoice-balance.ts`,
    `invoice-math.ts`, `routers/billing.ts`, `routers/patient.ts`;
    `apps/web/src/components/opd-billing/charge-checkout.tsx`,
    `record-payment-form.tsx`, new advance form component, receipt print
    route; `tests/integration/billing.test.ts`, `tests/unit/invoice-balance.test.ts`,
    `tests/integration/tenancy.test.ts`; `docs/product.md`,
    `docs/architecture.md` (ledger), `docs/decisions.md` (D035).
    Coordinator-owned: `schema/index.ts`.
  - Interfaces: produces `billing.recordAdvance`, `billing.patientCredit`,
    `billing.getAdvanceReceipt`, `applyCredit` on `settleCharges` and
    `recordPayments`, `advance_receipts.treatmentPlanId` left for Slice 2,
    `SystemAccountKey` gains `patient_advances`, `InvoiceBalance` gains
    `allocationsTotal`.

- [x] **Slice 2: Treatment plan, sittings, and posting**
  - Acceptance: `treatment.create` snapshots items and refuses an off-catalog
    price without a note; `opd.book` and `opd.createWalkIn` link a sitting
    and refuse a plan of another patient or a closed plan; `postToVisit`
    creates one Charge with `sourceType = 'treatment_plan'` on a checked-in
    sitting, advances `chargeRevision`, refuses over-posting and a
    not-checked-in visit; a posted Charge settles through the existing
    Billing tab with credit; `complete` refuses while an item is neither
    done nor dropped; `close` needs a reason; `get` returns the derived label,
    the items with posted quantity and done flag, the sittings and the quoted
    total; `advance_receipts.treatmentPlanId` is stored and returned.
  - Verify: the same gates; browser check of New plan from the OPD visit record,
    walk-in as a sitting, Post to this visit, settle with credit.
  - Depends on: Slice 1
  - Owns/Touches: `packages/db/src/schema/treatment-plans.ts`,
    `treatment-plan-items.ts`, `charges.ts` (check), `opd-appointments.ts`
    (column), `advance-receipts.ts` (column), generated migration;
    `packages/auth/src/access.ts`; `packages/api/src/routers/treatment.ts`,
    `routers/opd.ts`; `apps/web/src/components/opd-intake-form.tsx`,
    `routes/$orgSlug/opd/$appointmentId/index.tsx`, new treatment panel
    component; `tests/integration/treatment.test.ts`, `opd.test.ts`,
    `tenancy.test.ts`, `tests/unit/access.test.ts`; `docs/opd.md`,
    `docs/decisions.md` (D033, D034). Coordinator-owned: `schema/index.ts`,
    `routers/index.ts`.
  - Interfaces: produces `treatment.create | addItem | dropItem |
setNextSitting | linkVisit | postToVisit | complete | close | listForPatient`,
    `opd_appointments.treatmentPlanId`, `treatmentPlanId` on `opd.book`,
    `opd.createWalkIn`, and `billing.recordAdvance`; consumes
    `billing.patientCredit` on the Billing tab.

- [x] **Slice 3: Under treatment on the patient record, and Follow-ups**
  - Acceptance: `patient.get` returns open plans and the header shows
    **Under treatment**; the Treatment tab lists plans with sittings, next
    sitting and quoted total as history, with Close and Drop;
    `treatment.followUps` lists open plans with no booked sitting, `due`
    filters by `nextSittingOn <= today` or unset, order is next date then
    last sitting, search matches name/MRN/phone, keyset paging works; a
    plan with a future `booked` sitting is absent; **Book sitting** opens
    intake with patient and plan preset; navigation shows **Follow-ups**.
  - Verify: the same gates plus browser checks of the patient header and
    Treatment tab, and the Follow-ups list at desktop and 390px in both
    themes, including the empty state.
  - Depends on: Slice 2
  - Owns/Touches: `packages/api/src/routers/treatment.ts` (`followUps`),
    `routers/patient.ts` (`get`); `apps/web/src/routes/$orgSlug/patients/$patientId.tsx`,
    `components/patient-record/`, new `components/opd-follow-ups.tsx`,
    `routes/$orgSlug/opd/index.tsx` (Status filter), `opd-intake-form.tsx` (preset);
    `tests/integration/treatment.test.ts`; `docs/opd.md`, `docs/product.md`.
  - Interfaces: produces `treatment.followUps`, `patient.get.openTreatmentPlans`;
    consumes `treatment.listForPatient`, `billing.patientCredit`.

- [x] **Slice 4: Advance refund, advances held, and Daily Collections**
  - Acceptance: `billing.recordAdvanceRefund` refunds up to
    the unallocated remainder, posts Dr Patient Advances / Cr cash/bank,
    prints a Refund voucher citing the Advance Receipt number, and refuses
    above the remainder; `advancesHeld` lists patients with credit oldest
    first with plan status; Daily Collections shows advances and advance
    refunds by method and its total nets them; the balance sheet shows the
    liability.
  - Verify: the same gates; browser check of refund from the patient Billing
    tab, the Advances held list, and Daily Collections.
  - Depends on: Slice 2 (plan status on the list); refund and report parts
    depend only on Slice 1.
  - Owns/Touches: `packages/db/src/schema/refunds.ts`, generated migration;
    `packages/api/src/routers/billing.ts` (`recordAdvanceRefund`),
    `billing-worklist.ts`, `report.ts`; refund PDF template; new
    `routes/$orgSlug/billing/advances.tsx`, `reports/daily-collections.tsx`;
    `tests/integration/billing.test.ts`, `accounting.test.ts`,
    `tests/unit/billing-pdf.test.ts`; `docs/specs/reports.md`,
    `docs/product.md`.
  - Interfaces: produces `billing.recordAdvanceRefund`,
    `billing.advancesHeld`, advance columns on `report.dailyCollections`.

## Out of Scope

- Instalment schedules or EMI; payments stay whatever the patient brings.
- A package or membership entity; a course is plan items with quantities.
- Clinical content on the plan (tooth charts, exercise lists, notes beyond
  the next-sitting note); prescriptions stay paper scans.
- Frappe-style encounters, orders, or service requests.
- Automatic reminders by SMS or WhatsApp; the Follow-ups list is a call sheet.
- Invoice granularity (D025) and any Bill of Supply / Tax Invoice labelling.

## Explicitly Deferred

- Omitting the consult fee automatically on plan-linked walk-ins; the existing
  follow-up window and **Omit fee** cover it until the pilot asks.
- A "refund due" row for closed plans with credit; the Advances held list
  shows plan status, and a dedicated worklist waits for observed need.
- Reopening a completed plan; create a new plan.
- Per-item next-sitting dates; one date per plan.
- Reporting of quoted-versus-catalog price differences; the data is
  snapshotted on the Charge and the plan item, a report waits for a request.
- An expiry date on advances or plans.
- Chair, bay, or room booking; a sitting occupies the practitioner's time as
  an OPD Appointment does today, which proves attendance and workload but not
  physical-resource utilisation. If double-booking or utilisation becomes an
  observed need, add an optional outpatient resource reservation to the
  appointment; never put the resource on the Treatment plan and never reuse
  an inpatient bed record.
- Renaming **Sitting** to **Session** per department; one label for now.

## Open Questions

Neither blocks implementation; both are the pilot CA's decisions and change
only printed text or catalog classification.

1. **Voucher particulars.** Which CGST Rule 50 / 51 particulars (place of
   supply, rate and amount of tax, reverse-charge flag) must print on the
   Advance Receipt and the advance Refund voucher for an exempt clinical
   establishment. Until answered, both documents print the snapshots above
   and no tax lines.
2. **Classification.** Whether a crown (or other lab-supplied item) is part of
   the exempt health-care service or separately supplied goods, and the
   earning milestone for a one-fee RCT. Both are catalog item and process
   settings, not schema.

The quoted-price rule was decided 2026-09-14: below catalog is allowed with a
note (D033).
