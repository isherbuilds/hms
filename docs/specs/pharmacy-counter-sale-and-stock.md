# Spec: Pharmacy counter sale and stock

Status: ready (Stage 0 answers assumed; see below)
Authority: owner request, 2026-09-18 — the pilot hospital signs only with IPD,
Emergency, Pharmacy, and Lab; Pharmacy is the next module. The owner accepted
the split of Pharmacy into a sale half (this spec) and a purchasing half
(a later spec). Revised 2026-09-18 after an external review, then simplified
the same day on the owner's instruction to keep the design simple and
standard; the simplifications are listed under "Simplifications adopted".
Revised 2026-09-23 for exact printed prices and document-only rounding (D044).
Evidence: [Pharmacy reference flows](../research/pharmacy-reference-flows.md)
and the [research ledger](../research/README.md#adopted-findings) (D027).
Supersedes: none. Closes D025 (invoice granularity) in Slice 1.

## Problem

The hospital pharmacy sells medicines across a counter to anyone who walks in,
with or without a prescription from the OPD. Today that runs in the incumbent
software. HMS has no medicine master, no stock, and no way to sell anything
that is not attached to an OPD Appointment. The pharmacy cannot move to HMS,
so the hospital cannot switch the incumbent off.

Money and stock are the failure points the incumbent already shows: a sale that
does not reduce stock, a batch sold after expiry, a return that gives money
back without the medicine coming back, a stock figure that someone typed over,
and a counter that cannot tell whether a payment was saved when the network
dropped.

## Solution

A **Pharmacy** section whose landing page is the sales list at
`/$orgSlug/pharmacy`, with the counter desk at `/$orgSlug/pharmacy/new`. A
pharmacist searches a medicine,
HMS proposes the batch that expires first, the pharmacist confirms quantity and
collects money. That one action issues an immutable pharmacy Invoice, records
the Payment and Receipt, and writes the stock movement, all in one transaction.
A customer needs no Patient record; a Patient or an OPD Appointment can be
linked when known.

Stock on hand is never typed. It is the sum of stock movements per batch and
bucket: opening stock from a signed count, goods received from a supplier,
sales, returns into quarantine, releases to the shelf, and reason-coded
adjustments. Every movement that touches this stock has a path in HMS before
the incumbent goes read-only.

## Validation / Evidence

Owner-funded, contracted: the pilot hospital has asked for this in writing as a
condition of signing, and the owner runs the hospital. The roadmap gate in
[Product](../product.md#roadmap-gates) is met as follows:

| Gate condition               | Status                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------- |
| Paid scope                   | Signing condition, owner-confirmed 2026-09-18                                 |
| Pharmacy owner               | **To be named** at the Stage 0 walkthrough                                    |
| Verified opening stock       | Slice 2 posts an opening goods receipt with the count time and retained sheet |
| Signed sale/return workflows | Stage 0 walkthrough signs the sale, return, receipt and adjustment flows      |

- **Baseline:** zero pharmacy sales in HMS; the incumbent holds stock and sales.
- **Target outcome:** the pharmacy runs one full month on HMS with the incumbent
  read-only. At month end: sales by day, stock on hand per batch matched to a
  physical count within an agreed tolerance, returns as a share of sales, and
  zero stock movements recorded outside HMS.
- **Unproved:** counter throughput. Time the incumbent before cutover and HMS
  after the first week on the same counter for a set of cases: a three-item
  sale, a sale split across two batches, an unavailable item, a Patient lookup,
  a return, a failed print, and a recovered timeout.
- Reference comparison: Danphe and ERPNext, the two references with their own
  stock code, share batch-level stock with expiry, a movement ledger behind
  every quantity, sale lines fixed to a batch, and returns that carry quantity
  against the original sale line. Bahmni delegates all of it to Odoo, which
  behaves the same way.

## Stage 0: pilot workflow sign-off

The owner instructed implementation to start before the walkthrough. The
answers below are **assumed defaults**; the pharmacy owner confirms or corrects
them at the counter, and a correction that changes behaviour is a change to
this spec. Nothing in the code depends on an answer beyond what is written.

1. **Sale unit.** Assumed: each medicine has one stock unit (the unit the
   counter sells) and a pack size; there are no fractional units. If loose
   tablets are sold, the tablet is the stock unit and a strip is a conversion.
2. **Shared stock.** Assumed: the counter stock also supplies wards and free
   hospital use occasionally. Those issues are recorded through
   `pharmacy.adjustStock` with reason `internal_issue`; the IPD spec later
   replaces that with a typed issue.
3. **Returns.** Assumed: returns are accepted at the counter against the
   invoice; goods go to quarantine and a supervisor releases or writes them
   off.
4. **Receiving.** Assumed: the pharmacist receives deliveries with the
   supplier's invoice; HMS records supplier name, bill number, bill total, and
   each line as the bill prints it: batch, billed and free quantity, rate,
   discount, GST and MRP (revised 2026-09-23 on the owner's instruction, after
   comparing ERPNext, OpenMRS and Indian pharmacy software).
5. **Prescriptions.** Assumed: Schedule H1 is stocked and sold with prescriber
   and patient name recorded; Schedule X is not stocked and is refused.
6. **Legal entity and paper.** Assumed: the pharmacy invoices under the
   hospital's GST registration with its own printed series, and hospital
   Advance Receipts may be spent at the counter when the sale names the
   Patient.

## User Stories / Scenarios

1. As a **pharmacist**, I want to search a medicine by name and see stock by
   batch with expiry and MRP, so that I sell what is on the shelf.
2. As a **pharmacist**, I want HMS to propose the earliest-expiring sellable
   batch and let me pick another, so that old stock leaves first without
   forcing me.
3. As a **pharmacist**, I want a walk-in sale with no Patient record, taking
   Cash, UPI, Card, or Bank transfer, so that a customer is not registered just
   to buy paracetamol.
4. As a **pharmacist**, I want to record who the medicine is for, the
   prescriber, and a prescription reference when there is one, separately from
   who is paying, so that a parent buying for a child is recorded truthfully.
5. As a **pharmacist**, I want an expired or inactive line refused and a
   quantity above stock refused at save, so that the shelf and the screen never
   disagree.
6. As a **pharmacist**, I want to know, after a network drop, whether the sale
   was saved and which invoice it is, so that I hand over medicine once and
   print once. **Deferred for the MVP (D039):** the request key was removed, so
   a retry after a lost response can record the sale twice and staff resolve it
   with a credit note. This story is not part of pilot acceptance; it returns if
   the pilot records such a duplicate.
7. As a **pharmacist**, I want to accept a return against a sale by quantity,
   with the goods going to quarantine and the money credited (and handed back
   when the customer is at the counter), so that money and stock move together
   and a damaged pack is not resold.
8. As a **supervising pharmacist**, I want to release quarantined stock to the
   shelf or write it off, so that returned goods are inspected before sale.
9. As a **pharmacist**, I want to receive a delivery as batches with quantity,
   expiry, MRP, free quantity, rate, discount and GST checked against the
   supplier's bill total, so that new stock enters by the front door with its
   cost, and a mistyped line shows before it is saved.
10. As a **supervising pharmacist**, I want a reason-coded adjustment
    (breakage, expiry write-off, count correction, internal issue, hold in
    quarantine) with an explanation, so that a stock difference is explained,
    not typed over.
11. As an **administrator**, I want to post opening stock as an opening goods
    receipt with the count time and the retained sheet, so that cutover starts
    from a verified number with its evidence.
12. As an **administrator**, I want to maintain the product master (name,
    generic, form, strength, stock unit, pack size, and, for a product sold at
    the counter, code, HSN and GST rate), so that sales carry the right tax and
    an internal supply is stocked without being billable.
13. As an **accountant**, I want pharmacy Invoices in their own printed series
    and pharmacy revenue in its own account, so that the outward register and
    trial balance separate pharmacy from OPD.
14. As an **accountant**, I want pharmacy prices to be MRP inclusive of GST,
    with taxable value and tax extracted from the discounted amount per line,
    so that the printed document matches how Indian pharmacies price and its
    totals reconcile.
15. As an **accountant**, I want a return to show what is still owed back to
    the customer until it is refunded, so that no obligation is invisible.
16. As an **administrator**, I want stock on hand, quarantine, and an
    expiring-soon list, so that I see what to move and what to write off.

## Simplifications adopted (2026-09-18)

Each replaces an earlier draft choice. The reason is the same for all: the
smaller change that satisfies the story.

1. **No buyer column rename.** `invoices.patientName` stays the printed
   "billed to" name for both streams. `invoices.patientId`, `patientMrn`, and
   `patientPhone` become nullable; that is the whole change. There is no
   stop-the-world release and Open Question 2 is closed.
2. **OPD counter keys are untouched.** OPD keeps `invoice:${fy}`; pharmacy uses
   `invoice:pharmacy:${fy}`. No counter rows are migrated.
3. **`stream` only, no `priceBasis` column.** The basis is a pure function of
   the stream in code and in the header check.
4. **HSN and GST live on the catalog row** (`catalog_items.taxCode`,
   `taxRatePercent`), which already snapshots to the Charge. `products` holds
   the display name and the pharmacy facts.
5. **No `blocked` flag.** A supervisor hold is a move to the quarantine bucket
   (`adjustStock`, reason `quarantine`); release is the inverse.
6. **One adjustment command.** `pharmacy.adjustStock` covers release,
   quarantine, write-off, breakage, count correction, and internal issue. There
   is no separate `releaseQuarantine`.
7. **Opening stock is a goods receipt.** The same document with `opening` set
   carries no supplier and refuses a batch that already moved; there is no
   separate count table or procedure. A bulk import by catalog code is a script
   that calls the same procedure, not a second input shape.
8. **Reconciliation is a read, not a report module.** `pharmacy.listMovements`
   and `pharmacy.stockOnHand` (with the expiring and quarantine filters) are
   the reconciliation surface; the former Slice 4 report procedures are
   dropped. The physical-count and downtime procedures are a short section in
   Operations.
9. **Finance helpers are one file.** `packages/api/src/lib/billing-documents.ts`
   holds the transaction helpers the OPD and pharmacy desks share; no
   `lib/billing/` directory.
10. **No Daily Collections stream breakdown.** The pharmacy prefix, the sales
    list, and the `revenue_pharmacy` account separate the streams; a
    breakdown is added only if the accountant asks after the pilot month.
11. **Two integration test files**, one per half, so the two halves can be
    built and verified in parallel.
12. **A return can hand the money back at once.** `returnSale` takes an
    optional immediate refund line; otherwise the refund-due worklist shows the
    obligation until an accountant records it.

## Implementation Decisions

### Finance: helpers that take the caller's transaction

The OPD desk and the pharmacy desk stay separate commands (D019). What they
share moves out of `routers/billing.ts` into
`packages/api/src/lib/billing-documents.ts`. Every helper takes the caller's
transaction and never reads a care record:

- `lockInvoice(tx, orgId, invoiceId)`: locks the invoice row only; returns
  `{ id, invoiceNumber, grandTotal, roundOff, patientId, stream, treatmentPlanId }`
  where `treatmentPlanId` comes from a **left** join to the OPD Appointment.
- `applyPatientCreditTx(tx, { scope, invoice, amount, now, timeZone })`:
  unchanged body; refuses (`CONFLICT`) when `amount > 0` and
  `invoice.patientId` is null.
- `issueInvoiceTx(tx, { scope, parent, discountAmount, note, settings, now,
fiscalYear, invoiceId })` where `parent` is
  `{ stream: "opd", opdAppointmentId, patient: { id, name, mrn, phone, address, guardian } }`
  or `{ stream: "pharmacy", pharmacySaleId, patient: { id: string | null, name, mrn: string | null, phone: string | null, address: null, guardian: null } }`.
  It locks and reads the parent's pending charges, computes lines with the
  stream's basis and rounding, numbers from `invoice:${fy}` or
  `invoice:pharmacy:${fy}` with `invoicePrefix` or `pharmacyInvoicePrefix`,
  inserts invoice and lines, marks charges invoiced, posts the journal
  including the signed round-off to the system account. The OPD appointment
  lock, status and revision checks, and revision bump stay in
  `settleInvoiceTx` in
  `billing.ts`, which calls this helper.
- `recordPaymentsTx(tx, …)`: today's body, on the new `lockInvoice`.
- `postCreditNoteTx(tx, { scope, invoiceId, reason, lines: [{ invoiceLineId,
taxableValue, taxAmount, gross }], roundOff, settings, now, fiscalYear,
creditNoteId })`: required `roundOff` is `0n` for non-pharmacy callers and
  partial returns, the original invoice's value for the return completing it.
  The helper caps each line at its remaining taxable, tax, and gross, caps
  the total at the invoice, and reverses the round-off journal entry.
- `insertRefundTx` moves as is.

OPD owns appointment eligibility and its charge revision; Pharmacy owns batch
eligibility; these helpers own documents and money. Every join from an invoice
to an OPD Appointment (readers, reports, PDF, refund-due) becomes a left join
that tolerates a pharmacy invoice.

### Invoice stream, parents, and buyer

- `invoices.stream` (`opd | pharmacy`, check-constrained, default `opd` so the
  migration backfills). Basis: `opd` is tax-exclusive, `pharmacy` is
  tax-inclusive.
- **Price and total snapshots.** `charges.priceUnits` and
  `invoice_lines.priceUnits` are positive integers (default 1), paired with
  `unitPrice` in bigint paise per that many stock units. An invoice stores
  `roundOff` in bigint paise (default 0); its CHECK bounds it to −49..50,
  requires zero for OPD, and includes it in the grand-total identity.
  Credit notes also store bigint `roundOff` (default 0), with the note total
  equal to its line gross sum plus `roundOff`.
- **Numbering.** `invoice:${fy}` for OPD (unchanged) and
  `invoice:pharmacy:${fy}` for pharmacy. `organization_settings` gains
  `pharmacyInvoicePrefix` (`SETTINGS_DEFAULTS` value `"PH"`), required, and
  the settings form edits it. Receipts, credit notes, and refunds keep their
  single org series.
- **Typed parents.** `invoices.opdAppointmentId` and `charges.opdAppointmentId`
  become nullable; both gain `pharmacySaleId` (composite tenant foreign key to
  `pharmacy_sales`). A check on each table enforces exactly one parent;
  `invoices` also checks that the parent matches `stream`. A unique index on
  `(orgId, pharmacySaleId)` on `invoices` makes one invoice per sale.
- **Buyer.** `invoices.patientId`, `patientMrn`, and `patientPhone` become
  nullable. `patientName` is the printed name for either stream. The PDF and
  worklists print MRN and phone only when present.
- **Category and account.** `CATALOG_CATEGORIES` gains `pharmacy`;
  `REVENUE_ACCOUNTS` gains `revenue_pharmacy` (code 4500, income). The
  category checks on `catalog_items`, `charges`, `invoice_lines`, and
  `treatment_plan_items` admit it. `OPD_BILLABLE_CATEGORIES` is unchanged
  (D024). `catalog.create` and `catalog.update` refuse category `pharmacy`:
  a product's catalog row is written only through `pharmacy.createProduct`
  and `updateProduct`.
- **Patient credit** may be applied only when the sale names a `patientId`;
  otherwise `applyCredit` must be zero (`BAD_REQUEST`).
- **Generic credit notes are refused on pharmacy invoices.** `issueCreditNote`
  checks `stream = "opd"` and throws `CONFLICT`. A pharmacy invoice is
  corrected only by a return: every line returns goods (`qty ≥ 1`) and its
  money is derived from the invoice line. A money-only correction has no
  defined amount source and waits for the pharmacy owner's Stage 0 answer (open
  question 2).

### Tax-inclusive arithmetic

`computeInvoiceLines(charges, discountPaise, stream)` takes
`stream: "opd" | "pharmacy"`, which selects both behaviours: pharmacy prices
are tax-inclusive and the document total rounds half-up to whole rupees; OPD
prices are tax-exclusive and the total stays exact to the paisa.
A price is `unitPrice` paise per `priceUnits` stock units; each exact line
subtotal is `qty × unitPrice / priceUnits`, never a rounded unit or line
price. With `L = lcm(priceUnits)` and
`eᵢ = qtyᵢ × unitPriceᵢ × (L / priceUnitsᵢ)`, the document subtotal is
`roundHalfUp(Σeᵢ / L)`. Each line receives `floor(eᵢ / L)` plus one paisa
for each leftover paisa, assigned by largest `eᵢ mod L` (ties in input
order). Thus the stored integer-paise line subtotals sum exactly to the
rounded document subtotal without independently rounding lines. Discounts
are allocated across these subtotals as before. Then:

```text
exclusive (opd):      taxableValue = lineSubtotal − allocatedDiscount
                      taxAmount    = roundHalfUp(taxableValue × rate / 100)
                      gross        = taxableValue + taxAmount
inclusive (pharmacy): gross        = lineSubtotal − allocatedDiscount
                      taxableValue = roundHalfUp(gross × 100 / (100 + rate))
                      taxAmount    = gross − taxableValue
```

Header: `subtotal = Σ lineSubtotal`, `taxTotal = Σ taxAmount`, and
`preRound = Σ gross`. OPD stores `roundOff = 0` and `grandTotal = preRound`
(paisa precision). Pharmacy stores
`grandTotal = roundHalfUp(preRound / 100) × 100` and
`roundOff = grandTotal − preRound` (−49..50 paise), posted to the system
round-off account. The header check is
`grandTotal = subtotal − discountAmount + (case stream when 'opd' then taxTotal else 0 end) + roundOff`.
The credit note completing a full pharmacy return reverses that invoice's
round-off; earlier partial returns do not.
Worked cases that `tests/unit/invoice-math.test.ts` contains, all in paise:

| Case                                  | Subtotal | Discount | Taxable  | Tax      | Gross |
| ------------------------------------- | -------- | -------- | -------- | -------- | ----- |
| 1 × ₹112 at 12 %, no discount         | 11200    | 0        | 10000    | 1200     | 11200 |
| 1 × ₹112 at 12 %, ₹12 discount        | 11200    | 1200     | 8929     | 1071     | 10000 |
| 1 × ₹50 at 0 %                        | 5000     | 0        | 5000     | 0        | 5000  |
| 1 × ₹112 at 12 %, fully discounted    | 11200    | 11200    | 0        | 0        | 0     |
| ₹112 at 12 % + ₹105 at 5 %, ₹10 disc. | 21700    | 1000     | see test | see test | 20700 |

The mixed-rate case allocates the discount by subtotal share as today and
the largest line absorbs the discount remainder; the test pins the exact
split.
`derivePartialCredit` already extracts tax from a gross amount and is reused
for the inclusive line.

### Sale snapshots

A Charge stays the money snapshot: description (`"<name> · batch <number>"`),
`unitPrice` (batch MRP exactly as printed), `priceUnits` (batch `mrpUnits`),
GST rate and `taxCode` (HSN) from the catalog row,
`revenueCategory = "pharmacy"`, `sourceType = "pharmacy_batch"`,
`sourceId = batchId`, `pharmacySaleId` set, `opdAppointmentId` null. Batch rows
are immutable once created (number, expiry, price never change; a conflicting
arrival is refused), so the batch row is the structural snapshot of batch and
expiry, and the sale view reads it by `sourceId`. The Invoice line snapshots
the Charge's `unitPrice` and `priceUnits` (OPD/treatment keep `priceUnits = 1`).

### Product master and stock

All tables carry `orgId NOT NULL` with a cascade to `organization` and a
`unique (orgId, id)` for composite tenant foreign keys, as the existing schema
does. Ids are UUIDv7 text. Reason and unit sets are `text` columns typed by an
`as const` array; the zod input schemas own their validity (D042).

- **`products`** (D027 domain master): `id`, `orgId`, `catalogItemId`
  (nullable composite FK, unique per org where it is not null), `name`,
  `genericName` (nullable), `form` (nullable text, e.g. tablet, syrup),
  `strength` (nullable text, e.g. 500 mg), `stockUnit` (`tablet | capsule | ml
| strip | bottle | vial | tube | piece`), `unitsPerPack` (integer ≥ 1, the pack
  size printed on the box), `schedule` (`none | h | h1 | x`), `manufacturer`
  (nullable), `createdAt`, `updatedAt`. A product with a catalog row is sold at
  the counter; one without it is an internal supply (gloves, soap, cleaning
  liquid) that is stocked and issued but never billed. `name` is the single
  display name and the create and update commands copy it onto the linked
  catalog row in the same transaction, because that row is the invoice snapshot
  source. Code, HSN, GST rate, and active live on the catalog row.
  `stockUnit` and `unitsPerPack` are frozen once the product has a batch; an
  update that changes either after that is refused with `CONFLICT`.
- **`stock_batches`**: `id`, `orgId`, `productId`, `batchNumber`,
  `expiryDate` (date; the last day of the printed month), `mrp` (paise as
  printed per `mrpUnits` stock units, ≥ 0), `mrpUnits` (integer > 0;
  existing batches default to 1), `createdAt`. Unique on `(orgId, productId,
batchNumber)`. A receipt naming an existing batch with a different expiry
  or price is refused (`CONFLICT`); equivalent prices compare by cross-
  multiplication (`old.mrp × new.mrpUnits = new.mrp × old.mrpUnits`) and keep
  the first arrival's representation.
- **`stock_movements`**: `id`, `orgId`, `batchId`, `bucket` (`shelf |
quarantine`), `qty` (non-zero integer), `reason` (`opening | receipt | sale |
return | release | quarantine | writeoff | breakage | count_correction |
internal_issue`), `sourceType` (`goods_receipt | pharmacy_sale |
pharmacy_return | adjustment`), `sourceId`, `departmentId` (nullable composite
  FK, set only by an `internal_issue`), `note` (nullable), `createdBy`,
  `createdAt`. Unique on `(orgId, sourceType, sourceId, batchId, bucket)` so a
  source posts each movement once per bucket. A check ties sign to reason:
  `sale`, `writeoff`, `breakage`, `internal_issue` negative; `opening`,
  `receipt`, `return` positive; `release` and `quarantine` are pairs (one
  negative, one positive row across the two buckets); `count_correction`
  either. Index on `(orgId, batchId, bucket)`. On hand per bucket is
  `sum(qty)`; sellable stock is the shelf bucket.
- **Every stock writer** (sale, return, adjustment, receipt) locks its
  batches `SELECT … FOR UPDATE` ordered by `(expiryDate, id)`, then reads the
  bucket sums in a new statement, and refuses (`CONFLICT`) a result below zero.
  Lines are aggregated by batch before the check, so two lines on one batch
  cannot each pass alone. Shared code lives in
  `packages/api/src/lib/stock.ts`.
- **`goods_receipts`** (no purchase order or supplier ledger): `id`, `orgId`,
  `opening` (boolean, default false),
  `supplierName` (nullable), `supplierReference` (nullable), `receivedOn` (a
  `date`: the day named on the document, not an instant),
  `fileId` (nullable composite FK to `file`), `note` (nullable), `billTotal`
  (paise; null on an opening count), `receivedBy`,
  `createdAt`. Lines create batches as needed; one movement per batch adds
  billed and free units aggregated across its lines (`sourceType =
"goods_receipt"`).
- **`goods_receipt_lines`** (one per supplier bill or opening-count line):
  `receiptId`, `batchId`, `qty` and `freeQty` (stock units), `packSize`
  (stock units the rate covers), `rate` (printed PTR before discount and GST,
  paise per `packSize` units), `discountPercent`, `gstPercent`, and `hsnCode?`.
  No computed amount or unit cost is stored. Both percentages have database
  CHECKs from 0 through 99.99. `receiptLineCost` in
  `packages/api/src/core/receipt-math.ts` derives gross, discount, taxable,
  GST and net exactly in bigint units of 10⁻⁸ paisa; it never rounds a line
  or unit. GST is part of cost (owner decision, 2026-09-23); retaining exact
  receipt facts permits later valuation without a rounded unit cost and
  reassessment if the accountant confirms input tax credit. Only the sum of
  line nets rounds to paise, and the printed bill total must be within
  ±₹0.99 of that rounded sum. Repeated lines for one batch remain separate
  priced lines, while stock movements aggregate by batch.
  Opening stock is the same document with `opening` set: it names no supplier,
  keeps the signed count sheet in `fileId`, and posts `opening` movements, so a
  batch that already has a movement is refused (`CONFLICT`). Opening counts
  reject expired batches: at pilot cutover expired inventory enters through
  the separate quarantine/write-off process, not the opening count; expired
  stock is never sellable. A later count is a `count_correction` adjustment.
- **`pharmacy_sales`**: `id`, `orgId`, `patientId` (nullable, composite FK),
  `opdAppointmentId` (nullable, composite FK), `buyerName`, `buyerPhone`
  (nullable), `forName` (who the medicine is for; the buyer when omitted),
  `prescriberName` (nullable), `prescriptionReference` (nullable), `note`
  (nullable), `soldBy`,
  `createdAt`. A sale containing a Schedule H1 line requires `forName` and
  `prescriberName` (`BAD_REQUEST`). **Schedule X lines are refused**
  (`BAD_REQUEST`). H1 register printing is deferred; the sale captures the
  facts the paper register needs.
- **`pharmacy_returns`** header: `id`, `orgId`, `pharmacySaleId`, `invoiceId`,
  `creditNoteId`, `reasonCode` (`damaged | wrong_item | unwanted |
expired_on_shelf | correction`), `note` (nullable), `acceptedBy`, `createdAt`.
  **`pharmacy_return_lines`**: `id`, `orgId`,
  `returnId`, `invoiceLineId`, `batchId`, `qty` (≥ 0), `gross` (≥ 0). The
  command takes `qty ≥ 1` on every line (the rule lives in zod, D042); `gross`
  is the credited share and is zero on a fully discounted line.

### Commands

All under `orgProcedure`, in `packages/api/src/routers/pharmacy.ts` (sale half)
and `packages/api/src/routers/pharmacy-stock.ts` (stock half), merged into one
`pharmacy` router the way `billingWorklistRouter` merges into `billing`.

**`pharmacy.sell`** (`pharmacy:sell`) takes `lines: [{ batchId, qty }]` (min 1),
`buyer: { patientId } | { name, phone? }`, `forName?`, `prescriberName?`,
`prescriptionReference?`, `opdAppointmentId?`, `discountAmount` (default 0),
`note?`, `payments[]` (max 4, `paymentLine`), `applyCredit` (default 0),
`expectedGrandTotal`.

1. In one transaction, resolve the buyer (a `patientId` is read under scope and
   its name, MRN, phone become the buyer; a walk-in buyer is the given name and
   phone); lock the OPD Appointment if given and verify it belongs to the same
   Patient (`CONFLICT` otherwise); insert the sale.
2. Read the batches with their product and catalog rows; a product with no
   catalog row is not sellable, so the join refuses it. Refuse
   (`BAD_REQUEST`, naming the medicine): expired batch (`expiryDate < today`
   in the org time zone), inactive catalog item, Schedule X, Schedule H1
   without `forName` and `prescriberName`. Insert one Charge per line.
3. Lock batches in order, read shelf sums, refuse (`CONFLICT`) an aggregated
   qty above shelf stock, naming the medicine.
4. `issueInvoiceTx` (stream `pharmacy`), compare `expectedGrandTotal`
   (`CONFLICT`), then `recordPaymentsTx`. A walk-in (no `patientId`) must pay
   in full (`BAD_REQUEST`); a Patient sale that leaves a balance needs a
   `note`.
5. Insert one `sale` movement per batch (`sourceType = "pharmacy_sale"`).
6. Audit `pharmacy.sell` and each payment as `payment.record`.

Returns `{ saleId, invoiceId, invoiceNumber, payments }`.

**`pharmacy.returnSale`** (`pharmacy:return`) takes `saleId`, `reasonCode`,
`note?`, `lines: [{ invoiceLineId, qty }]` (min 1), and
`refund?: { method, amount, reference? }`. Under the invoice lock, then the
batch locks, it caps each line at sold minus already returned
(`BAD_REQUEST`), computes money from the original line's snapshots pro rata by
quantity with the final unit taking the exact remainder of taxable, tax, and
gross, posts the credit note through `postCreditNoteTx` with `roundOff = 0`
unless every invoice line is fully returned after this return, in which case
it reverses the invoice `roundOff` so all credit notes sum to the invoice
`grandTotal`. It inserts the return and its lines and posts one `return`
movement per batch into **quarantine**. A fully discounted line returns
goods with zero money. When `refund` is given it
is capped at the credit note total and posted with `insertRefundTx` (debit
`patient_receivables`, source `{ invoiceId, creditNoteId }`); otherwise the
existing refund-due worklist shows the obligation until `recordRefund` clears
it. A return whose lines are all fully discounted is worth nothing and issues
no credit note. Audited as `pharmacy.return`, plus `creditNote.issue` and
`refund.record` for the documents it created. Returns `{ returnId, creditNoteId,
creditNoteNumber, refund }`, where `creditNoteId` and `creditNoteNumber` are
`null` on a zero-value return.

**`pharmacy.adjustStock`** (`pharmacy:adjust`) takes `batchId`, `reason`
(`release | quarantine | writeoff | breakage | count_correction |
internal_issue`), `qty` (positive integer; `count_correction` takes a signed
non-zero integer), `bucket` (`shelf | quarantine`, for `writeoff`, `breakage`,
`count_correction`; `internal_issue` is always shelf; `release` and
`quarantine` move between the two buckets), and `note` (required). It locks
the batch, reads the sums, refuses a bucket below zero, and inserts the row or
pair (`sourceType = "adjustment"`, `sourceId` = a fresh UUIDv7 shared by the
pair). Audited.

**`pharmacy.receiveGoods`** (`pharmacy:receive`) takes `opening` (default false),
`supplierName?`, `supplierReference?`, `receivedOn` (`YYYY-MM-DD`), `fileId?`,
`note?`, `billTotal?`, and
`lines: [{ productId, batchNumber, expiryDate, qty, pricedPer: "pack" | "unit",
mrp, cost?: { freeQty, rate, discountPercent, gstPercent, hsnCode? } }]`
(min 1, positive qty). `mrp` and `rate` are paise per priced unit exactly
as printed. The client sends no `packSize`: the server derives the divisor
from the locked product (`unitsPerPack` for `"pack"`, 1 for `"unit"`),
stores it as batch `mrpUnits` and receipt-line `packSize`, and requires a
priced line's billed qty to divide by it. Quantities and the movement total
aggregated per batch stay within the PostgreSQL integer range; free qty need
not be ≤ billed qty. A non-opening receipt names its supplier, prices every
line, and reconciles the rounded sum of exact line nets against the printed
bill total within the explicit ±₹0.99 supplier-bill tolerance.
An opening receipt carries no cost pricing. The command verifies the file
belongs to the org, is `ready`, and is a PDF or image, creates the header
and one row for each priced line, creates each missing batch (refusing a
conflicting expiry or non-equivalent MRP), and posts one aggregated movement
per batch into the shelf: `receipt`, or `opening` when set. Opening refuses
expired or already-moved batches (`CONFLICT`). Audited.

**`pharmacy.createProduct`** / **`updateProduct`** (`pharmacy:manageItems`)
take `name`, the product fields, and an optional `catalog`
(`code`, `taxRatePercent`, `taxCode?`, `active`). With `catalog` they write the
`catalog_items` row (category `pharmacy`, `unitPrice` 0, `customRate` false)
carrying the product's name, and link it; without it the product is an internal
supply. Update refuses dropping `catalog` from a product that has a catalog row,
and refuses a change to `stockUnit` or `unitsPerPack` once a batch exists.

Lock order (Architecture) becomes: OPD Appointment → Treatment plan item →
Treatment plan → Charges → Invoice → Products (by `id`) → Stock batches (by
`expiryDate`, `id`) → Advance Receipts (by `createdAt`, `id`). A return locks
the Invoice before the batches. A sale has no invoice yet, so it locks batches
after inserting Charges and before issuing, which keeps the same relative order.
Counters keep the order token → invoice → receipt.

### Roles and permissions

- Statement `pharmacy: ["read", "sell", "return", "receive", "adjust",
"manageItems"]`.
- Role **pharmacist**: `member: read`; `pharmacy: read, sell, return, receive`;
  `patient: read`; `opd: read`; `billing: read`; `catalog: read`; `settings:
read`; `file: read, upload`; `report: readDailyCollections`. No
  `billing:write`: `pharmacy.sell` is authorized by `pharmacy:sell` and calls
  the finance helpers internally.
- `owner`, `admin`: all six. `accountant`, `cashier`, `reception`: `read`.
  `adjust` and `manageItems` are owner and admin only; the administrator grants
  `admin` alongside `pharmacist` to a supervising pharmacist (roles are a
  union).
- `ROLE_LABELS.pharmacist = "Pharmacist"`; `ORG_ROLES` gains it.

### Reads

- `pharmacy.searchStock({ query })` (`pharmacy:read`): active sellable products
  by name, code, or generic, each with its sellable batches (shelf sum > 0,
  not expired) ordered by `(expiryDate, id)` with `shelfQty`, printed `mrp`
  and `mrpUnits`; bounded to 20 products. An internal supply has no catalog
  row and never appears here.
- `pharmacy.stockOnHand({ productId?, expiringWithinDays?, quarantineOnly?,
includeZero? })` (`pharmacy:read`): every product's batches with `shelfQty`,
  `quarantineQty`, `mrp` and `mrpUnits`, ordered by expiry; zero-stock batches
  excluded unless asked.
- `pharmacy.listMovements({ batchId })` (`pharmacy:read`): movements newest
  first with the actor name and, for an internal issue, the department.
- `pharmacy.listProducts({ query?, cursor?, limit })` (`pharmacy:read`):
  keyset by `(name, id)` like `catalog.list`, including inactive and
  internal-supply rows.
- `pharmacy.getSale({ saleId })` (`pharmacy:read`): the sale, its invoice with
  `roundOff` and lines (each with batch number and expiry via
  `charges.sourceId`), payments, returns with lines and credit-note
  `roundOff`, refunds, and the invoice balance (refund due is
  `-outstanding` when negative).
- `pharmacy.listSales({ from?, to?, cursor?, limit })` (`pharmacy:read`): sales
  newest first by `(createdAt, id)` with invoice number, buyer, grand total.
- Reports label pharmacy figures as sales and revenue, never profit.
  Receipt lines retain exact rate, quantities, discount and GST; unit cost
  may be derived for display, but no report derives margin until the purchasing
  spec decides valuation from those facts.

### UI

Plain and standard: the existing list, Sheet, `useZodForm`, and `FormDialog`
patterns; product forms use `FormSheet` with fixed header and actions around a
scrollable body. No motion on the sale path. The shared list
filter (`components/list-filter.tsx`, D043) serves the stock list's product,
expiry and bucket at once, which the toggle-pill row could not express, and the
same control replaced the pill rows and period controls on the other lists so
the console keeps one filter idiom.

- `/$orgSlug/pharmacy` (`pharmacy:read`): the section's landing page, a
  date-ranged sales list defaulting to the current day, with **New sale** for
  `pharmacy:sell`. `?sale=` opens a Sheet with the sale, lines, payments,
  returns, refund due, **Print**, and a **Return** form (qty per line, reason,
  note, optional refund).
- `/$orgSlug/pharmacy/new` (`pharmacy:sell`): the counter desk, laid out like
  OPD intake — a sectioned card beside a sticky payment aside, no tab strip, a
  blocker on an abandoned cart. Sections are buyer (Patient search or free name
  and phone), items (a batch type-ahead over the shelf plus a line table of
  medicine, batch, expiry, qty, MRP and amount), and a prescription disclosure
  for for-whom, prescriber and reference that opens itself when an H1 line is
  present. **Collect** opens the shared `SettlementOverlay` on an inclusive-tax
  basis, which owns discount, credit, payment lines and note. On success it
  returns to the sales list with the new sale open, where **Print** lives.
- `/$orgSlug/pharmacy/stock`: batches with shelf and quarantine, filters
  (product, expiring within 30/90 days, quarantine only); a Sheet for **Adjust**
  (which needs `pharmacy:adjust`); a batch row expands to its movements.
  **Receive goods** links to its own page.
- `/$orgSlug/pharmacy/receive` (`pharmacy:receive`): a page, not a dialog,
  laid out as a ledger that follows the supplier bill (the Ledger prototype,
  promoted 2026-09-23). The delivery details (supplier, bill number, bill
  total, date and bill copy, or the **opening stock count** with its signed
  sheet) sit above one line per product and batch. A line's first row names
  the stock — product, batch, expiry, billed quantity, count as packs or loose
  units; its second row prices it — free quantity, rate, discount %, GST %,
  MRP, HSN and the line total with derived cost per unit; a delivery is
  refused when that cost reaches the MRP. An opening count asks only the
  printed MRP and refuses expired batches. Picking a product fills GST % and
  HSN from its counter tax. Displayed line totals allocate the once-rounded
  document total by largest remainder, so they reconcile exactly with the
  footer; the footer states whether that total matches the printed bill within
  the explicit ±₹0.99 tolerance. **Back to stock** returns through the unsaved-delivery
  confirmation. The page converts packs with `unitsPerPack`; the receipt
  stores stock-unit quantities and the MRP with its printed `mrpUnits`
  denominator, never a rounded per-unit MRP. **New product** opens a Sheet
  without leaving the delivery and selects the created product on the line.
- `/$orgSlug/pharmacy/items`: product master list and create/edit Sheet
  (`pharmacy:manageItems`).
- Navigation: one **Pharmacy** entry in the Care group gated on
  `pharmacy:read`; Sales, Stock and Products link to each other from a small tab
  strip. The desk is a task opened from Sales, not a tab.
- Settings → Organization gains the **Pharmacy invoice prefix** field.

## Test Seams

- **Unit, `tests/unit/invoice-math.test.ts`**: inclusive tax, fractional-
  paisa MRP allocation by largest remainder, rupee grand-total round-off
  and unchanged OPD paisa math.
- **Unit, `tests/unit/access.test.ts`**: pharmacist can sell, return, and
  receive but not adjust or manage items and holds no `billing:write`;
  accountant holds no pharmacy write; the matrix gains the `pharmacist` column.
- **Integration, `tests/integration/pharmacy-stock.test.ts`**: a receipt
  retains printed pack MRP and exact line facts, allows separate priced lines
  for a batch while aggregating movements, and reconciles only the bill
  total; a second arrival with a different
  expiry or non-equivalent MRP is refused; an opening receipt records its count
  sheet and refuses touched or expired batches; an internal issue names its
  department and is refused without one; quarantine and release move quantity
  between buckets and a bucket cannot go below zero; `updateProduct` refuses
  a unit change after a batch exists; `catalog.create` refuses category
  `pharmacy`; foreign product, batch and file ids are `NOT_FOUND` across orgs.
- **Integration, `tests/integration/pharmacy-sale.test.ts`**: a sale reduces
  shelf per batch, numbers in the pharmacy series with the pharmacy prefix,
  prices loose units against printed pack MRP, extracts tax from discounted
  gross, records the receipt and a balanced journal on `revenue_pharmacy`
  and the round-off account; expired, inactive, over-stock (two lines on one
  batch), Schedule X, and H1 without prescriber are each refused with no
  rows written; two concurrent sales of the last unit have one winner;
  repeated partial returns end in exact reversal of taxable, tax, gross,
  and invoice round-off only on the completing return; a return above
  remaining qty is refused; a returned unit sits in quarantine and cannot
  be sold; an immediate refund on return is capped and clears refund due;
  `issueCreditNote` refuses a pharmacy invoice; a walk-in partial payment is
  refused; foreign sale and invoice ids are
  `NOT_FOUND`.
- **Regression, existing `billing.test.ts`, `accounting.test.ts`, `opd.test.ts`,
  `treatment.test.ts`**: green and unchanged except where invoice patient fields
  are asserted by type.
- **Tenancy, `tests/integration/tenancy.test.ts`**: every pharmacy procedure is
  in `GUARDED_CALLS`.

## Task Plan

- [x] Slice 0: Stage 0 sign-off — replaced by the assumed answers above; the
      owner confirms at the walkthrough.
- [x] Slice 1: Finance foundation (landed 2026-09-18)
  - Acceptance: helpers extracted into `lib/billing-documents.ts` and OPD
    settlement, credit note, and refund rewired to them with every existing
    billing, accounting, OPD, and treatment test green; `stream`, typed
    parents, nullable buyer fields, `pharmacyInvoicePrefix`, `pharmacy`
    category and account, inclusive math and header check; every invoice reader
    tolerates a missing appointment and MRN; the new pharmacy tables exist
    (one generated migration); D025 rewritten as accepted.
  - Verify: `bun run check-types`; `bun run test`.
  - Owns/Touches: `packages/db/src/schema/*` and migration; `packages/api/src/lib/{billing-documents,invoice-math,ledger}.ts`;
    `packages/api/src/routers/{billing,billing-worklist,opd,patient,report,settings,catalog}.ts`;
    `apps/web/src/components/pdf/billing-documents.tsx`; the settings form;
    `packages/auth/src/access.ts`; `tests/unit/{invoice-math,access}.test.ts`;
    `docs/decisions.md` D025.
- [x] Slice 2: Pharmacy routers and tests (landed 2026-09-18)
  - Acceptance: every command and read above; `GUARDED_CALLS` complete; both
    integration files green.
  - Verify: `bun run check-types`; `bun run test`.
  - Owns/Touches: `packages/api/src/lib/stock.ts`,
    `packages/api/src/routers/{pharmacy,pharmacy-stock,index}.ts`,
    `tests/integration/{pharmacy-stock,pharmacy-sale,tenancy}.test.ts`.
- [x] Slice 3: Pages and docs (landed 2026-09-18; the item → receive → sell →
      print → return → release path was walked in the running app; thermal and
      A4 prints and mobile widths remain on the pilot-readiness checklist)
  - Acceptance: the four pages and navigation; product language, architecture
    lock order and ledger, operations count and downtime procedures, and the
    registry row updated.
  - Verify: `bun run check-types`; `bun run build`; the desk, stock, and items
    pages exercised in the running app.
  - Owns/Touches: `apps/web/src/routes/$orgSlug/pharmacy/*`,
    `apps/web/src/lib/navigation.ts`, `docs/{product,architecture,operations,README}.md`.

## Out of Scope

- Purchase orders, supplier accounts and ledger, supplier GSTIN and the
  CGST/SGST/IGST split, rejected quantity, freight and other landed costs,
  stock valuation, inventory asset, and cost of goods sold. The purchasing spec
  builds on `goods_receipt_lines`. Reports never present pharmacy revenue as profit.
- Fractional units and pack splitting beyond the Stage 0 conversion.
- Prescription-driven dispensing (a digital prescription that becomes lines).
- Typed IPD and ward issues against an Admission (the interim path is
  `internal_issue`).
- Multiple stores or locations per organization.
- Reorder levels, supplier returns, drug interaction and allergy checks.
- Schedule X sales, refused outright.
- Bulk opening-stock import from a file (a script may call `receiveGoods` with
  `opening` set).

## Explicitly Deferred

- Schedule H1 register printing. The sale captures for-name, prescriber, and
  prescription reference; the paper register continues until the print ships.
- Near-expiry colour at the sale line; the batch list shows expiry.
- Partial payment for a walk-in without a Patient: refused.
- Purchase GST as input tax credit. Receipt-line facts retain GST separately
  through `gstPercent`; derived taxable and GST amounts are exact. A hospital
  that is GST-registered with taxable pharmacy sales may claim input credit
  rather than including GST in cost. The purchasing spec must decide that
  valuation treatment from the retained facts, without persisting unit cost.
- Stock valuation and opening valuation. The count document retains the sheet
  so a later dated valuation cutover has its evidence.
- Chartered accountant and licensing adviser sign-off on the inclusive-MRP
  presentation, document label, licence particulars on the print, the
  GST registration used, and whether purchase GST is claimed as input credit
  or included in cost derived from exact receipt facts. These sit on the
  go-live checklist in Operations.
- A Daily Collections breakdown by stream.
- A maintained balance column. The sum with a `(orgId, batchId, bucket)` index
  is measured on realistic movement history before any projection is added.

## Open Questions

1. **Pharmacy owner and the six Stage 0 answers.** Implementation proceeds on
   the assumed answers; a correction is a spec change.
2. **Money-only pharmacy correction.** No amount source is defined for a
   credit without goods, and a generic credit note is refused on a pharmacy
   invoice. If the pharmacy owner needs one, this spec must state the amount,
   its cap against the line's uncredited gross, and the tax split before the
   return command takes a money line.
