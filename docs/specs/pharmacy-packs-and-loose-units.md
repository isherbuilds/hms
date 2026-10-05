# Spec: Pharmacy packs and loose units

Lifecycle and remaining evidence: [work registry](../README.md#work-lifecycle).
Authority: owner statement and delegated decision, 2026-09-29. Loose sales exceed whole-strip sales at the pilot pharmacy, and loose tablets are accepted back as returns. The owner delegated the design choice and accepted the result.
Supersedes: the one-unit rule in D049, Stage 0 answer 1 in [Pharmacy counter sale and stock](./pharmacy-counter-sale-and-stock.md), and the deferred loose-sale item in [Pharmacy goods and services](./pharmacy-goods-and-services.md). The Product and Service split, D027 as amended, invoice streams, return quarantine and the accounting contracts stay in force.

## Problem

Before this change, HMS counted and priced each Product in one unit. Staff
could keep separate strip and tablet Products, with mismatched stock when a
strip was cut, or count tablets and type a rounded unit price that could
exceed the printed MRP for a full strip. Medicines are not the only goods:
sanitary pads sell by packet, injections and IV sets arrive by box and go to
wards by piece, and a BP apparatus for sale has no expiry date.

Previously a pharmacy Charge named its batch in text without a foreign key,
so the database could not refuse a nonexistent batch.

## Solution

- A Product is counted in its smallest unit. It can state how many of that unit one pack holds. The pharmacist receives strips as the supplier bill prints them, sells any number of tablets, and takes loose tablets back.
- The batch keeps the MRP exactly as printed on the pack. HMS never rounds a price per tablet. Ten tablets from a strip of ten cost exactly the printed MRP.
- Stock shows as packs plus loose units, such as "9 strips + 5 tablets".
- A Product without a pack size behaves as it does today. Syrups, tubes and packets of sanitary pads need no change.
- A Product can be marked as having no expiry date. Its batches carry none.
- A pharmacy Charge has a real tenant-scoped key to its batch.

## Validation / Evidence

This is owner-funded work under the [pharmacy roadmap gate](../product.md#roadmap-gates). The evidence is the owner's statement, not a measured count.

- **Baseline:** one counted unit per Product. A loose tablet needs a second Product with separate stock.
- **Target outcome:** in the pilot month, no medicine exists as two Products for strip and tablet, and stock on hand per batch matches the physical count within the agreed tolerance.
- **Unproved:** the share of loose lines, and counter speed when staff type tablet counts. Count loose and whole-strip lines in one week of incumbent bills at the Stage 0 walkthrough. Time a three-item sale with one loose line.
- **Prior art:** the design restores D044 as committed in `075e22d`, which holds the schema, the exact line math and their tests. [Marg multi-unit billing](https://care.margcompusoft.com/margerp/inventory/2001/1/null) documents the same optional conversion per item. ERPNext and Odoo keep a conversion factor per item ([Pharmacy item master](../research/pharmacy-item-master.md)).
- **Migration constraint:** the pilot database starts empty, as the goods and services spec records. No backfill exists.

## User Stories / Scenarios

1. As a pharmacist, I sell four tablets from a strip of ten, so that the customer pays four tenths of the printed MRP.
2. As a pharmacist, I sell a full strip as ten tablets, so that the amount equals the printed MRP exactly.
3. As a pharmacist, I receive a delivery in strips with the rate and MRP per strip, so that the screen follows the supplier bill.
4. As a pharmacist, I see stock as strips plus loose tablets, so that the screen matches the shelf.
5. As a pharmacist, I take back three loose tablets against the invoice, so that the money and the stock move together. The tablets go to quarantine as any return does.
6. As an administrator, I post an opening count of 9 strips and 5 tablets for one batch, so that cutover starts from the physical count.
7. As an administrator, I add sanitary pads counted by the packet with no pack size, so that the form does not ask for a number I do not have.
8. As a supervising pharmacist, I receive a box of ten vials as an internal supply and issue three vials to a ward.
9. As an administrator, I add a BP apparatus for sale that has no expiry date, so that I do not type a false date.
10. As an accountant, I trace each pharmacy Charge to its batch through a key the database enforces.

## Implementation Decisions

### Units and prices

- `products.stockUnit` is the smallest unit the store counts. `products.unitsPerPack` is a whole number of 1 or more. A value of 1 means the Product has no pack conversion.
- `products.pack` stays as printed text, such as "170 ml". No code reads it as a number.
- A price is paise per N stock units, stored as printed. The pairs are batch `mrp` and `mrpUnits`, receipt-line `rate` and `packSize`, and Charge and Invoice-line `unitPrice` and `priceUnits`. OPD and treatment Charges keep `priceUnits = 1`.
- `computeInvoiceLines` restores the D044 math. Each exact line subtotal is `qty × unitPrice / priceUnits`. The document subtotal rounds once. Line subtotals take the floor plus the leftover paise by largest remainder, with ties in input order. Discount allocation, tax extraction and the rupee round-off do not change.
- Every quantity in the database and the API is a whole number of stock units. Only the web pages convert packs.
- `stockUnit` and `unitsPerPack` freeze when the Product has its first batch. A change after that returns `CONFLICT`. A medicine whose strip size changes becomes a new Product, and `pack` tells the two apart.
- One pack level exists. A box of ten strips is received as ten strips.

### Schema

All changes keep `orgId NOT NULL` and the composite tenant keys.

| Table                 | Change                                                                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `products`            | Add `unitsPerPack integer NOT NULL` with CHECK of 1 or more. Slice 3 adds `expires boolean NOT NULL`. Create supplies both explicitly.                                                   |
| `stock_batches`       | Add `mrpUnits integer NOT NULL` with CHECK above 0. `mrp` is paise per `mrpUnits` stock units. Slice 3 makes `expiryDate` nullable.                                                      |
| `goods_receipt_lines` | Add `packSize integer NOT NULL` with CHECK above 0. `rate` is paise per `packSize` stock units.                                                                                          |
| `charges`             | Add `priceUnits integer NOT NULL DEFAULT 1` with CHECK of 1 or more. Add nullable `stockBatchId` with a composite foreign key to `stock_batches` and a partial index on non-null values. |
| `invoice_lines`       | Add `priceUnits integer NOT NULL DEFAULT 1` with CHECK of 1 or more.                                                                                                                     |

The Charge CHECK becomes three rules for `sourceType = 'pharmacy_batch'`. `catalogItemId` is null exactly for that source type. `stockBatchId` is set exactly for that source type. That source type also requires a pharmacy-sale parent. A pharmacy Charge stores a null `sourceId`, so the batch has one owner column. Treatment plan Charges keep `sourceId`.

### Migrations

The two draft migrations `0010_product_pack` and `0011_bent_energizer`
were replaced by one generated migration, `0010_product_pack_and_goods`.
Slice 3 appended the next generated migration for `expires` and nullable
batch expiry. Neither generated file is hand-edited.

Production holds the schema of `0009`. The generated migration adds required Product columns without defaults, so it fails when a Product row exists. Before applying it, obtain read-only production counts proving no rows in `products`, `stock_batches` and `goods_receipt_lines`, and no pharmacy Charges. Nonempty production fails this no-backfill migration's prerequisite: stop the deployment, preserve retained data, and require an explicit data-preserving migration rather than a reset. Local demo-data counts do not satisfy that production gate.

### Existing API seams

No new procedure or router is added.

- `pharmacy.createProduct` and `updateProduct` take `unitsPerPack` as a whole number from 1 to `MAX_STOCK_QTY`. Slice 3 adds `expires`. Both freeze with `stockUnit` after the first batch.
- `pharmacy.receiveGoods` lines take `pricedPer: "pack" | "unit"` beside the present fields. `qty` and `freeQty` count stock units. `mrp` and `rate` are paise per priced unit as printed. The server reads the divisor from the locked Product: `unitsPerPack` for a pack, 1 for a unit. It stores the divisor as batch `mrpUnits` and receipt-line `packSize`. A priced line's billed `qty` must divide by the divisor, or the request fails with `BAD_REQUEST`. An opening line carries no cost, so its `qty` can include loose units.
- A receipt that names an existing batch compares MRP by cross-multiplication: `old.mrp × new.mrpUnits = new.mrp × old.mrpUnits`. A difference returns `CONFLICT`. The first arrival's representation stays.
- `pharmacy.sell` lines keep `{ batchId, qty }` with `qty` in stock units. The Charge snapshots `unitPrice = batch.mrp`, `priceUnits = batch.mrpUnits` and `stockBatchId`.
- `pharmacy.returnSale` keeps its input. `qty` counts stock units against the invoice line. Money stays pro rata from the line's stored totals, and the final unit takes the exact remainder. Goods go to quarantine.
- `pharmacy.adjustStock` does not change. An internal issue counts stock units.
- `searchStock`, `stockOnHand` and `listProducts` return `unitsPerPack`. The two stock reads also return `mrpUnits`. `getSale` joins the batch through `charges.stockBatchId`; returns read that keyed ID from the Charge.
- Every changed query keeps its `scope.orgId` predicate.

### Products without expiry (Slice 3)

- `products.expires` is explicit on create and freezes after the first batch.
- A receipt line requires `expiryDate` when the Product expires and refuses one when it does not. Both failures return `BAD_REQUEST`. A cross-table CHECK is not possible, so `receiveGoods` owns the rule.
- A batch without a date is never expired. The sale, the opening count and the expiring-soon filter skip the date test for it. `expiringWithinDays` excludes it.
- Batch order is `expiryDate` ascending with nulls last, then `id`. This order serves the batch lock in `lib/stock.ts`, the proposed batch at the counter, and the `stockOnHand` page. The `stockOnHand` cursor becomes `{ expiryDate: string | null, batchId }`.
- Equipment that the hospital uses is not stock. It stays out of Products.

### Web

- `ProductSheet` keeps its present fields and adds two. The labels follow `docs/design.md` "Say it once".
  - A switch reads **Comes in packs**. It starts on when Counted in is tablet or capsule, and off for every other unit.
  - With the switch on, a number field reads "Tablets in one pack", using the counted unit. It starts empty and takes a whole number of 2 or more. With the switch off, the form sends 1.
  - "Printed pack size" stays an optional text field. This is where "170 ml" goes.
  - Slice 3 adds a switch **Has an expiry date**, on by default.
- Medicine suggestions fill the printed pack text only. Staff type the number, because it freezes.
- Receive goods restores the pack or loose choice on each line when the Product has a pack. Count, free quantity, rate and MRP follow that choice. The page converts to stock units before it calls the API. Slice 3 hides the expiry field for a Product without expiry.
- The counter takes the quantity in the counted unit. The line shows the printed price as "₹80.00 / 10" and the exact amount. The batch picker shows shelf stock as packs plus loose units.
- The stock list and the movement ledger show quantities the same way. The printed Invoice and Credit Note show the unit price as "80.00 / 10".
- One display helper owns the format, because it has three call sites. The pack word is "strip" when the Product is counted in tablet or capsule, and "pack" otherwise.

| Stock units | `unitsPerPack` | Counted in | Shown as             |
| ----------- | -------------- | ---------- | -------------------- |
| 95          | 10             | tablet     | 9 strips + 5 tablets |
| 90          | 10             | tablet     | 9 strips             |
| 5           | 10             | tablet     | 5 tablets            |
| 23          | 10             | vial       | 2 packs + 3 vials    |
| 12          | 1              | bottle     | 12 bottles           |

### How each kind of goods fits

| Goods                       | Sold | Counted in   | `unitsPerPack` | Expires |
| --------------------------- | ---- | ------------ | -------------- | ------- |
| Tablets and capsules        | Yes  | Tablet       | Strip size     | Yes     |
| Syrup, drops, tube          | Yes  | Bottle, tube | 1              | Yes     |
| Sanitary pads               | Yes  | Piece        | 1              | Yes     |
| Injections for internal use | No   | Vial         | Box size       | Yes     |
| IV sets for internal use    | No   | Piece        | Box size       | Yes     |
| BP apparatus for sale       | Yes  | Piece        | 1              | No      |

A packet of sanitary pads is one piece. The printed pack text holds the pad count.

## Test Seams

Prior art is the committed tests at `075e22d` for the same files. Restore the cases that prove the restored behavior. Add a case only for behavior that nothing covers.

- **Unit, `tests/unit/invoice-math.test.ts`:** a line of 4 units at ₹85 per 15 allocates by largest remainder, and 15 units cost exactly ₹85. OPD math stays unchanged with `priceUnits = 1`.
- **Unit, `tests/unit/receipt-lines.test.ts`:** pack counts convert to stock units, and the cost compares to MRP without rounding.
- **Integration, `tests/integration/pharmacy-stock.test.ts`:** a receipt priced per pack stores `mrpUnits` and `packSize`. A billed quantity that does not divide by the pack is refused. An equivalent MRP in another representation is accepted, and a different one is refused. A change to `unitsPerPack` after a batch exists is refused. Slice 3 adds one case each for a Product without expiry accepted with no date and refused with one.
- **Integration, `tests/integration/pharmacy-sale.test.ts`:** a loose sale prices against the pack MRP and stores `stockBatchId` with a null `sourceId`. A loose return restores the exact money on the completing return and puts the units in quarantine. Journal assertions on account 4950 stay valid.
- **Integration, `tests/integration/tenancy.test.ts`:** the changed inputs keep organization isolation. A foreign batch id returns `NOT_FOUND`.
- **Regression:** `billing.test.ts`, `accounting.test.ts`, `opd.test.ts` and `treatment.test.ts` stay green.
- **Browser seam:** with the app running, add a tablet Product with a strip of 10, receive 5 strips, sell 4 tablets, print, return 3 tablets, and release them. Check the stock display after each step on desktop and mobile in light and dark. A passing build does not prove these interactions.

## Task Plan

- [x] **Slice 1: one tablet Product from receipt to loose return** (representative, riskiest path)
  - **Acceptance:** the schema has its final conversion shape and the Charge batch key. Through the existing RPCs, a Product with `unitsPerPack = 10` receives 5 strips priced per pack, sells 4 tablets at four tenths of the MRP, and takes 3 tablets back into quarantine. A sale of 10 tablets costs exactly the printed MRP. The Charge has `stockBatchId` set and `sourceId` null. A Product with `unitsPerPack = 1` behaves as before. One generated migration follows `0009`, and the two drafts are gone.
  - **Verify:** `bun run check-types`; `bunx oxlint`; `bunx oxfmt --check`; `bun run test`. One session owns the test run. The owner confirms the local database reset immediately before it runs.
  - **Depends on:** none. The goods and services change in the working tree is the base.
  - **Owns/Touches:** `packages/db/src/schema/{products,stock-batches,goods-receipt-lines,charges,invoice-lines}.ts`, `packages/db/src/migrations/`, `packages/api/src/lib/{invoice-math,billing-documents,stock}.ts`, `packages/api/src/core/receipt-math.ts`, `packages/api/src/routers/{pharmacy,pharmacy-stock,opd}.ts`, `apps/web/src/lib/opd-service-preview.ts`, `scripts/seed-volume.ts`, `tests/support/{billing,billing-pdf-fixture}.ts`, `tests/unit/{invoice-math,opd-service-preview}.test.ts`, `tests/integration/{pharmacy-stock,pharmacy-sale,tenancy}.test.ts`, `docs/decisions.md`, `docs/architecture.md`. One implementation owner holds all of them. Preserve the staged and unstaged split for every file this slice does not change.
  - **Interfaces:** produces `unitsPerPack` on Product inputs and reads; `pricedPer` on receipt lines; `mrpUnits` on stock reads; `priceUnits` on Charge and Invoice-line rows; `charges.stockBatchId`. Rewrites D049 in place and restores the D044 price text in `docs/decisions.md`.
- [x] **Slice 2: desk forms and stock display**
  - **Acceptance:** `ProductSheet` has the pack switch and number field with the defaults above, and it cannot save a tablet Product with the switch on and no number. Receive goods counts and prices a line in packs or loose units and shows the same totals as the server. The counter, the batch picker, the stock list and the movement ledger show packs plus loose units as the table above states. The printed documents show the price with its unit count.
  - **Verify:** `bun run check-types`; `bunx oxlint`; `bun run build`; the browser seam on desktop and mobile in light and dark. Exercise the Product form first, then apply the display to the other pages.
  - **Depends on:** Slice 1.
  - **Owns/Touches:** `apps/web/src/components/{product-sheet,product-picker,pharmacy-batch-picker,pharmacy-sale-lines,pharmacy-sale-desk,receipt-batch-lines,receipt-form}.ts(x)`, `apps/web/src/components/pdf/billing-documents.tsx`, `apps/web/src/lib/{receipt-lines,pharmacy-labels}.ts`, `apps/web/src/routes/$orgSlug/pharmacy/{items,receive,stock,movements}.tsx`, `tests/unit/receipt-lines.test.ts`, `docs/product.md`, `docs/specs/pharmacy-counter-sale-and-stock.md`.
  - **Interfaces:** consumes the Slice 1 fields. Produces `formatStockQty({ qty, unitsPerPack, stockUnit }): string` in `apps/web/src/lib/pharmacy-labels.ts`. Bigint arithmetic stays outside components, because the React Compiler drops bigint literals there.
- [x] **Slice 3: goods without an expiry date**
  - **Acceptance:** a Product saved with `expires = false` receives a batch with no date, appears at the counter after every dated batch, sells, and never appears in the expiring-soon list. A receipt line with a date for that Product is refused, and a line without a date for an expiring Product is refused. `stockOnHand` pages through dated and undated batches without a repeat or a gap.
  - **Verify:** `bun run check-types`; `bunx oxlint`; `bun run test`; receive and sell one BP apparatus in the running app.
  - **Depends on:** Slice 1 for the schema base. Slice 2 for the form.
  - **Owns/Touches:** `packages/db/src/schema/{products,stock-batches}.ts`, one new generated migration, `packages/api/src/lib/stock.ts`, `packages/api/src/routers/{pharmacy,pharmacy-stock}.ts`, `apps/web/src/components/{product-sheet,receipt-batch-lines,receipt-form,pharmacy-batch-picker}.ts(x)`, `apps/web/src/routes/$orgSlug/pharmacy/stock.tsx`, `tests/integration/{pharmacy-stock,pharmacy-sale}.test.ts`, `docs/specs/pharmacy-counter-sale-and-stock.md`.
  - **Interfaces:** produces `expires` on Product inputs and reads, and `expiryDate: string | null` on batch reads and the `stockOnHand` cursor.
- [x] **Slice 4: close the records**
  - **Acceptance:** the counter-sale spec describes the landed behavior in present tense. The goods and services spec no longer defers loose sale. The work registry row for this spec moves to Verification with the remaining browser and pilot evidence named.
  - **Verify:** `bunx oxfmt --check` on the changed Markdown files.
  - **Depends on:** Slices 1 to 3.
  - **Owns/Touches:** `docs/specs/{pharmacy-counter-sale-and-stock,pharmacy-goods-and-services,pharmacy-packs-and-loose-units}.md`, `docs/README.md`.
  - **Interfaces:** none.

## Out of Scope

- A merge of `products` and `catalog_items`, or a universal item table.
- More than one pack level, such as box to strip to tablet.
- Fractional units, such as a dose in millilitres from a bottle.
- A stored pack noun per Product. The display word comes from the counted unit.
- Goods on an OPD, inpatient or theatre bill. The inpatient spec owns that rule.
- An asset register for equipment that the hospital uses.
- Marg's price tiers, doctor commission, negative stock and preloaded item master.
- A change to return quarantine, invoice rounding, invoice streams or stock movement reasons.

## Explicitly Deferred

- **Quantity entry in strips at the counter.** Staff type the count in the smallest unit. Add a strip entry only if the pilot timing shows that whole-strip lines are slow.
- **A release action on the return screen.** The owner accepts quarantine as it is. Revisit only if the release step slows the counter in the pilot.
- **A pack size prefilled from medicine suggestions.** The number freezes after the first batch, so staff type it.
- **A changed pack size on an existing Product.** Staff create a new Product.
- **The measured loose-sale share.** The owner's statement governs until the Stage 0 count.

## Open Questions

No design question remains. Production access is unavailable in this verification
environment. The release operator must obtain read-only row-count evidence for
`products`, `stock_batches`, `goods_receipt_lines` and pharmacy Charges before
applying the no-backfill migration. Nonempty production fails this migration's
prerequisite; do not guess emptiness or reset retained data.

## Local browser evidence — 2026-10-04

Owner account, `mercy-general`, local dev `postgres` database; records use
`ZZ-Verify-Pharm`. SQL joins and movement reads were scoped to that Organization.
These are local functional checks, not production or pilot evidence.

| Step                                                             | UI shelf / quarantine            | SQL stock units shelf / quarantine |
| ---------------------------------------------------------------- | -------------------------------- | ---------------------------------- |
| Tablet Product: counted tablet, strip of 10, GST 12%, HSN 3004   | No batch yet                     | 0 / 0                              |
| Receive 5 strips, rate ₹50/strip, MRP ₹80/10, GST ₹30, bill ₹280 | 5 strips / 0 tablets             | 50 / 0                             |
| Sell 4 tablets, Invoice PH2026-27/1556, collect ₹32 cash         | 4 strips + 6 tablets / 0 tablets | 46 / 0                             |
| Return 3 tablets, Unwanted, refund ₹24 cash                      | 4 strips + 6 tablets / 3 tablets | 46 / 3                             |
| Supervisor releases 3 with inspection note                       | 4 strips + 9 tablets / 0 tablets | 49 / 0                             |
| BP apparatus Product: piece, no expiry, GST 18%, HSN 9018        | No batch yet                     | 0 / 0                              |
| Receive 3 BP apparatuses, rate ₹800, MRP ₹1,000, bill ₹2,832     | 3 pieces / 0 pieces; No expiry   | 3 / 0; expiry NULL                 |

The tablet batch `ZZPH-TAB-01` expires 2028-10-31; apparatus batch `ZZPH-BP-01`
has no date and its receipt had no expiry input. The Invoice PDF endpoint
returned 200/application-pdf: quantity 4, printed MRP **80.00 / 10**, taxable
₹28.57, GST ₹3.43, gross ₹32.00. The title was Tax Invoice while another
verification temporarily configured a GSTIN; that concurrent title change was
expected. The PDF prints the divisor, not the literal strip-description text.

Desktop 1365×768 and mobile 390×844, light/dark screenshots covered receipt,
four-tablet sale, three-tablet return, stock after receiving/selling and final
released-tablet/received-apparatus stock. Post-return stock was verified by DOM
and SQL when shared Chromium screenshot capture wedged. A compact-row defect
had hidden quarantine behind truncation; Stock now labels and wraps both
buckets on mobile. Final mobile light/dark screenshots show 49/0 and 3/0 without
horizontal overflow. Checked dark Product boxes also now retain their brand
fill and visible tick.

Before adding the timing medicine, LOCAL table counts were Products 45,
stock_batches 81, goods_receipt_lines 37 and pharmacy Charges 1,810, both
database-wide and scoped to this org. The local database is **not empty**.
Those counts are a point-in-time observation, not a production clearance.

The timing setup additionally created `ZZ-Verify-Pharm Dolo timing tab`
from a real Medbuzz suggestion, counted tablet/pack 15, and posted an opening
count of 3 strips (45 units), observed in Stock. The scripted three-item sale
attempt was interrupted by browser/SSR restarts and produced no reliable
completed wall-clock result. BP sale and final timing remain unverified; do not
infer their outcome from a partially executed browser script. One week of
incumbent loose-versus-strip bills is an external pilot prerequisite.
