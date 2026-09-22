import { beforeAll, expect, test } from "bun:test";

import { db } from "@hms/db";
import { file } from "@hms/db/schema/file";
import { goodsReceiptLines } from "@hms/db/schema/goods-receipt-lines";
import { goodsReceipts } from "@hms/db/schema/goods-receipts";
import { eq } from "drizzle-orm";

import { createOrganization, createTestUser } from "../support/auth";
import { clientFor, expectORPCCode } from "../support/client";
import { resetTestDatabase } from "../support/database";
import { UNPRICED } from "../support/pharmacy";
import { uniqueSuffix } from "../support/unique";

beforeAll(async () => {
  await resetTestDatabase();
});

const FAR_EXPIRY = "2031-12";

const RECEIVED_ON = "2026-09-01";

function productInput(orgSlug: string, name = "Paracetamol 500") {
  return {
    orgSlug,
    name,
    catalog: {
      code: `MED-${uniqueSuffix()}`,
      taxRatePercent: "12",
      taxCode: "3004",
    },
    genericName: "paracetamol",
    form: "tablet",
    strength: "500 mg",
    stockUnit: "tablet" as const,
    unitsPerPack: 10,
    manufacturer: "Acme Pharma",
  };
}

async function countSheet(orgId: string, userId: string): Promise<string> {
  const id = `${orgId}/count-${uniqueSuffix()}.pdf`;

  await db.insert(file).values({
    id,
    orgId,
    userId,
    name: "count-sheet.pdf",
    mimeType: "application/pdf",
    size: 1024,
    status: "ready",
  });

  return id;
}

test("a receipt creates a batch with shelf stock and refuses a conflicting arrival", async () => {
  const owner = await createTestUser("pharmacy-receive-owner");
  const org = await createOrganization(owner, "pharmacy-receive");
  const api = clientFor(owner);

  const product = await api.pharmacy.createProduct(productInput(org.slug));
  expect(product.productId).toBeString();

  const listed = await api.pharmacy.listProducts({ orgSlug: org.slug, query: "paracet" });
  expect(listed.items.map((item) => item.productId)).toContain(product.productId);

  const received = await api.pharmacy.receiveGoods({
    orgSlug: org.slug,
    supplierName: "Metro Distributors",
    supplierReference: "INV-9001",
    receivedOn: RECEIVED_ON,
    billTotal: 0n,
    lines: [
      {
        productId: product.productId,
        batchNumber: "B-100",
        expiryDate: FAR_EXPIRY,
        mrp: 12_00n,
        qty: 40,
        cost: UNPRICED,
      },
      // A second line on the same batch aggregates into one movement.
      {
        productId: product.productId,
        batchNumber: "B-100",
        expiryDate: FAR_EXPIRY,
        mrp: 12_00n,
        qty: 10,
        cost: UNPRICED,
      },
    ],
  });

  expect(received.batches).toHaveLength(1);
  const batchId = received.batches[0]?.batchId ?? "";

  const { items: onHand } = await api.pharmacy.stockOnHand({ orgSlug: org.slug });
  expect(onHand).toMatchObject([
    { batchId, batchNumber: "B-100", expiryDate: "2031-12-31", shelfQty: 50, quarantineQty: 0 },
  ]);

  const search = await api.pharmacy.searchStock({ orgSlug: org.slug, query: "paracet" });
  expect(search).toHaveLength(1);
  expect(search[0]?.batches).toMatchObject([{ batchId, mrp: 12_00n, shelfQty: 50 }]);

  const movements = await api.pharmacy.listMovements({ orgSlug: org.slug, batchId });
  expect(movements).toHaveLength(1);
  expect(movements[0]).toMatchObject({ bucket: "shelf", qty: 50, reason: "receipt" });

  // Batches are immutable: the same number with another expiry is refused, never merged.
  await expectORPCCode(
    api.pharmacy.receiveGoods({
      orgSlug: org.slug,
      supplierName: "Metro Distributors",
      receivedOn: RECEIVED_ON,
      billTotal: 0n,
      lines: [
        {
          productId: product.productId,
          batchNumber: "B-100",
          expiryDate: "2032-01",
          mrp: 12_00n,
          qty: 5,
          cost: UNPRICED,
        },
      ],
    }),
    "CONFLICT",
    "a conflicting batch expiry",
  );
});

test("a priced delivery stores its bill arithmetic and shelves the free units", async () => {
  const owner = await createTestUser("pharmacy-priced-owner");
  const org = await createOrganization(owner, "pharmacy-priced");
  const api = clientFor(owner);
  const product = await api.pharmacy.createProduct(productInput(org.slug, "Priced Tablet"));

  // 10 strips + 1 free at ₹76.19 a strip, 5% trade discount, 5% GST.
  const line = {
    productId: product.productId,
    batchNumber: "P-1",
    expiryDate: FAR_EXPIRY,
    mrp: 10_00n,
    qty: 100,
    cost: {
      freeQty: 10,
      packSize: 10,
      rate: 76_19n,
      discountPercent: "5",
      gstPercent: "5",
      hsnCode: "3004",
    },
  };

  await expectORPCCode(
    api.pharmacy.receiveGoods({
      orgSlug: org.slug,
      supplierName: "Metro Distributors",
      receivedOn: RECEIVED_ON,
      billTotal: 770_00n,
      lines: [line],
    }),
    "BAD_REQUEST",
    "a bill total the lines do not reach",
  );

  const received = await api.pharmacy.receiveGoods({
    orgSlug: org.slug,
    supplierName: "Metro Distributors",
    receivedOn: RECEIVED_ON,
    billTotal: 760_00n,
    lines: [line],
  });

  const [stored] = await db
    .select()
    .from(goodsReceiptLines)
    .where(eq(goodsReceiptLines.receiptId, received.receiptId));

  expect(stored).toMatchObject({
    gross: 761_90n,
    discount: 38_10n,
    taxable: 723_80n,
    gst: 36_19n,
    net: 759_99n,
    unitCost: 6_91n,
  });

  const { items: onHand } = await api.pharmacy.stockOnHand({ orgSlug: org.slug });
  expect(onHand).toMatchObject([{ batchNumber: "P-1", shelfQty: 110 }]);
});

test("an opening receipt carries its count sheet and refuses a batch that already moved", async () => {
  const owner = await createTestUser("pharmacy-opening-owner");
  const org = await createOrganization(owner, "pharmacy-opening");
  const api = clientFor(owner);

  const product = await api.pharmacy.createProduct(productInput(org.slug, "Amoxicillin 250"));
  const fileId = await countSheet(org.id, owner.user.id);
  const countedOn = "2026-04-01";
  const pendingFileId = `${org.id}/pending-count-${uniqueSuffix()}.pdf`;

  await db.insert(file).values({
    id: pendingFileId,
    orgId: org.id,
    userId: owner.user.id,
    name: "pending-count-sheet.pdf",
    mimeType: "application/pdf",
    size: 1024,
  });

  await expectORPCCode(
    api.pharmacy.receiveGoods({
      orgSlug: org.slug,
      opening: true,
      receivedOn: countedOn,
      lines: [
        {
          productId: product.productId,
          batchNumber: "C-MISSING-SHEET",
          expiryDate: FAR_EXPIRY,
          mrp: 30_00n,
          qty: 1,
        },
      ],
    }),
    "BAD_REQUEST",
    "an opening receipt without its count sheet",
  );

  await expectORPCCode(
    api.pharmacy.receiveGoods({
      orgSlug: org.slug,
      opening: true,
      receivedOn: countedOn,
      fileId: pendingFileId,
      lines: [
        {
          productId: product.productId,
          batchNumber: "C-PENDING-SHEET",
          expiryDate: FAR_EXPIRY,
          mrp: 30_00n,
          qty: 1,
        },
      ],
    }),
    "NOT_FOUND",
    "an opening receipt with an unfinished count-sheet upload",
  );

  await expectORPCCode(
    api.pharmacy.receiveGoods({
      orgSlug: org.slug,
      opening: true,
      supplierName: "Not an opening supplier",
      receivedOn: countedOn,
      fileId,
      lines: [
        {
          productId: product.productId,
          batchNumber: "C-WITH-SUPPLIER",
          expiryDate: FAR_EXPIRY,
          mrp: 30_00n,
          qty: 1,
        },
      ],
    }),
    "BAD_REQUEST",
    "an opening receipt with supplier details",
  );

  const posted = await api.pharmacy.receiveGoods({
    orgSlug: org.slug,
    opening: true,
    receivedOn: countedOn,
    fileId,
    note: "cutover count",
    lines: [
      {
        productId: product.productId,
        batchNumber: "C-1",
        expiryDate: FAR_EXPIRY,
        mrp: 30_00n,
        qty: 12,
      },
    ],
  });

  const batchId = posted.batches[0]?.batchId ?? "";

  const [receipt] = await db
    .select()
    .from(goodsReceipts)
    .where(eq(goodsReceipts.id, posted.receiptId));

  expect(receipt).toMatchObject({
    opening: true,
    supplierName: null,
    fileId,
    receivedOn: countedOn,
    receivedBy: owner.user.id,
  });

  const movements = await api.pharmacy.listMovements({ orgSlug: org.slug, batchId });
  expect(movements).toMatchObject([{ reason: "opening", bucket: "shelf", qty: 12 }]);
  expect(movements[0]?.createdByName).toBe(owner.user.name);
  expect(movements[0]?.receipt).toMatchObject({
    opening: true,
    supplierName: null,
    receivedOn: countedOn,
    fileId,
  });

  await expectORPCCode(
    api.file.delete({ orgSlug: org.slug, key: fileId }),
    "CONFLICT",
    "deleting the retained count sheet",
  );

  await expectORPCCode(
    api.pharmacy.receiveGoods({
      orgSlug: org.slug,
      opening: true,
      receivedOn: countedOn,
      fileId,
      lines: [
        {
          productId: product.productId,
          batchNumber: "C-1",
          expiryDate: FAR_EXPIRY,
          mrp: 30_00n,
          qty: 5,
        },
      ],
    }),
    "CONFLICT",
    "an opening receipt on a moved batch",
  );
});

test("a receipt refuses two definitions of the same batch without writing either", async () => {
  const owner = await createTestUser("pharmacy-duplicate-batch-owner");
  const org = await createOrganization(owner, "pharmacy-duplicate-batch");
  const api = clientFor(owner);
  const product = await api.pharmacy.createProduct(productInput(org.slug, "Duplicate Batch"));

  await expectORPCCode(
    api.pharmacy.receiveGoods({
      orgSlug: org.slug,
      supplierName: "Metro Distributors",
      receivedOn: RECEIVED_ON,
      billTotal: 0n,
      lines: [
        {
          productId: product.productId,
          batchNumber: "DUP-1",
          expiryDate: FAR_EXPIRY,
          mrp: 10_00n,
          qty: 2,
          cost: UNPRICED,
        },
        {
          productId: product.productId,
          batchNumber: "DUP-1",
          expiryDate: FAR_EXPIRY,
          mrp: 11_00n,
          qty: 3,
          cost: UNPRICED,
        },
      ],
    }),
    "BAD_REQUEST",
    "one receipt with conflicting definitions of a batch",
  );

  expect(
    (
      await api.pharmacy.stockOnHand({
        orgSlug: org.slug,
        productId: product.productId,
        includeZero: true,
      })
    ).items,
  ).toEqual([]);
});

test("stock search returns only products with sellable shelf stock", async () => {
  const owner = await createTestUser("pharmacy-search-stock-owner");
  const org = await createOrganization(owner, "pharmacy-search-stock");
  const api = clientFor(owner);
  const expired = await api.pharmacy.createProduct(productInput(org.slug, "Stock Search Expired"));

  const scheduleX = await api.pharmacy.createProduct({
    ...productInput(org.slug, "Stock Search Schedule X"),
    schedule: "x",
  });

  const sellable = await api.pharmacy.createProduct(
    productInput(org.slug, "Stock Search Sellable"),
  );

  await api.pharmacy.receiveGoods({
    orgSlug: org.slug,
    supplierName: "Metro Distributors",
    receivedOn: RECEIVED_ON,
    billTotal: 0n,
    lines: [
      {
        productId: expired.productId,
        batchNumber: "EXPIRED-1",
        expiryDate: "2020-01",
        mrp: 10_00n,
        qty: 5,
        cost: UNPRICED,
      },
      {
        productId: scheduleX.productId,
        batchNumber: "SCHEDULE-X-1",
        expiryDate: FAR_EXPIRY,
        mrp: 20_00n,
        qty: 5,
        cost: UNPRICED,
      },
      {
        productId: sellable.productId,
        batchNumber: "SELLABLE-1",
        expiryDate: FAR_EXPIRY,
        mrp: 30_00n,
        qty: 5,
        cost: UNPRICED,
      },
    ],
  });

  expect(
    (await api.pharmacy.searchStock({ orgSlug: org.slug, query: "stock search" })).map(
      (product) => product.productId,
    ),
  ).toEqual([sellable.productId]);
});

test("an internal issue names its department and is refused without one", async () => {
  const owner = await createTestUser("pharmacy-issue-owner");
  const org = await createOrganization(owner, "pharmacy-issue");
  const api = clientFor(owner);

  // An internal supply has no catalog row, so it is stocked and issued but never sold.
  const gloves = await api.pharmacy.createProduct({
    orgSlug: org.slug,
    name: "Examination gloves",
    stockUnit: "piece",
    unitsPerPack: 100,
  });

  expect(gloves.catalogItemId).toBeNull();
  expect(await api.pharmacy.searchStock({ orgSlug: org.slug, query: "gloves" })).toEqual([]);

  const ward = await api.staff.createDepartment({ orgSlug: org.slug, name: "Ward A" });

  const received = await api.pharmacy.receiveGoods({
    orgSlug: org.slug,
    supplierName: "Metro Distributors",
    receivedOn: RECEIVED_ON,
    billTotal: 0n,
    lines: [
      {
        productId: gloves.productId,
        batchNumber: "G-1",
        expiryDate: FAR_EXPIRY,
        mrp: 0n,
        qty: 30,
        cost: UNPRICED,
      },
    ],
  });

  const batchId = received.batches[0]?.batchId ?? "";

  await api.pharmacy.adjustStock({
    orgSlug: org.slug,
    batchId,
    reason: "internal_issue",
    qty: 10,
    departmentId: ward.id,
    note: "ward indent",
  });

  const movements = await api.pharmacy.listMovements({ orgSlug: org.slug, batchId });
  expect(movements[0]).toMatchObject({
    reason: "internal_issue",
    qty: -10,
    departmentId: ward.id,
    departmentName: "Ward A",
  });

  await expectORPCCode(
    api.pharmacy.adjustStock({
      orgSlug: org.slug,
      batchId,
      reason: "internal_issue",
      qty: 5,
      note: "no department named",
    }),
    "BAD_REQUEST",
    "an internal issue without a department",
  );
});

test("quarantine and release move stock between buckets and a bucket cannot go below zero", async () => {
  const owner = await createTestUser("pharmacy-adjust-owner");
  const org = await createOrganization(owner, "pharmacy-adjust");
  const api = clientFor(owner);

  const product = await api.pharmacy.createProduct(productInput(org.slug, "Cetirizine 10"));

  const received = await api.pharmacy.receiveGoods({
    orgSlug: org.slug,
    supplierName: "Metro Distributors",
    receivedOn: RECEIVED_ON,
    billTotal: 0n,
    lines: [
      {
        productId: product.productId,
        batchNumber: "D-1",
        expiryDate: FAR_EXPIRY,
        mrp: 8_00n,
        qty: 20,
        cost: UNPRICED,
      },
    ],
  });

  const batchId = received.batches[0]?.batchId ?? "";

  await api.pharmacy.adjustStock({
    orgSlug: org.slug,
    batchId,
    reason: "quarantine",
    qty: 8,
    note: "supervisor hold",
  });

  expect(
    (await api.pharmacy.stockOnHand({ orgSlug: org.slug, quarantineOnly: true })).items,
  ).toMatchObject([{ batchId, shelfQty: 12, quarantineQty: 8 }]);

  await api.pharmacy.adjustStock({
    orgSlug: org.slug,
    batchId,
    reason: "release",
    qty: 5,
    note: "inspected and released",
  });

  expect((await api.pharmacy.stockOnHand({ orgSlug: org.slug })).items).toMatchObject([
    { batchId, shelfQty: 17, quarantineQty: 3 },
  ]);

  await expectORPCCode(
    api.pharmacy.adjustStock({
      orgSlug: org.slug,
      batchId,
      reason: "writeoff",
      qty: 4,
      bucket: "quarantine",
      note: "damaged strips",
    }),
    "CONFLICT",
    "a write-off below the quarantine bucket",
  );

  expect((await api.pharmacy.stockOnHand({ orgSlug: org.slug })).items).toMatchObject([
    { batchId, shelfQty: 17, quarantineQty: 3 },
  ]);

  const movements = await api.pharmacy.listMovements({ orgSlug: org.slug, batchId });
  // Newest first; the two rows of a release/quarantine pair share one timestamp and reason.
  expect(movements.map((movement) => movement.reason)).toEqual([
    "release",
    "release",
    "quarantine",
    "quarantine",
    "receipt",
  ]);
  expect(
    movements
      .filter((movement) => movement.reason === "release")
      .map((movement) => ({ bucket: movement.bucket, qty: movement.qty }))
      .sort((first, second) => first.bucket.localeCompare(second.bucket)),
  ).toEqual([
    { bucket: "quarantine", qty: -5 },
    { bucket: "shelf", qty: 5 },
  ]);
});

test("a product's stock unit is fixed once it has a batch and the catalog refuses a pharmacy item", async () => {
  const owner = await createTestUser("pharmacy-items-owner");
  const org = await createOrganization(owner, "pharmacy-items");
  const api = clientFor(owner);

  const input = productInput(org.slug, "Ibuprofen 400");
  const product = await api.pharmacy.createProduct(input);

  await api.pharmacy.receiveGoods({
    orgSlug: org.slug,
    supplierName: "Metro Distributors",
    receivedOn: RECEIVED_ON,
    billTotal: 0n,
    lines: [
      {
        productId: product.productId,
        batchNumber: "E-1",
        expiryDate: FAR_EXPIRY,
        mrp: 20_00n,
        qty: 4,
        cost: UNPRICED,
      },
    ],
  });

  await expectORPCCode(
    api.pharmacy.updateProduct({
      ...input,
      productId: product.productId,
      stockUnit: "strip",
    }),
    "CONFLICT",
    "a unit change after stock exists",
  );

  const renamed = await api.pharmacy.updateProduct({
    ...input,
    productId: product.productId,
    name: "Ibuprofen 400 mg",
  });

  expect(renamed.catalogItemId).toBe(product.catalogItemId);
  // The catalog row is the invoice snapshot source, so it carries the new name too.
  expect(
    (await api.pharmacy.listProducts({ orgSlug: org.slug, query: "ibuprofen" })).items[0],
  ).toMatchObject({ name: "Ibuprofen 400 mg", stockUnit: "tablet", schedule: "none" });
  expect(
    (await api.pharmacy.searchStock({ orgSlug: org.slug, query: "ibuprofen" }))[0],
  ).toMatchObject({ name: "Ibuprofen 400 mg" });

  await expectORPCCode(
    api.catalog.create({
      orgSlug: org.slug,
      name: "Hand-written medicine",
      code: `CAT-${uniqueSuffix()}`,
      category: "pharmacy",
      unitPrice: 0n,
      taxRatePercent: "12",
    }),
    "BAD_REQUEST",
    "a pharmacy catalog item",
  );
});

test("pharmacy stock ids from another organization are not found", async () => {
  const owner = await createTestUser("pharmacy-tenancy-owner");
  const home = await createOrganization(owner, "pharmacy-home");
  const other = await createOrganization(owner, "pharmacy-other");
  const api = clientFor(owner);

  const product = await api.pharmacy.createProduct(productInput(home.slug, "Metformin 500"));

  const received = await api.pharmacy.receiveGoods({
    orgSlug: home.slug,
    supplierName: "Metro Distributors",
    receivedOn: RECEIVED_ON,
    billTotal: 0n,
    lines: [
      {
        productId: product.productId,
        batchNumber: "F-1",
        expiryDate: FAR_EXPIRY,
        mrp: 9_00n,
        qty: 6,
        cost: UNPRICED,
      },
    ],
  });

  const batchId = received.batches[0]?.batchId ?? "";
  const fileId = await countSheet(home.id, owner.user.id);

  await expectORPCCode(
    api.pharmacy.listMovements({ orgSlug: other.slug, batchId }),
    "NOT_FOUND",
    "a foreign batch's movements",
  );

  await expectORPCCode(
    api.pharmacy.receiveGoods({
      orgSlug: other.slug,
      supplierName: "Metro Distributors",
      receivedOn: RECEIVED_ON,
      billTotal: 0n,
      lines: [
        {
          productId: product.productId,
          batchNumber: "F-1",
          expiryDate: FAR_EXPIRY,
          mrp: 9_00n,
          qty: 1,
          cost: UNPRICED,
        },
      ],
    }),
    "NOT_FOUND",
    "a foreign product on a receipt",
  );

  await expectORPCCode(
    api.pharmacy.adjustStock({
      orgSlug: other.slug,
      batchId,
      reason: "breakage",
      qty: 1,
      bucket: "shelf",
      note: "wrong organization",
    }),
    "NOT_FOUND",
    "a foreign batch adjustment",
  );

  const otherProduct = await api.pharmacy.createProduct(productInput(other.slug, "Metformin 500"));

  await expectORPCCode(
    api.pharmacy.receiveGoods({
      orgSlug: other.slug,
      opening: true,
      receivedOn: RECEIVED_ON,
      fileId,
      lines: [
        {
          productId: otherProduct.productId,
          batchNumber: "F-1",
          expiryDate: FAR_EXPIRY,
          mrp: 9_00n,
          qty: 1,
        },
      ],
    }),
    "NOT_FOUND",
    "a foreign count sheet",
  );

  expect((await api.pharmacy.stockOnHand({ orgSlug: other.slug })).items).toEqual([]);
  expect(await api.pharmacy.searchStock({ orgSlug: other.slug, query: "metformin" })).toEqual([]);
});
