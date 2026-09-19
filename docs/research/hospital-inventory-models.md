# Hospital inventory models

Read-only comparison of how open-source hospital and ERP systems model stock,
gathered 2026-09-18 for the pharmacy simplification review. Complements
[Pharmacy reference flows](./pharmacy-reference-flows.md), which covers the
sale and return path. Sources were read from `develop`/`master` where the docs
were thin; items marked "not verified" were not traced end to end.

## Lessons that transfer to HMS

1. Every system converges on three layers: item master, batch with expiry,
   append-only movement ledger. Nothing smaller works; nothing bigger is needed
   at pilot scale.
2. On hand is stored (Odoo, Danphe), derived (OpenMRS Stock Management), or
   derived with an event-refreshed cache (ERPNext `Bin`, OpenBoxes
   `product_availability`). Only one shape may be authoritative; the ledger is
   it everywhere.
3. One product table with flags (`is_sales_item`, `is_stock_item`,
   `is_fixed_asset`, `is_drug`) beats a table per kind. Marley's `Medication`
   is a clinical layer that links to ordinary `Item` rows; creams, dressings and
   gloves are plain Items with no Medication record.
4. Non-saleable supplies are the same item table with the sale flag off;
   consumption is an issue movement booked to an expense account and cost
   center (ERPNext Material Issue, Danphe `consumption-items`).
5. Capital items (beds, chairs) are out of stock in every system. ERPNext moves
   them to `Asset` and forbids a fixed asset from being a stock item; Danphe has
   an `IsFixedAssets` flag; Bahmni, OpenMRS and OpenBoxes have no home for them.
6. Ward or department consumption is a transfer or issue, never a sale. Marley
   ties each `Healthcare Service Unit` to a warehouse and posts Material
   Transfer to top up, Material Issue on administration. OpenMRS `stockissue`
   is two-phase with dispatch acknowledgement.
7. Opening stock and a later physical count are one document type in ERPNext
   (`Stock Reconciliation`, `purpose` field) and one operation type in OpenMRS
   (`stocktake`). No system has a separate opening-count table.
8. Quarantine is a location (ERPNext rejected warehouse, Odoo location), a
   reason code on the movement (OpenMRS), or a lot status (OpenBoxes, where
   only `RECALLED` blocks picking). A bucket column is the minimal location.
9. Validation lives in application code. Frappe emits no CHECK constraints and
   no foreign keys; Odoo 17/18 `stock.quant` has no SQL constraints; OpenMRS
   operation status is a plain `VARCHAR` guarded by a Java enum; Danphe throws
   from C# setters. Databases keep primary keys, NOT NULL and unique indexes.
10. FEFO is a sort at pick time (`ORDER BY expiry_date`), driven by one setting
    in ERPNext and Odoo and by `sortAvailableItems` in OpenBoxes. Two of the
    five systems have no FEFO at all.

## Marley / ERPNext

- Tables: `Item`, `Warehouse` (tree, `is_rejected_warehouse`), `Batch`,
  `Stock Ledger Entry` (signed `actual_qty`, running `qty_after_transaction`,
  `is_cancelled`), `Bin` (cached `actual_qty` with a unique index on item and
  warehouse, re-derived from the ledger on backdated or cancelled entries).
  Cancellation inserts reversing rows and flags the originals; nothing is
  deleted. Sources: [bin.json](https://github.com/frappe/erpnext/blob/develop/erpnext/stock/doctype/bin/bin.json),
  [stock_ledger.py](https://github.com/frappe/erpnext/blob/develop/erpnext/stock/stock_ledger.py).
- `Medication` (generic name, strength, dosage form, default dose) has a child
  table `Medication Linked Item` (brand, manufacturer, stock UOM, rate) and
  creates the `Item` on insert with `is_sales_item: 1, is_stock_item: 1`.
  Prescriptions link both the Item and the Medication. Source:
  [medication.json](https://github.com/earthians/marley/blob/develop/healthcare/healthcare/doctype/medication/medication.json).
- Item flags: `is_stock_item`, `is_sales_item`, `is_purchase_item`,
  `has_batch_no`, `has_expiry_date`, `is_fixed_asset` (must be a non-stock
  item, needs an asset category). Consumption is `Stock Entry` with
  `purpose = Material Issue`; each line carries `expense_account` and
  `cost_center`, falling back to the company stock adjustment account.
- `Healthcare Service Unit` links a `warehouse`. `Inpatient Medication Entry`
  posts Material Transfer for shortfalls and Material Issue for administered
  doses; cancelling the entry cancels its stock entries. The healthcare
  expense-account lookup on `develop` resolves to `None` and falls back to the
  item default (not verified as configured anywhere).
- Opening stock is `Stock Reconciliation` with `purpose = Opening Stock`;
  a physical count is the same doctype with `purpose = Stock Reconciliation`
  and a different difference account.
- FEFO: `Stock Settings.pick_serial_and_batch_based_on` (`FIFO | LIFO |
Expiry`), applied as a sort in `serial_and_batch_bundle.py`; expired batches
  are filtered out of the pick.
- Frappe's schema builder emits columns, indexes and unique constraints only;
  link integrity and every business rule are Python `validate()` hooks.

## Bahmni (OpenMRS + Odoo)

- OpenMRS holds the drug order; an atom feed creates Odoo `sale.order` rows.
  Odoo owns `product.template` (type `consu | service | storable`),
  `stock.lot` (expiry fields from `product_expiry`), `stock.quant` (stored on
  hand per product, location and lot, mutated under a row lock), and
  `stock.move.line`.
- No count document since Odoo 15: counting is `inventory_quantity` on the
  quant, applied as a move to the virtual inventory location. Scrap is a move
  to a scrap location; quarantine is a plain location.
- Internal transfer is a `stock.picking` of type `internal`; Bahmni validates
  batch quantity on it but has no internal-consumption document, so ward stock
  stays on hand at the ward. No asset or maintenance module is installed.
- Odoo 17/18 `stock.quant` has no SQL constraints; lot uniqueness moved from a
  SQL constraint to `@api.constrains`. FEFO is a removal strategy sorted by
  `removal_date`; Bahmni's own picker sorts by `expiration_date` in Python.
  Source: [bahmni-odoo-modules](https://github.com/Bahmni/bahmni-odoo-modules).

## OpenMRS Stock Management module

- Tables: `stockmgmt_stock_item` (nullable `drug_id` and `concept_id`,
  `is_drug`), `stock_batch`, `stock_item_transaction`, `stock_operation`
  (types `adjustment, disposed, transferout, initial, receipt, return,
stockissue, stocktake, requisition`), `party` (a location or a vendor).
  On hand is a live `SUM()` over transactions; there is no cache table.
  Source: [liquibase.xml](https://github.com/openmrs/openmrs-module-stockmanagement/blob/master/api/src/main/resources/liquibase.xml).
- Damaged or expired is a reason concept on the operation plus a Disposal
  type; no quarantine flag or location. Expiry is notify-only.
- `stockissue` posts negative at the source on submit and positive at the
  destination on completion with the received quantity. Batches carry no cost.
- Database: unique `(stock_item_id, batch_no, expiration)`, NOT NULLs.
  Status is `VARCHAR(50)` with no CHECK; negative stock and the workflow are
  Java validators. No FEFO; the client chooses the batch.

## OpenBoxes

- `transaction` + `transaction_entry` (qty, product, lot, bin, reason code)
  with codes `DEBIT | CREDIT | INVENTORY | PRODUCT_INVENTORY` and seeded types
  (Consumption, Adjustment, Expired, Damaged, Inventory, Transfer In/Out).
  `product_availability` is an upserted cache refreshed from a
  `Transaction.afterInsert` event; the job is explicitly never scheduled.
- A cycle count writes a `PRODUCT_INVENTORY` baseline and a separate
  variance Adjustment. Lot status (`APPROVED, RECALLED, ON_HOLD, QUARANTINED,
EXPIRED, DAMAGED`) exists, but only `RECALLED` blocks picking; hold bins are
  excluded from allocation.
- One `product` table with `productType` (good, service, fixed asset); no
  asset domain class. Ward issue is Requisition → Picklist → Shipment posting
  Transfer Out and Transfer In. Entries carry no unit cost; no ledger posting.
- Constraints are mostly GORM validators; real unique keys on
  `(product_id, lot_number)` and the availability upsert key. Negative stock
  is not blocked. FEFO is `sortAvailableItems` (expiry ascending, nulls last).
  Source: [openboxes](https://github.com/openboxes/openboxes).

## Danphe and HospitalRun

- Danphe runs two parallel item masters (pharmacy vs general inventory with
  `IsFixedAssets`) and a three-table core per module: stock master (item,
  batch, expiry, cost, sale price, MRP), store stock (stored available quantity
  with in-flight reservations), stock transaction (`InQty`/`OutQty`,
  `TransactionType` string, `ReferenceNo`). Write-off is a document with a
  remark. Rules live in C# setters. Source:
  [hospital-management-emr](https://github.com/opensource-emr/hospital-management-emr).
- HospitalRun is archived; v1 kept a denormalized total on the item, a batch
  with `expired` boolean, and an `inv-request` movement with `expenseAccount`
  and `markAsConsumed`. No expiry sort.

## Not verified

- The Marley outpatient sale to invoice stock path, and `Sample Collection`
  stock behaviour.
- OpenMRS `erequisition` type and the Bahmni `availableStocks` REST proxy.
- OpenBoxes transaction type 12 (`INVENTORY_BASELINE`) seed row.
