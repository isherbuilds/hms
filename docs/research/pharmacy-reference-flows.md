# Pharmacy reference flows

Read-only comparison of how three open-source hospital systems model a
pharmacy sale and its stock, gathered 2026-09-18 for
[Pharmacy counter sale and stock](../specs/pharmacy-counter-sale-and-stock.md).

## Bahmni (OpenMRS plus Odoo)

OpenMRS holds no stock in Bahmni. The drug order is an OpenMRS `DrugOrder`; an atom feed
maps encounters into a draft Odoo `sale.order` per patient, and Odoo owns
product, lot, quant, picking, invoice and payment. Confirming the sale creates
the stock picking, optionally validated and invoiced at once. Batch choice is
FEFO in `sale_order._find_batch()`: lots sorted by expiry with an insufficient
quantity check. Returns use a return picking plus credit note. Sources:
[openerp-atomfeed-service workers](https://github.com/Bahmni/openerp-atomfeed-service/tree/master/openerp-atomfeed-service/src/main/java/org/bahmni/feed/openerp/worker),
[bahmni-odoo-modules sale_order.py](https://raw.githubusercontent.com/Bahmni/bahmni-odoo-modules/master/bahmni_sale/models/sale_order.py).

## Danphe (own pharmacy schema)

`PHRM_ItemMaster`, `StockMaster` (one row per item, batch and expiry with
cost, sale price and MRP), `StoreStock` (a denormalized available quantity per
store and batch), and `StockTransaction` (a ledger with a transaction type and
exactly one of in or out quantity). A sale sends batch, expiry and stock id per
line; the server re-finds the store stock row, decrements it and writes a
`SaleItem` transaction in one database transaction. Returns are validated
against sold minus already returned, restore the original batch, and number a
credit note. Goods receipt is the only source of a new batch. Accounting is a
separate module fed by an `IsTransferedToAcc` flag, not posted with the
movement. Sources:
[PharmacyModels](https://github.com/opensource-emr/hospital-management-emr/tree/master/Code/Components/DanpheEMR.ServerModel/PharmacyModels),
[PharmacyBL.cs](https://raw.githubusercontent.com/opensource-emr/hospital-management-emr/master/Code/Websites/DanpheEMR/Controllers/Pharmacy/PharmacyBL.cs),
[PharmacySalesReturnController.cs](https://raw.githubusercontent.com/opensource-emr/hospital-management-emr/master/Code/Websites/DanpheEMR/Controllers/Pharmacy/PharmacySalesReturnController.cs).

## Marley / Frappe Health (ERPNext stock)

`Medication` links to ERPNext `Item` rows through `Medication Linked Item`;
`Medication Request` carries the prescribed and dispensable quantity and a
billing status. An outpatient sale is a `Sales Invoice` with `update_stock`,
whose submit hook raises the request's invoiced quantity and refuses billing
beyond the dispensable amount. Batch, expiry and FEFO are entirely ERPNext
Stock Settings; the Healthcare layer carries no batch logic. Returns are a
return invoice with negative quantity. Opening stock for batched items needs
pre-created Batch records plus a Material Receipt marked as opening. Sources:
[medication_request.json](https://github.com/earthians/marley/blob/develop/healthcare/healthcare/doctype/medication_request/medication_request.json),
[hooks.py](https://raw.githubusercontent.com/earthians/marley/develop/healthcare/hooks.py),
[ERPNext opening stock](https://docs.frappe.io/erpnext/user/manual/en/opening-stock).

## What the references share

Danphe and ERPNext own their stock code; Bahmni delegates to Odoo, whose
modules were read directly. Across those three stock engines:

- Three layers: item master, batch with expiry, and an append-only movement
  ledger behind every quantity.
- The batch is fixed on the sale line. Danphe and ERPNext decrement stock
  inside the sale's transaction; Bahmni's Odoo picking can be left unvalidated,
  which defers the movement.
- Expiry orders batch choice: FEFO by default, with Danphe letting staff pick.
- A return references the original sale line, is capped at sold minus
  returned, restores the same batch, and produces a credit note; the refund is
  a separate payment.
- Goods receipt is the ordinary source of a new batch and its prices. ERPNext
  opening stock is the exception: its Batch records are created first.
- The prescription is a separate document the sale references; the
  prescription itself never moves stock.

## Where they differ

- Bahmni's draft quotation per encounter with line rewriting on revision.
- Danphe's denormalized available-quantity table and its batch flag to
  accounting instead of in-transaction posting.
- ERPNext's Serial and Batch Bundle and inpatient issue by Stock Entry with
  quantity equal to the dose, without a sale.

## Adopted

The spec takes the shared shape. It differs in one place: stock on hand is the
sum of movements, not a maintained balance column, because the product
invariant says derived balances come from source transactions. Danphe's
balance table is the counter-example to revisit only if a measured counter
becomes slow.
