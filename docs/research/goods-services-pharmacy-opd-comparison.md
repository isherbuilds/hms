# Goods, services, pharmacy and OPD in comparable systems

2026-09-29. Reference architecture research for the proposed [HMS goods and
services spec](../specs/pharmacy-goods-and-services.md). This compares documented
behavior. It does not change D027 or D049.

> **Historical comparison.** The HMS code and line references below describe
> the tree reviewed before the 2026-09-29 cutover. The current contracts are
> [goods and services](../specs/pharmacy-goods-and-services.md) and
> [packs and loose units](../specs/pharmacy-packs-and-loose-units.md).
> Products now own sale facts; stock supports packs and loose units. Do not
> use the former catalog link or no-loose-sale premise as current guidance.

## Question

How do Marg, Frappe/Marley and comparable hospital systems identify goods and
services, handle pharmacy stock, and price OPD work? What should HMS take from
those designs?

## Answer

**The shared pattern is a behavior boundary, not one database shape.** Services
carry a price and clinical context without physical stock. Pharmacy goods need
an explicit stock unit, batch and stock movement. Marg ERP documents one-item
strip-to-tablet conversion; ERPNext/Marley and GNU Health use a common billable
product identity with stock and service types; Bahmni maps clinical concepts
into Odoo products/services; OpenEMR documents separate fee codes and drug
inventory. None proves that HMS needs one universal item table. [Marg multi-unit
billing](https://care.margcompusoft.com/margerp/inventory/2001/1/null),
[ERPNext Item](https://docs.frappe.io/erpnext/item), [GNU Health
products](https://docs.gnuhealth.org/his/userguide/healthcenter/products.html),
[Bahmni Odoo 16 migration](https://bahmni.atlassian.net/wiki/spaces/BAH/pages/3293478913/),
[OpenEMR fee sheet](https://www.open-emr.org/wiki/index.php/OpenEMR_4.2.0_Fee_Sheet_Custom_Service_Categories),
[OpenEMR dispensary](https://www.open-emr.org/wiki/index.php/Pharmacy_Dispensary_Module).

**Inference for HMS:** the proposed split between Product and Service is still
the smaller way to remove the copied pharmacy catalog row. Keep the existing
Charge snapshot and OPD fee selection. Treat unit conversion, clinical
medication fields and future lab/radiology billing as separate workflow
decisions. This follows the current HMS link, pricing and OPD boundaries
(`packages/db/src/schema/products.ts:28-58`,
`packages/api/src/lib/opd-charges.ts:17-23,49-60,119-152`,
`packages/db/src/schema/charges.ts:27-80`, `docs/decisions.md:227-245,676-694`).

## Evidence

| System                              | Goods and pharmacy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | OPD and services                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | What the model tells HMS                                                                                                                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Marg ERP 9+**                     | A medicine Item can be bought by strip and sold by piece with a configured conversion; its example reports 9 strips and 5 pieces left. Purchases select an item, batch, quantity and rate. [Multi-unit guide](https://care.margcompusoft.com/margerp/inventory/2001/1/null), [purchase guide](https://care.margcompusoft.com/margerp/purchase/4260/1/create%20purchase%20bill)                                                                                                                                      | Its optional OPD module stores a consultation fee on Doctor Master and fills the appointment fee from that doctor. Treatment/Facility Master records named procedures and charges. [OPD flow](https://care.margcompusoft.com/margerp/opd-management/2596/1/null), [facility setup](https://care.margcompusoft.com/margerp/opd-management/44200/1/From-where-to-feed-which)                                                                                                                                           | A generic service price alone does not replace doctor-specific OPD pricing. Marg documents conversion as an option; it does not prove that this HMS pilot sells loose tablets. Its pages do not expose its table design.                        |
| **Marg Books, a different product** | One Item Master categorizes Goods or Service; service setup has SAC, tax and ledger choices. [Item guide](https://care.margcompusoft.com/margerp/inventory-master/170482/1/Item-Creation-in-Marg-Book), [service guide](https://care.margcompusoft.com/marg-books/inventory-master/183178/9/how-to-create-service-item-freight-packing-charges-in-marg-books)                                                                                                                                                       | The cited service page concerns Marg Books billing; it does not establish Marg ERP OPD item identity. [Service guide](https://care.margcompusoft.com/marg-books/inventory-master/183178/9/how-to-create-service-item-freight-packing-charges-in-marg-books)                                                                                                                                                                                                                                                          | Do not transfer Marg Books' single-master claim to Marg ERP's hospital module.                                                                                                                                                                  |
| **ERPNext + Marley Healthcare**     | ERPNext's Item represents a product or service; stock tracking distinguishes goods. Marley says its pharmacy uses ERPNext Stock, Buying and Accounts, with healthcare fields on Item. Marley Medication is a separate clinical master with linked branded Items. [ERPNext Item](https://docs.frappe.io/erpnext/item), [Marley pharmacy](https://marley.frappe.cloud/docs/v13/user/manual/en/healthcare/setup_pharmacy), [Medication v15](https://marley.frappe.cloud/docs/v15/user/manual/en/healthcare/medication) | Appointment Type or Practitioner selects a consultation item/rate. Clinical Procedure Template links a billable Item and can bill consumables separately. Encounter service and medication requests can be pulled into billing. [Appointment](https://marley.frappe.cloud/patient-appointment), [procedure v13](https://marley.frappe.cloud/docs/v13/user/manual/en/healthcare/clinical_procedure_template), [requests v15](https://marley.frappe.cloud/docs/v15/user/manual/en/healthcare/servicemedicationrequest) | A shared billing Item can coexist with clinical templates and medication identity. It supports removing HMS's hollow copied goods row, but does not justify dropping form or strength.                                                          |
| **Bahmni + Odoo 16**                | The integration maps drugs to Odoo stockable products, with lots, expiry, units and location stock. [Migration scope](https://bahmni.atlassian.net/wiki/spaces/BAH/pages/3293478913/), [inventory setup](https://bahmni.atlassian.net/wiki/plugins/viewsource/viewpagesrc.action?pageId=900530225)                                                                                                                                                                                                                  | Lab tests and procedures map to Odoo services; clinical orders map to quotations. [Migration scope](https://bahmni.atlassian.net/wiki/spaces/BAH/pages/3293478913/), [sales setup](https://bahmni.atlassian.net/wiki/spaces/BAH/pages/900464675/Odoo%2BSales%2BConfiguration/)                                                                                                                                                                                                                                       | Its OpenMRS-to-Odoo mapping is integration machinery, not a reason to add a second HMS master or sync path.                                                                                                                                     |
| **GNU Health**                      | Tryton Product types include goods and services; medicines use defined dispensing units. A separate Medicament record adds clinical meaning to the product. [Products](https://docs.gnuhealth.org/his/userguide/healthcenter/products.html)                                                                                                                                                                                                                                                                         | Patient Health Services can include both products and services; lab tests link to priced service products. [Products](https://docs.gnuhealth.org/his/userguide/healthcenter/products.html), [laboratory](https://docs.gnuhealth.org/his/userguide/modules/laboratory.html)                                                                                                                                                                                                                                           | One billable base does not remove clinical records or the need to map them. The online behavior pages are unversioned; the [release page](https://docs.gnuhealth.org/his/techguide/release.html) lists HIS 5.0 as stable on this research date. |
| **OpenEMR**                         | The documented dispensary uses drug and lot inventory records. [Dispensary](https://www.open-emr.org/wiki/index.php/Pharmacy_Dispensary_Module), [current drug dispense source](https://github.com/openemr/openemr/blob/master/interface/drugs/dispense_drug.php)                                                                                                                                                                                                                                                   | An encounter fee sheet uses service codes; its documented workflow differs from a shared stock Item master. [Fee sheet](https://www.open-emr.org/wiki/index.php/OpenEMR_4.2.0_Fee_Sheet_Custom_Service_Categories)                                                                                                                                                                                                                                                                                                   | A separate service and pharmacy design is possible. The detailed wiki pages are older or unversioned and do not prove the exact UI in [OpenEMR 8.4.1](https://www.open-emr.org/wiki/index.php/OpenEMR_Wiki_Home_Page).                          |

### HMS at the time of comparison

- D049 counts and prices one unit per Product and keeps `pack` as printed text;
  Marg's configurable conversion is a direct alternative, not a correction to
  an observed HMS transaction (`docs/decisions.md:676-694`;
  [Marg multi-unit guide](https://care.margcompusoft.com/margerp/inventory/2001/1/null)).
- HMS now links a sellable Product to a copied pharmacy `catalog_items` row.
  Product stores the stock identity; the catalog row stores GST, HSN and active;
  pharmacy Charge points to the catalog row and snapshots the money facts
  (`packages/db/src/schema/products.ts:28-58`,
  `packages/api/src/routers/pharmacy.ts:176-199,232-255`,
  `packages/db/src/schema/charges.ts:27-80`).
- HMS OPD chooses an active consultation or procedure Item from its catalog.
  The consultation fee can depend on practitioner, department and follow-up
  status; selected services can have a custom rate only when allowed
  (`packages/db/src/schema/catalog-items.ts:15-45`,
  `packages/api/src/lib/opd-charges.ts:28-60,71-86,119-152`).
- HMS keeps pharmacy Invoice and OPD Invoice streams separate and limits the
  OPD desk to consultation and procedures. Future Lab and Radiology need their
  own operational gate; a peer's generic invoice does not reopen D024/D025
  (`docs/decisions.md:227-264`).

## What this proves / does not prove

The cited systems demonstrate several valid item topologies. They support a
clear distinction between physical stock and non-stock services; they do not
rank the migration risk of changing HMS's `charges.catalogItemId`, prove pilot
staff use loose-tablet conversion, or establish that future clinical prescribing
can discard strength and dosage concepts. [ERPNext Item](https://docs.frappe.io/erpnext/item),
[GNU Health products](https://docs.gnuhealth.org/his/userguide/healthcenter/products.html),
[OpenEMR fee sheet](https://www.open-emr.org/wiki/index.php/OpenEMR_4.2.0_Fee_Sheet_Custom_Service_Categories),
[Marg multi-unit guide](https://care.margcompusoft.com/margerp/inventory/2001/1/null),
[Marley Medication v15](https://marley.frappe.cloud/docs/v15/user/manual/en/healthcare/medication).

The [goods and services spec](../specs/pharmacy-goods-and-services.md) says
Marley Medication “creates the stock Item itself.” The v15 Medication guide
documents linked branded Items, but does **not** establish automatic creation
by Medication. Marley procedure and observation templates document Item
creation; those are different records. Treat the Medication creation claim as
unsupported until source code proves it. [Medication v15](https://marley.frappe.cloud/docs/v15/user/manual/en/healthcare/medication),
[procedure template v13](https://marley.frappe.cloud/docs/v13/user/manual/en/healthcare/clinical_procedure_template),
[current procedure template schema](https://github.com/earthians/marley/blob/develop/healthcare/healthcare/doctype/clinical_procedure_template/clinical_procedure_template.json).

The sources mix ERPNext documentation, Marley v13 and v15 guides, a Marley
`develop` schema, Bahmni's Odoo 16 migration, and older OpenEMR wiki pages.
They prove only the named and dated paths. They do not prove current behavior
in every deployment or that any peer's counter workflow fits this pilot.

## What this means for us

1. **Keep the goods/services split as the preferred HMS direction, with a
   migration proof.** It removes the copied pharmacy row and its sync path
   while preserving a service price list and one Charge snapshot. Confirm
   every Charge consumer and populated-data migration before revising D027
   (`docs/specs/pharmacy-goods-and-services.md:96-157`,
   `packages/db/src/schema/charges.ts:27-80`). This is an HMS-specific
   inference; the peer systems do not dictate separate tables.
2. **Keep OPD pricing behavior.** Preserve the practitioner/department/follow-up
   fee ladder and the explicit OPD category gate. Marg and Marley also have
   contextual consultation prices, but their exact precedence is not HMS's
   contract (`packages/api/src/lib/opd-charges.ts:28-60,119-152`;
   [Marg OPD](https://care.margcompusoft.com/margerp/opd-management/2596/1/null),
   [Marley appointment](https://marley.frappe.cloud/patient-appointment)).
3. **Do not couple field cleanup to the catalog cutover.** HMS currently
   displays `form` and `strength` in Products, and Marley retains strength in
   clinical Medication. Audit stored rows, names and prescribing needs before
   dropping these fields or `ml`; require an explicit counted unit and GST
   when a good becomes sellable (`apps/web/src/routes/$orgSlug/pharmacy/items.tsx:131-135`,
   `packages/db/src/schema/products.ts:15-45`;
   [Marley Medication v15](https://marley.frappe.cloud/docs/v15/user/manual/en/healthcare/medication)).
4. **Test D049 at the pilot counter.** Review real supplier bills and one
   week's sale lines for whole strips, loose tablets, bottles and measured
   liquids. If one medicine is routinely sold in two units, reopen the full
   receipt, stock, batch-MRP, sale and invoice denominator contract. A `pack`
   string alone cannot be a safe conversion factor (`docs/decisions.md:676-694`;
   [Marg multi-unit guide](https://care.margcompusoft.com/margerp/inventory/2001/1/null)).

## Next falsification

At the Stage 0 pilot, watch one supplier receipt, a consultation with an added
OPD procedure, and a pharmacy sale with a loose-tablet request and return.
Collect the supplier bill and printed patient invoices. Count one week of
whole-pack versus loose-unit lines and inspect current Product rows for `ml`,
`form` and `strength`. Compare the recorded fee source and the goods quantity
to HMS's proposed fields. A repeatable loose-unit sale or a clinical use for
strength reopens only that part of the spec; a mismatch in OPD fee selection
reopens its pricing rule (`docs/specs/pharmacy-counter-sale-and-stock.md:75-106`,
`docs/specs/pharmacy-goods-and-services.md:96-157`,
`packages/api/src/lib/opd-charges.ts:119-152`). The next step is to revise the
spec with this pilot evidence, then implement the settled catalog migration.

## Sources

- [Marg ERP multi-unit billing](https://care.margcompusoft.com/margerp/inventory/2001/1/null), [purchase](https://care.margcompusoft.com/margerp/purchase/4260/1/create%20purchase%20bill), [OPD](https://care.margcompusoft.com/margerp/opd-management/2596/1/null), [Treatment/Facility](https://care.margcompusoft.com/margerp/opd-management/44200/1/From-where-to-feed-which); [Marg Books service item](https://care.margcompusoft.com/marg-books/inventory-master/183178/9/how-to-create-service-item-freight-packing-charges-in-marg-books).
- [ERPNext Item](https://docs.frappe.io/erpnext/item), [Sales Invoice](https://docs.frappe.io/erpnext/sales-invoice); [Marley pharmacy](https://marley.frappe.cloud/docs/v13/user/manual/en/healthcare/setup_pharmacy), [Medication v15](https://marley.frappe.cloud/docs/v15/user/manual/en/healthcare/medication), [Appointment](https://marley.frappe.cloud/patient-appointment), [Procedure v13](https://marley.frappe.cloud/docs/v13/user/manual/en/healthcare/clinical_procedure_template), [Requests v15](https://marley.frappe.cloud/docs/v15/user/manual/en/healthcare/servicemedicationrequest).
- [Bahmni Odoo 16 migration](https://bahmni.atlassian.net/wiki/spaces/BAH/pages/3293478913/), [inventory setup](https://bahmni.atlassian.net/wiki/plugins/viewsource/viewpagesrc.action?pageId=900530225); [GNU Health products](https://docs.gnuhealth.org/his/userguide/healthcenter/products.html), [laboratory](https://docs.gnuhealth.org/his/userguide/modules/laboratory.html); [OpenEMR fee sheet](https://www.open-emr.org/wiki/index.php/OpenEMR_4.2.0_Fee_Sheet_Custom_Service_Categories), [dispensary](https://www.open-emr.org/wiki/index.php/Pharmacy_Dispensary_Module).
