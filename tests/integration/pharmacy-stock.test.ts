import { beforeAll, expect, test } from "bun:test";

import { db } from "@hms/db";
import { goodsReceiptAdjustments } from "@hms/db/schema/goods-receipt-adjustments";
import { goodsReceiptLines } from "@hms/db/schema/goods-receipt-lines";
import { goodsReceipts } from "@hms/db/schema/goods-receipts";
import { stockBatches } from "@hms/db/schema/stock-batches";
import { and, asc, eq } from "drizzle-orm";

import { createOrganization, createTestUser } from "../support/auth";
import { clientFor, expectORPCCode } from "../support/client";
import { resetTestDatabase } from "../support/database";
import { UNPRICED } from "../support/pharmacy";

beforeAll(async () => {
  await resetTestDatabase();
});

const FAR_EXPIRY = "2031-12";

const RECEIVED_ON = "2026-09-01";

function productInput(orgSlug: string, name = "Paracetamol 500") {
  return {
    orgSlug,
    name,
    sold: true,
    taxRatePercent: "12",
    taxCode: "3004",
    active: true,
    genericName: "paracetamol",
    form: "tablet",
    strength: "500 mg",
    stockUnit: "tablet" as const,
    unitsPerPack: 10,
    expires: true,
    pack: "10 tablets",
    manufacturer: "Acme Pharma",
  };
}

test("a sold product requires an explicit GST rate, including zero", async () => {
  const owner = await createTestUser("pharmacy-explicit-gst-owner");
  const org = await createOrganization(owner, "pharmacy-explicit-gst");
  const api = clientFor(owner);
  const input = productInput(org.slug, "Zero-rated tablets");
  const { taxRatePercent: _omitted, ...withoutRate } = input;

  await expectORPCCode(api.pharmacy.createProduct(withoutRate), "BAD_REQUEST");
  const product = await api.pharmacy.createProduct({ ...input, taxRatePercent: "0" });
  expect((await api.pharmacy.listProducts({ orgSlug: org.slug })).items).toContainEqual(
    expect.objectContaining({ productId: product.productId, sold: true, taxRatePercent: "0.00" }),
  );
  await api.pharmacy.updateProduct({
    ...withoutRate,
    productId: product.productId,
    sold: false,
    taxCode: "ignored",
  });
  expect((await api.pharmacy.listProducts({ orgSlug: org.slug })).items[0]).toMatchObject({
    sold: false,
    taxRatePercent: "0.00",
    taxCode: null,
  });
  await expectORPCCode(
    api.pharmacy.updateProduct({ ...withoutRate, productId: product.productId }),
    "BAD_REQUEST",
  );
  await api.pharmacy.updateProduct({
    ...input,
    productId: product.productId,
    taxRatePercent: "0",
  });
});

test("a receipt creates a batch with shelf stock and refuses a conflicting arrival", async () => {
  const owner = await createTestUser("pharmacy-receive-owner");
  const org = await createOrganization(owner, "pharmacy-receive");
  const api = clientFor(owner);

  const product = await api.pharmacy.createProduct(productInput(org.slug));

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
        pricedPer: "unit",
        qty: 40,
        cost: UNPRICED,
      },
      // A second line on the same batch aggregates into one movement.
      {
        productId: product.productId,
        batchNumber: "B-100",
        expiryDate: FAR_EXPIRY,
        mrp: 12_00n,
        pricedPer: "unit",
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
  expect(search[0]?.unitsPerPack).toBe(10);
  expect(search[0]?.batches).toMatchObject([{ batchId, mrp: 12_00n, mrpUnits: 1, shelfQty: 50 }]);

  const { items: movements, nextCursor } = await api.pharmacy.listMovements({
    orgSlug: org.slug,
    batchId,
  });

  expect(nextCursor).toBeNull();
  expect(movements).toMatchObject([
    {
      productName: "Paracetamol 500",
      batchNumber: "B-100",
      stockUnit: "tablet",
      bucket: "shelf",
      qty: 50,
      reason: "receipt",
    },
  ]);

  // The same batch and unit MRP may be received again without changing its snapshot.
  const repeated = await api.pharmacy.receiveGoods({
    orgSlug: org.slug,
    supplierName: "Metro Distributors",
    receivedOn: RECEIVED_ON,
    billTotal: 0n,
    lines: [
      {
        productId: product.productId,
        batchNumber: "B-100",
        expiryDate: FAR_EXPIRY,
        pricedPer: "unit",
        mrp: 12_00n,
        qty: 10,
        cost: UNPRICED,
      },
    ],
  });

  expect(repeated.batches).toMatchObject([{ batchId }]);
  expect((await api.pharmacy.stockOnHand({ orgSlug: org.slug })).items).toMatchObject([
    { batchId, mrp: 12_00n, shelfQty: 60 },
  ]);

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
          pricedPer: "unit",
          qty: 5,
          cost: UNPRICED,
        },
      ],
    }),
    "CONFLICT",
    "a conflicting batch expiry",
  );

  expect(
    (await api.pharmacy.stockOnHand({ orgSlug: org.slug, includeZero: true })).items,
  ).toMatchObject([{ batchId, shelfQty: 60 }]);
});

test("a priced delivery stores exact pricing facts and shelves the free units", async () => {
  const owner = await createTestUser("pharmacy-priced-owner");
  const org = await createOrganization(owner, "pharmacy-priced");
  const api = clientFor(owner);
  const product = await api.pharmacy.createProduct(productInput(org.slug, "Priced Tablet"));

  // 10 tablets + 1 free at ₹76.19 a tablet, 5% trade discount, 5% GST.
  const line = {
    productId: product.productId,
    batchNumber: "P-1",
    expiryDate: FAR_EXPIRY,
    mrp: 76_19n,
    pricedPer: "unit" as const,
    qty: 10,
    cost: {
      freeQty: 1,
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
    qty: 10,
    freeQty: 1,
    rate: 76_19n,
    packSize: 1,
    discountPercent: "5.00",
    gstPercent: "5.00",
    hsnCode: "3004",
  });

  const { items: onHand } = await api.pharmacy.stockOnHand({ orgSlug: org.slug });
  expect(onHand).toMatchObject([
    { batchNumber: "P-1", mrp: 76_19n, mrpUnits: 1, unitsPerPack: 10, shelfQty: 11 },
  ]);
});

test("bill charges and discounts persist with a tenant receipt link, and a residual writes nothing", async () => {
  const owner = await createTestUser("pharmacy-adjusted-owner");
  const org = await createOrganization(owner, "pharmacy-adjusted");
  const other = await createOrganization(owner, "pharmacy-adjusted-other");
  const api = clientFor(owner);
  const product = await api.pharmacy.createProduct(productInput(org.slug, "Freighted Tablet"));

  const line = {
    productId: product.productId,
    batchNumber: "FREIGHT-1",
    expiryDate: FAR_EXPIRY,
    mrp: 5000_00n,
    pricedPer: "unit" as const,
    qty: 1,
    cost: { freeQty: 1, rate: 3725_00n, discountPercent: "0", gstPercent: "12" },
  };

  const freight = {
    kind: "landed_charge" as const,
    reason: "Freight",
    amount: 270_00n,
    gstAmount: 48_60n,
  };

  const refused = {
    orgSlug: org.slug,
    supplierName: "Zestica Pharma",
    receivedOn: RECEIVED_ON,
    billTotal: 4491_60n,
    adjustments: [freight],
    lines: [{ ...line, cost: { ...line.cost, freeQty: 0 } }],
  };

  await expectORPCCode(api.pharmacy.receiveGoods(refused), "BAD_REQUEST", "a 100-paise residual");
  expect(await db.select().from(goodsReceipts).where(eq(goodsReceipts.orgId, org.id))).toEqual([]);
  expect((await api.pharmacy.stockOnHand({ orgSlug: org.slug })).items).toEqual([]);

  const received = await api.pharmacy.receiveGoods({
    orgSlug: org.slug,
    supplierName: "Zestica Pharma",
    supplierReference: "ZP001564",
    receivedOn: RECEIVED_ON,
    billTotal: 4391_00n,
    adjustments: [
      freight,
      { kind: "invoice_discount", reason: "Cash discount", amount: 100_00n, gstAmount: 0n },
    ],
    lines: [line],
  });

  const [header] = await db
    .select()
    .from(goodsReceipts)
    .where(and(eq(goodsReceipts.orgId, org.id), eq(goodsReceipts.id, received.receiptId)));

  expect(header).toMatchObject({ billTotal: 4391_00n, opening: false });

  const adjustments = await db
    .select()
    .from(goodsReceiptAdjustments)
    .where(
      and(
        eq(goodsReceiptAdjustments.orgId, org.id),
        eq(goodsReceiptAdjustments.receiptId, received.receiptId),
      ),
    )
    .orderBy(asc(goodsReceiptAdjustments.id));

  expect(adjustments).toMatchObject([
    { orgId: org.id, receiptId: received.receiptId, kind: "landed_charge", amount: 270_00n },
    { orgId: org.id, receiptId: received.receiptId, kind: "invoice_discount", amount: 100_00n },
  ]);
  expect((await api.pharmacy.stockOnHand({ orgSlug: org.slug })).items).toMatchObject([
    { batchNumber: "FREIGHT-1", mrp: 5000_00n, mrpUnits: 1, shelfQty: 2 },
  ]);
  await expect(
    db
      .insert(goodsReceiptAdjustments)
      .values({
        id: Bun.randomUUIDv7(),
        orgId: other.id,
        receiptId: received.receiptId,
        kind: "landed_charge",
        reason: "Foreign receipt link",
        amount: 100n,
        gstAmount: 0n,
      })
      .execute(),
  ).rejects.toThrow();
});

test("pack-priced receipt stores its divisor, rejects loose billed counts and freezes the conversion", async () => {
  const owner = await createTestUser("pharmacy-pack-priced-owner");
  const org = await createOrganization(owner, "pharmacy-pack-priced");
  const api = clientFor(owner);
  const input = productInput(org.slug, "Pack-priced Tablet");
  const product = await api.pharmacy.createProduct(input);

  const line = {
    productId: product.productId,
    batchNumber: "PACK-1",
    expiryDate: FAR_EXPIRY,
    mrp: 85_00n,
    pricedPer: "pack" as const,
    qty: 50,
    cost: { ...UNPRICED, rate: 60_00n },
  };

  await expectORPCCode(
    api.pharmacy.receiveGoods({
      orgSlug: org.slug,
      supplierName: "Supplier",
      receivedOn: RECEIVED_ON,
      billTotal: 60_00n,
      lines: [{ ...line, qty: 11 }],
    }),
    "BAD_REQUEST",
  );

  const received = await api.pharmacy.receiveGoods({
    orgSlug: org.slug,
    supplierName: "Supplier",
    receivedOn: RECEIVED_ON,
    billTotal: 300_00n,
    lines: [line],
  });

  const [stored] = await db
    .select()
    .from(goodsReceiptLines)
    .where(eq(goodsReceiptLines.receiptId, received.receiptId));

  expect(stored).toMatchObject({ qty: 50, packSize: 10, rate: 60_00n });
  expect((await api.pharmacy.stockOnHand({ orgSlug: org.slug })).items[0]).toMatchObject({
    mrp: 85_00n,
    mrpUnits: 10,
    unitsPerPack: 10,
    shelfQty: 50,
  });
  await api.pharmacy.receiveGoods({
    orgSlug: org.slug,
    supplierName: "Supplier",
    receivedOn: RECEIVED_ON,
    billTotal: 0n,
    lines: [{ ...line, qty: 1, mrp: 8_50n, pricedPer: "unit", cost: UNPRICED }],
  });
  expect((await api.pharmacy.stockOnHand({ orgSlug: org.slug })).items[0]).toMatchObject({
    mrp: 85_00n,
    mrpUnits: 10,
    shelfQty: 51,
  });
  await expectORPCCode(
    api.pharmacy.receiveGoods({
      orgSlug: org.slug,
      supplierName: "Supplier",
      receivedOn: RECEIVED_ON,
      billTotal: 0n,
      lines: [{ ...line, qty: 1, mrp: 8_51n, pricedPer: "unit", cost: UNPRICED }],
    }),
    "CONFLICT",
  );
  await expectORPCCode(
    api.pharmacy.updateProduct({
      ...input,
      productId: product.productId,
      unitsPerPack: 15,
    }),
    "CONFLICT",
  );
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
        pricedPer: "unit",
        qty: 5,
        cost: UNPRICED,
      },
      {
        productId: scheduleX.productId,
        batchNumber: "SCHEDULE-X-1",
        expiryDate: FAR_EXPIRY,
        mrp: 20_00n,
        pricedPer: "unit",
        qty: 5,
        cost: UNPRICED,
      },
      {
        productId: sellable.productId,
        batchNumber: "SELLABLE-1",
        expiryDate: FAR_EXPIRY,
        mrp: 30_00n,
        pricedPer: "unit",
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
        pricedPer: "unit",
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

  const { items: movements } = await api.pharmacy.listMovements({ orgSlug: org.slug, batchId });
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
        pricedPer: "unit",
        qty: 6,
        cost: UNPRICED,
      },
    ],
  });

  const batchId = received.batches[0]?.batchId ?? "";

  await expectORPCCode(
    api.pharmacy.listMovements({ orgSlug: other.slug, batchId }),
    "NOT_FOUND",
    "a foreign batch's movements",
  );
  expect((await api.pharmacy.listMovements({ orgSlug: other.slug })).items).toEqual([]);

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
          pricedPer: "unit",
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

  expect((await api.pharmacy.stockOnHand({ orgSlug: other.slug })).items).toEqual([]);
  expect(await api.pharmacy.searchStock({ orgSlug: other.slug, query: "metformin" })).toEqual([]);
});

test("expiry exposure counts current batch buckets at MRP, while loss review excludes transfers and internal issues", async () => {
  const owner = await createTestUser("pharmacy-exposure-owner");
  const org = await createOrganization(owner, "pharmacy-exposure");
  const api = clientFor(owner);
  const { today } = await api.report.expiryExposure({ orgSlug: org.slug });

  const shift = (days: number) =>
    new Date(Date.parse(`${today}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

  const medicineInput = { ...productInput(org.slug, "Inactive pack stock"), unitsPerPack: 3 };
  const medicine = await api.pharmacy.createProduct(medicineInput);

  const internal = await api.pharmacy.createProduct({
    orgSlug: org.slug,
    name: "Internal expired supplies",
    sold: false,
    active: true,
    stockUnit: "piece",
    unitsPerPack: 1,
    expires: true,
    pack: "One piece",
  });

  const undated = await api.pharmacy.createProduct({
    ...productInput(org.slug, "No expiry stock"),
    expires: false,
  });

  const received = await api.pharmacy.receiveGoods({
    orgSlug: org.slug,
    supplierName: "Exposure supplier",
    receivedOn: today,
    billTotal: 0n,
    lines: [
      {
        productId: medicine.productId,
        batchNumber: "VALID-TODAY",
        expiryDate: FAR_EXPIRY,
        mrp: 100_01n,
        pricedPer: "pack",
        qty: 6,
        cost: UNPRICED,
      },
      {
        productId: internal.productId,
        batchNumber: "EXPIRED",
        expiryDate: FAR_EXPIRY,
        mrp: 50n,
        pricedPer: "unit",
        qty: 2,
        cost: UNPRICED,
      },
      {
        productId: medicine.productId,
        batchNumber: "DAY-60",
        expiryDate: FAR_EXPIRY,
        mrp: 100_01n,
        pricedPer: "pack",
        qty: 3,
        cost: UNPRICED,
      },
      {
        productId: undated.productId,
        batchNumber: "UNDATED",
        mrp: 10_00n,
        pricedPer: "unit",
        qty: 2,
        cost: UNPRICED,
      },
    ],
  });

  const batch = (number: string) => {
    const row = received.batches.find((candidate) => candidate.batchNumber === number);

    if (!row) throw new Error(`missing ${number} batch`);

    return row.batchId;
  };

  const currentId = batch("VALID-TODAY");
  // Public receipts cannot create expired stock; age the immutable fixture snapshot.
  await Promise.all([
    db
      .update(stockBatches)
      .set({ expiryDate: today })
      .where(and(eq(stockBatches.orgId, org.id), eq(stockBatches.id, currentId))),
    db
      .update(stockBatches)
      .set({ expiryDate: shift(-1) })
      .where(and(eq(stockBatches.orgId, org.id), eq(stockBatches.id, batch("EXPIRED")))),
    db
      .update(stockBatches)
      .set({ expiryDate: shift(60) })
      .where(and(eq(stockBatches.orgId, org.id), eq(stockBatches.id, batch("DAY-60")))),
  ]);
  await api.pharmacy.adjustStock({
    orgSlug: org.slug,
    batchId: currentId,
    reason: "quarantine",
    qty: 2,
    note: "Review hold",
  });
  await api.pharmacy.adjustStock({
    orgSlug: org.slug,
    batchId: currentId,
    reason: "release",
    qty: 1,
    note: "Released",
  });
  const ward = await api.staff.createDepartment({ orgSlug: org.slug, name: "Exposure ward" });
  await api.pharmacy.adjustStock({
    orgSlug: org.slug,
    batchId: currentId,
    reason: "internal_issue",
    qty: 1,
    departmentId: ward.id,
    note: "Ward supply",
  });
  await api.pharmacy.adjustStock({
    orgSlug: org.slug,
    batchId: currentId,
    reason: "writeoff",
    qty: 1,
    bucket: "shelf",
    note: "Damaged stock",
  });
  await api.pharmacy.updateProduct({
    ...medicineInput,
    productId: medicine.productId,
    active: false,
  });
  const exposure = await api.report.expiryExposure({ orgSlug: org.slug });
  expect(exposure.noExpiryBatchCount).toBe(1);
  const currentBuckets = exposure.rows.filter((row) => row.batchId === currentId);
  expect(currentBuckets).toHaveLength(2);
  expect(currentBuckets).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        bucket: "shelf",
        quantity: 3,
        exposure: 100_01n,
        status: "upcoming",
      }),
      expect.objectContaining({
        bucket: "quarantine",
        quantity: 1,
        exposure: 33_34n,
        status: "upcoming",
      }),
    ]),
  );
  expect(exposure.rows).toContainEqual(
    expect.objectContaining({
      batchId: batch("EXPIRED"),
      productId: internal.productId,
      quantity: 2,
      exposure: 100n,
      status: "expired",
    }),
  );
  expect(exposure.rows.some((row) => row.batchId === batch("UNDATED"))).toBe(false);
  expect(exposure.totals).toEqual({
    shelf: 101_01n,
    quarantine: 33_34n,
    expired: 100n,
    upcoming: 133_35n,
  });
  const longer = await api.report.expiryExposure({ orgSlug: org.slug, horizonDays: 90 });
  expect(longer.rows).toContainEqual(
    expect.objectContaining({
      batchId: batch("DAY-60"),
      exposure: 100_01n,
      status: "upcoming",
    }),
  );

  const signals = await api.report.revenueSignals({
    orgSlug: org.slug,
    from: today,
    to: today,
    kind: "stock_adjustment",
  });

  expect(signals.summary).toMatchObject({ count: 1, amount: -33_34n });
  expect(signals.rows[0]).toMatchObject({
    source: { type: "stock", id: currentId },
    quantity: -1,
    bucket: "shelf",
    actorName: owner.user.name,
    reason: "Damaged stock",
    amount: -33_34n,
  });
});
