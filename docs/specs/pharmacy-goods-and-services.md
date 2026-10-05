# Spec: Pharmacy goods and services

Lifecycle and remaining evidence: [work registry](../README.md#work-lifecycle).
Authority: owner delegation on 2026-09-28 to decide whether Pharmacy needs a linked Catalog row, refined by the 2026-09-29 peer comparison and the owner's decision to discard all MVP pilot data at cutover.
Supersedes: the pharmacy link in D027 and the “catalog holds HSN/GST” part of [Pharmacy counter sale and stock](./pharmacy-counter-sale-and-stock.md). [Pharmacy packs and loose units](./pharmacy-packs-and-loose-units.md) replaces D049's one-unit rule and supplies the batch key to pharmacy Charges.

## Problem

Before this cutover, a sellable medicine appeared in Products and again in Settings → Catalog. Product held its stock identity; the copied `catalog_items` row held its GST, HSN and active state. Product writes synchronized both rows and counter reads joined them. Services now excludes medicines.

Products and Receive goods formerly used two product forms with different fields and labels. Keeping `form` and `strength` preserves visible distinctions. Stored `ml` product use remains a pilot question ([peer comparison](../research/goods-services-pharmacy-opd-comparison.md)).

## Solution

- **Goods** remain `products`. Each Product owns stock identity and its own sale facts: `sold`, GST rate, HSN code and `active`. Batches keep the MRP per `mrpUnits` counted stock units. An internal supply has `sold = false` and never appears at the counter.
- **Services** remain `catalog_items`: consultation, procedure, lab, radiology and other. Settings and navigation call the screen **Services**. These rows have no stock. The existing `/$orgSlug/settings/catalog` URL and `catalog` permission and router names stay.
- **Charge** remains the single money snapshot. OPD and treatment Charges retain a service `catalogItemId`. A pharmacy Charge retains `sourceType = pharmacy_batch`, sets `stockBatchId` through a tenant-scoped foreign key, and stores null `sourceId` and `catalogItemId`. Its description, quantity, price per `priceUnits`, tax and revenue category snapshots remain intact.
- Products and Receive goods use one product form. The counted unit, printed `pack`, optional `form` and `strength`, and suggestion behavior remain available. The current stock-unit choices remain; new Products require an explicit counted-unit choice so an accidental default cannot be frozen by the first batch.

This changes item ownership, not OPD fee selection, the pharmacy sale/return flow, invoice streams, or money calculation.

## Validation / Evidence

This is owner-funded work under the [pharmacy roadmap gate](../product.md#roadmap-gates), not a validated claim that the pilot counter follows any peer. The [comparison](../research/goods-services-pharmacy-opd-comparison.md) found that ERPNext/Marley, Bahmni/Odoo and GNU Health distinguish stock goods from services, while OpenEMR documents a separate pharmacy and fee-code design. Marg ERP documents optional strip-to-tablet conversion, now implemented in [Pharmacy packs and loose units](./pharmacy-packs-and-loose-units.md). The Marley Medication guide documents linked Items, not automatic stock-Item creation by Medication; the earlier claim in this spec was unsupported. [ERPNext Item](https://docs.frappe.io/erpnext/item), [Marley Medication v15](https://marley.frappe.cloud/docs/v15/user/manual/en/healthcare/medication).

The former baseline was one copied pharmacy catalog row per sellable Product, a zero catalog price, a name synchronization path, catalog guards, and a join for sale facts. The implemented model has zero pharmacy-category catalog rows and one authoritative Product row for each good. The owner accepts a fresh pilot database: existing pilot records will be discarded and set up again. No historical data backfill is required; production migration is manual on the owner's instruction. This is a cutover condition, not a claim of user adoption.

## User Stories / Scenarios

1. As a pharmacist, I add or edit a sellable medicine in Products or while receiving goods, so its stock and sale facts have one owner.
2. As a pharmacist, I receive and issue an internal supply without offering it at the counter.
3. As a pharmacist, I deactivate or stop selling a Product, so new counter sales cannot select it while already issued documents in the new pilot remain intact.
4. As an administrator, I manage consultation and procedure prices in Settings → Services without seeing copied medicines.
5. As a cashier, I sell and return a batch and get the same Invoice, Receipt, Credit Note, tax and ledger outcome as before.
6. As a receptionist, I book an OPD visit with the same practitioner/department/follow-up consultation choice and selected procedure prices.
7. As an accountant, I can trace each new OPD or treatment Charge to its service and each new pharmacy Charge to its batch, with their money snapshots intact.

## Implementation Decisions

### Schema and migration

- Final `products` columns include `sold boolean NOT NULL`, `tax_rate_percent numeric(4,2) NOT NULL` (0–99.99, stored as 0 for an internal Product), nullable `tax_code text`, `active boolean NOT NULL DEFAULT true`, `units_per_pack integer NOT NULL` and `expires boolean NOT NULL`. A sold Product requires an explicit GST rate, including 0 when exempt; an internal Product clears HSN and stores tax rate 0. Creation supplies `sold`, `active` and `expires` explicitly. Keep `form`, `strength`, `STOCK_UNITS` (including `ml`), `stock_unit` and printed `pack`. Remove `products.catalog_item_id`, its tenant FK and partial unique index.
- `charges.catalog_item_id` is nullable. A database CHECK makes it null exactly when `source_type = 'pharmacy_batch'`, requires `stock_batch_id` and a pharmacy-sale parent for that source type, and keeps `source_id` null for pharmacy Charges. The composite tenant FK enforces non-null service IDs and batch IDs; Charge snapshots and revenue posting remain.
- Split the TypeScript categories into `SERVICE_CATEGORIES` (consultation, procedure, lab, radiology, other) for `catalog_items.category` and `REVENUE_CATEGORIES` (those five plus pharmacy) for Charge, Invoice line, treatment-plan revenue category and `revenueAccountFor`. The OPD billable subset stays consultation/procedure. A database CHECK excludes pharmacy from `catalog_items`; service writes reject it.
- Per the owner's 2026-09-29 instruction, the proposed additive/data/final sequence and rehearsal were replaced by one generated schema migration after D049, with no data backfill or migration rehearsal. Production will be migrated manually; the pilot had no retained production data. Never hand-edit the generated migration (D022).

### Existing API seams

The interface stays at the existing oRPC procedures and Charge snapshot. No new public seam or framework is introduced.

- `pharmacy.createProduct` and `updateProduct` replace nested `catalog` with flat `sold: boolean`, `taxRatePercent?`, `taxCode?` and `active` beside the Product fields, including `unitsPerPack` and required `expires`. A sold Product requires explicit valid GST, including `0` when exempt; an internal Product writes rate `0` and null HSN. Turning `sold` off clears HSN; turning it back on requires a supplied rate. `stockUnit`, `unitsPerPack` and `expires` freeze after the first batch. The result is `{ productId }`; no `catalogItemId`.
- `listProducts` exposes `sold`, `active`, tax and the retained descriptive fields from Product. `searchStock` and `stockOnHand` read Product sale facts; counter search and `pharmacy.sell` require `sold AND active`. The sale inserts a pharmacy Charge with null `catalogItemId` and `sourceId`, and a keyed `stockBatchId`, printed batch MRP per `priceUnits`, tax and revenue snapshot. Product, batch and Charge queries retain `scope.orgId` predicates.
- `catalog.create`, `update`, `setActive` and `list` accept service categories only and lose their pharmacy-specific guards. `catalog.searchServices` and OPD pricing still admit only the existing OPD billable subset. Practitioner, department and follow-up fee precedence, custom-rate guard, and treatment-plan behavior do not change (`packages/api/src/lib/opd-charges.ts:28-60,119-152`).

### Web and documentation

- Use one `ProductSheet` from Products and the inline “New product” path on Receive goods. Its `onSaved` callback is optional: Receive goods fills the active receipt line, while the shared mutation cache refreshes the Products list (D036). The receipt-line contract carries null sale tax and HSN for internal Products; purchase GST still distinguishes unset from an explicit zero. The form keeps name suggestions, generic name, manufacturer, form, strength, counted unit, printed pack, prescription schedule, sold flag, GST/HSN when sold, and active on edit. It follows the existing compact `FormSheet` layout.
- Do not silently set a sold Product's GST to 0. The form requires staff to enter a rate when a Product becomes sellable. Keep the current unit choices. On create, Counted in starts unselected and must be chosen before save; on edit, it shows the stored unit. `stockUnit`, `unitsPerPack` and `expires` freeze after the first batch, so a guessed default is costly to correct. Staff type the pack conversion, not a suggestion.
- Settings retains `/$orgSlug/settings/catalog` but its page and navigation read **Services**. Remove pharmacy rows, disabled toggles, zero prices and “Pharmacy → Items” copy. Show printed `pack` with the product where staff select a batch or review a sale line; same-name products with different packs must be distinguishable.
- Preserve the existing medicine suggestion mapping and “replace only suggestion-owned values” behavior. Do not rename `MedicineSuggestion.packSizeLabel` or remove source fields in this change.
- D027 in `docs/decisions.md` and the Product and Architecture owners describe the goods/services split; D049's one-unit rule is superseded by [Pharmacy packs and loose units](./pharmacy-packs-and-loose-units.md).

## Test Seams

- **Migration:** one generated migration after D049, no backfill and no rehearsal; production migration is manual per the owner.
- **Existing oRPC integration tests:** `pharmacy-stock.test.ts` proves create/update, explicit sold GST, internal and inactive behavior and unit freeze. `pharmacy-sale.test.ts` proves sale, return, snapshots and round-off journal account 4950 on Invoice and final Credit Note. `opd.test.ts` and `treatment.test.ts` prove service selection, fee precedence and Charge links still work. `catalog-staff.test.ts` proves Services no longer admits pharmacy. `tenancy.test.ts` proves the changed procedure inputs keep organization isolation. Add only a case that existing coverage does not prove.
- **Browser seam:** with the app running, use Products and Receive goods to create the same kind of Product, then select its batch at the counter; inspect Settings → Services and an OPD quote on desktop/mobile in light/dark. Check the sold/internal switch, explicit GST, same-name pack distinction and return to the receipt line. A passing build alone does not prove those interactions.

## Task Plan

- [x] **Slice 1: prove goods sale identity on fresh data** (representative, riskiest path)
  - **Acceptance:** Product sale fields and the pharmacy Charge link have their final shape. One sold Product can be received, sold and returned through the existing RPCs; its Charge has null catalog ID and the expected snapshots and revenue. OPD consultation and treatment Charges retain service IDs. No pharmacy catalog row is created. The account 4950 Invoice and final Credit Note journal assertions remain valid.
  - **Verify:** Generate one schema migration after D049 without backfill; focused integration tests and project checks cover Product, service and Charge contracts. Production migration is manual; no rehearsal is planned.
  - **Depends on:** D049 migration in the registered chain.
  - **Owns/Touches:** `packages/db/src/schema/{products,charges,catalog-items,invoice-lines,treatment-plan-items}.ts`, `packages/db/src/migrations/`, `packages/api/src/routers/{pharmacy,pharmacy-stock,catalog}.ts`, `packages/api/src/lib/ledger.ts`, `apps/web/src/routes/$orgSlug/pharmacy/items.tsx`, `apps/web/src/components/{pharmacy-new-product-sheet,product-picker,catalog-item-dialog}.tsx`, `apps/web/src/routes/$orgSlug/pharmacy/stock.tsx`, `apps/web/src/routes/$orgSlug/settings/catalog.tsx`, `tests/integration/{pharmacy-stock,pharmacy-sale,opd,treatment,catalog-staff,tenancy}.test.ts`. These overlapping files have one implementation owner.
  - **Interfaces:** Product fields and flat `createProduct/updateProduct` input above; `createProduct/updateProduct -> { productId }`; product list row with `sold` instead of `catalogItemId`; `SERVICE_CATEGORIES` and `REVENUE_CATEGORIES`; pharmacy Charge with null service link, null `sourceId` and keyed `stockBatchId`. These contracts are consumed by Slice 2.
- [x] **Slice 2: one desk form and a Services screen**
  - **Acceptance:** Products and Receive goods use the same product form; inline creation returns to the selected receipt line with the created Product. An internal Product can be received and issued but cannot be sold; deactivated or newly unsold goods disappear from new counter search while earlier sale/return documents in the new pilot still work. Settings → Services contains only services. The counter picker and selected sale line show printed pack where names alone collide. `form`, `strength` and `ml` remain usable, and a new Product cannot save without a counted-unit choice. OPD quote and selected procedure pricing remain unchanged.
  - **Verify:** Project checks cover the final code. Owner browser verification remains pending: Products, Receive goods, counter sale/return, Services and OPD quote on desktop/mobile in light/dark, including keyboard selection, missing counted unit and invalid GST.
  - **Depends on:** Slice 1's Product/RPC/Charge contracts.
  - **Owns/Touches:** `apps/web/src/components/{pharmacy-new-product-sheet,product-picker,pharmacy-batch-picker,pharmacy-sale-lines,catalog-item-dialog}.tsx`, `apps/web/src/routes/$orgSlug/pharmacy/{items,receive,stock}.tsx`, `apps/web/src/routes/$orgSlug/settings/catalog.tsx`, `apps/web/src/lib/navigation.ts`, `tests/integration/{pharmacy-stock,pharmacy-sale}.test.ts`, `docs/{decisions,product,architecture}.md`, `docs/specs/pharmacy-counter-sale-and-stock.md`. Shared Slice 1 files stay with the same owner.
  - **Interfaces:** `ProductSheet({ orgSlug, product?, onClose, onSaved? })` returns the existing `PickedProduct` when the caller needs it; `catalog.list/create/update/setActive` remain on the singleton `orpc` client and accept only service categories. No second product form or new router is added.

## Out of Scope

- A universal Item table, a second billing path, a new OPD service flow, or renaming the retained `catalog_items` table/router/permission/URL.
- This goods/services split did not alter invoice rounding, pharmacy return quarantine, OPD fee precedence, invoice stream boundaries or stock movement reasons. Pack and receipt conversion is owned by [Pharmacy packs and loose units](./pharmacy-packs-and-loose-units.md).
- Marg's price tiers, negative stock, doctor commission, delivery, shortcut/color flags or preloaded master.

## Explicitly Deferred

- **Field and unit cleanup:** Audit stored names, `form`, `strength` and `ml` rows and the clinician's prescribing need before dropping fields or choosing a strip default. Keep the current columns, enum and input choices for this spec.
- **Later pharmacy operations:** supplier master/returns, shortage and replenishment, H1 print, dosage instructions and repeat prescriptions remain in the counter-sale roadmap. A clinical Medication layer, if earned, is distinct from the stock SKU ([Marley Medication v15](https://marley.frappe.cloud/docs/v15/user/manual/en/healthcare/medication)).
- **Lab/radiology direct service billing:** remains behind its product and care-owner gate; the Services list may hold future categories without making them billable at the OPD desk (D024).

## Open Questions

None block this spec. Pilot loose-unit share and clinical field use still need measurement; they do not authorize field deletion or a new unit default.

## Local browser evidence — 2026-10-04

Products, Receive goods, counter sale and return were exercised as owner in
`mercy-general`, desktop 1365×768/mobile 390×844, light/dark. New Product refused
an omitted counted unit and GST 100; explicit tablet × 10/GST 12 and piece/no
expiry/GST 18 saved. Printed pack distinguished the tablet in receiving and
counter selection. Five received strips became 50 units; sale/return/release
matched scoped SQL. The PDF preserved printed MRP per 10 and inclusive GST.
[The packs evidence](./pharmacy-packs-and-loose-units.md#local-browser-evidence--2026-10-04)
owns the exact stock/money observations and remaining BP-sale/timing gaps.

Inline New product returned a created `ZZ-Verify-Pharm Dolo timing tab` to its
receipt line with pack 15 and printed suggestion text. Signed-in browser search
for Paracetamol called Medbuzz directly (OPTIONS 204, POST 200); ArrowDown/Enter
picked Dolo 650 Tablet 15 and populated Micro Labs Ltd, tablet, 650 MG and
printed pack 15 units, leaving Counted in unselected for an explicit choice.
Truemeds fallback was not invoked because Medbuzz succeeded.

Fixed the shared checked-box dark fill and Stock's mobile truncation of
quarantine; final stock screenshots and computed checked-box styles reverified
the fixes. Services and OPD quote desktop/mobile light/dark remain unverified:
repeated shared dev SSR failures and browser restarts interrupted this pass.
No production emptiness, migration clearance or fresh physical count is claimed.
