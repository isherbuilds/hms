import { db } from "@hms/db";
import type { DbTransaction } from "@hms/db/counter";
import { user } from "@hms/db/schema/auth";
import { departments } from "@hms/db/schema/departments";
import { goodsReceiptAdjustments } from "@hms/db/schema/goods-receipt-adjustments";
import { goodsReceiptLines } from "@hms/db/schema/goods-receipt-lines";
import { goodsReceipts } from "@hms/db/schema/goods-receipts";
import { PRODUCT_SCHEDULES, STOCK_UNITS, products } from "@hms/db/schema/products";
import { stockBatches } from "@hms/db/schema/stock-batches";
import { STOCK_BUCKETS, type StockBucket, stockMovements } from "@hms/db/schema/stock-movements";
import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, exists, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { formatDecimal } from "../core/money";
import {
  MAX_STOCK_QTY,
  PERCENT_PATTERN,
  RECEIPT_ADJUSTMENT_KINDS,
  adjustmentsTotal,
  billMatches,
  exactToPaise,
  receiptLineCost,
} from "../core/receipt-math";
import { businessDate } from "../lib/business-date";
import { impossible } from "../lib/conflict";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import {
  expiryMonth,
  likePattern,
  money,
  note,
  pageLimit,
  positiveMoney,
  reason,
  searchQuery,
  shortName,
} from "../lib/schemas";
import { readOrgSettings } from "../lib/settings-cache";
import { insertStockMovements, lockBatchStock, type StockMovementInput } from "../lib/stock";

// Sale facts belong to the Product, not a copied service row.
const saleTaxRate = z
  .string()
  .regex(/^\d{1,2}(\.\d{1,2})?$/)
  .optional();

const productFields = {
  name: shortName.transform((value) => value.replace(/\s+/g, " ")),
  genericName: z.string().trim().max(200).optional(),
  form: z.string().trim().max(50).optional(),
  strength: z.string().trim().max(50).optional(),
  stockUnit: z.enum(STOCK_UNITS),
  unitsPerPack: z.number().int().min(1).max(MAX_STOCK_QTY),
  expires: z.boolean(),
  pack: z.string().trim().max(50).optional(),
  schedule: z.enum(PRODUCT_SCHEDULES).default("none"),
  manufacturer: z.string().trim().max(200).optional(),
  sold: z.boolean(),
  taxRatePercent: saleTaxRate,
  taxCode: z.string().trim().max(20).optional(),
  active: z.boolean(),
};

// A pack prints a month, so the receipt names one; the batch is good until its last day.
function monthEnd(month: string): string {
  const [year, index] = month.split("-");

  return new Date(Date.UTC(Number(year), Number(index), 0)).toISOString().slice(0, 10);
}

const batchLine = z.object({
  productId: z.string(),
  batchNumber: z.string().trim().min(1).max(50),
  expiryDate: expiryMonth.transform(monthEnd).nullish(),
  mrp: money,
  pricedPer: z.enum(["pack", "unit"]),
});

// Quantities are stock units; the locked product determines the priced-unit divisor.
const lineCost = z.object({
  freeQty: z.number().int().min(0).max(MAX_STOCK_QTY),
  rate: money,
  discountPercent: z.string().regex(PERCENT_PATTERN),
  gstPercent: z.string().regex(PERCENT_PATTERN),
  hsnCode: z.string().trim().max(20).optional(),
});

// Drizzle renders a single-table projection unqualified, so a bare `stock_batches.id`
// inside the subquery would resolve to `stock_movements.id`; qualify it explicitly.
function bucketSum(orgId: string, bucket: StockBucket) {
  return sql<number>`coalesce((
    select sum(${stockMovements.qty})::int from ${stockMovements}
    where ${stockMovements.orgId} = ${orgId}
      and ${stockMovements.batchId} = ${stockBatches}.${sql.identifier(stockBatches.id.name)}
      and ${stockMovements.bucket} = ${bucket}
  ), 0)`;
}

type BatchRequest = {
  productId: string;
  batchNumber: string;
  expiryDate?: string | null;
  mrp: bigint;
  pricedPer: "pack" | "unit";
};

type ResolvedBatch = {
  id: string;
  productId: string;
  batchNumber: string;
  expiryDate: string | null;
  mrp: bigint;
  mrpUnits: number;
};

type ResolvedLine = { batch: ResolvedBatch; divisor: number };

const batchKey = (line: { productId: string; batchNumber: string }) =>
  `${line.productId}\0${line.batchNumber}`;

// Lock products before batches, then compare printed MRPs as exact ratios.
async function resolveBatches(
  tx: DbTransaction,
  args: { orgId: string; now: Date; lines: readonly BatchRequest[] },
): Promise<ResolvedLine[]> {
  const { orgId } = args;
  const productIds = [...new Set(args.lines.map((line) => line.productId))];

  // Lock order: products (by id) → stock batches.
  const known = await tx
    .select({ id: products.id, unitsPerPack: products.unitsPerPack, expires: products.expires })
    .from(products)
    .where(and(eq(products.orgId, orgId), inArray(products.id, productIds)))
    .orderBy(asc(products.id))
    .for("update");

  if (known.length !== productIds.length) {
    throw new ORPCError("NOT_FOUND", { message: "That product no longer exists." });
  }

  const productById = new Map(known.map((product) => [product.id, product]));

  const existing = await tx
    .select({
      id: stockBatches.id,
      productId: stockBatches.productId,
      batchNumber: stockBatches.batchNumber,
      expiryDate: stockBatches.expiryDate,
      mrp: stockBatches.mrp,
      mrpUnits: stockBatches.mrpUnits,
    })
    .from(stockBatches)
    .where(
      and(
        eq(stockBatches.orgId, orgId),
        inArray(stockBatches.productId, productIds),
        inArray(
          stockBatches.batchNumber,
          args.lines.map((line) => line.batchNumber),
        ),
      ),
    );

  const byKey = new Map(existing.map((batch) => [batchKey(batch), batch]));
  const resolved = new Map<string, ResolvedBatch>();
  const created: (typeof stockBatches.$inferInsert)[] = [];
  const lines: ResolvedLine[] = [];

  for (const line of args.lines) {
    const product = productById.get(line.productId)!;
    const expiryDate = line.expiryDate ?? null;

    if (product.expires ? expiryDate === null : expiryDate !== null) {
      throw new ORPCError("BAD_REQUEST", {
        message: product.expires
          ? "This product requires an expiry date."
          : "This product does not have an expiry date.",
      });
    }

    const divisor = line.pricedPer === "pack" ? product.unitsPerPack : 1;
    const lineKey = batchKey(line);
    const canonical = resolved.get(lineKey);

    if (canonical) {
      if (
        canonical.expiryDate !== expiryDate ||
        canonical.mrp * BigInt(divisor) !== line.mrp * BigInt(canonical.mrpUnits)
      ) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Batch ${line.batchNumber} is listed twice with a different expiry or MRP.`,
        });
      }

      lines.push({ batch: canonical, divisor });
      continue;
    }

    const match = byKey.get(lineKey);

    if (match) {
      if (
        match.expiryDate !== expiryDate ||
        match.mrp * BigInt(divisor) !== line.mrp * BigInt(match.mrpUnits)
      ) {
        throw new ORPCError("CONFLICT", {
          message: `Batch ${line.batchNumber} already exists with a different expiry or MRP.`,
        });
      }

      resolved.set(lineKey, match);
      lines.push({ batch: match, divisor });
      continue;
    }

    const batch = {
      id: Bun.randomUUIDv7(),
      orgId,
      productId: line.productId,
      batchNumber: line.batchNumber,
      expiryDate,
      mrp: line.mrp,
      mrpUnits: divisor,
      createdAt: args.now,
    };

    created.push(batch);
    resolved.set(lineKey, batch);
    lines.push({ batch, divisor });
  }

  if (created.length > 0) {
    await tx.insert(stockBatches).values(created);
  }

  return lines;
}

export const pharmacyStockRouter = {
  createProduct: orgProcedure(
    { pharmacy: ["manageItems"] },
    orgInput.extend(productFields),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    if (input.sold && input.taxRatePercent === undefined) {
      throw new ORPCError("BAD_REQUEST", {
        message: "A sold product needs an explicit GST rate.",
      });
    }

    const productId = Bun.randomUUIDv7();
    const now = new Date();

    await db.insert(products).values({
      id: productId,
      orgId: scope.orgId,
      name: input.name,
      genericName: input.genericName ?? null,
      form: input.form ?? null,
      strength: input.strength ?? null,
      stockUnit: input.stockUnit,
      unitsPerPack: input.unitsPerPack,
      expires: input.expires,
      pack: input.pack || null,
      schedule: input.schedule,
      manufacturer: input.manufacturer ?? null,
      sold: input.sold,
      active: input.active,
      taxRatePercent: input.sold ? input.taxRatePercent! : "0",
      taxCode: input.sold ? (input.taxCode ?? null) : null,
      createdAt: now,
      updatedAt: now,
    });

    audit({
      action: "pharmacy.product.create",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `product:${productId}`,
      meta: { name: input.name, sold: input.sold, schedule: input.schedule },
    });

    return { productId };
  }),

  updateProduct: orgProcedure(
    { pharmacy: ["manageItems"] },
    orgInput.extend({ productId: z.string(), ...productFields }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    if (input.sold && input.taxRatePercent === undefined) {
      throw new ORPCError("BAD_REQUEST", {
        message: "A sold product needs an explicit GST rate.",
      });
    }

    const now = new Date();

    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({
          stockUnit: products.stockUnit,
          unitsPerPack: products.unitsPerPack,
          expires: products.expires,
        })
        .from(products)
        .where(and(eq(products.orgId, scope.orgId), eq(products.id, input.productId)))
        .orderBy(asc(products.id))
        .limit(1)
        .for("update");

      if (!existing) {
        throw new ORPCError("NOT_FOUND", { message: "That product no longer exists." });
      }

      if (
        existing.stockUnit !== input.stockUnit ||
        existing.unitsPerPack !== input.unitsPerPack ||
        existing.expires !== input.expires
      ) {
        const [batch] = await tx
          .select({ id: stockBatches.id })
          .from(stockBatches)
          .where(
            and(eq(stockBatches.orgId, scope.orgId), eq(stockBatches.productId, input.productId)),
          )
          .limit(1);

        if (batch) {
          throw new ORPCError("CONFLICT", {
            message:
              "This product already has a batch, so its counted unit, pack size and expiry setting are fixed.",
          });
        }
      }

      await tx
        .update(products)
        .set({
          name: input.name,
          genericName: input.genericName ?? null,
          form: input.form ?? null,
          strength: input.strength ?? null,
          stockUnit: input.stockUnit,
          unitsPerPack: input.unitsPerPack,
          expires: input.expires,
          pack: input.pack || null,
          schedule: input.schedule,
          manufacturer: input.manufacturer ?? null,
          sold: input.sold,
          active: input.active,
          taxRatePercent: input.sold ? input.taxRatePercent! : "0",
          taxCode: input.sold ? (input.taxCode ?? null) : null,
          updatedAt: now,
        })
        .where(and(eq(products.orgId, scope.orgId), eq(products.id, input.productId)));
    });

    audit({
      action: "pharmacy.product.update",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `product:${input.productId}`,
      meta: { name: input.name, sold: input.sold, active: input.active },
    });

    return { productId: input.productId };
  }),

  listProducts: orgProcedure(
    { pharmacy: ["read"] },
    orgInput.extend({
      query: searchQuery,
      cursor: z.object({ name: z.string(), id: z.string() }).optional(),
      limit: pageLimit,
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const pattern = input.query ? likePattern(input.query) : undefined;

    const items = await db
      .select({
        productId: products.id,
        name: products.name,
        genericName: products.genericName,
        form: products.form,
        strength: products.strength,
        stockUnit: products.stockUnit,
        unitsPerPack: products.unitsPerPack,
        expires: products.expires,
        pack: products.pack,
        schedule: products.schedule,
        manufacturer: products.manufacturer,
        sold: products.sold,
        taxRatePercent: products.taxRatePercent,
        taxCode: products.taxCode,
        active: products.active,
      })
      .from(products)
      .where(
        and(
          eq(products.orgId, scope.orgId),
          pattern
            ? or(ilike(products.name, pattern), ilike(products.genericName, pattern))
            : undefined,
          input.cursor
            ? sql`(${products.name}, ${products.id}) > (${input.cursor.name}, ${input.cursor.id})`
            : undefined,
        ),
      )
      .orderBy(asc(products.name), asc(products.id))
      .limit(input.limit + 1);

    const hasNextPage = items.length > input.limit;

    if (hasNextPage) {
      items.pop();
    }

    const last = items.at(-1);

    return {
      items,
      nextCursor: hasNextPage && last ? { name: last.name, id: last.productId } : null,
    };
  }),

  searchStock: orgProcedure(
    { pharmacy: ["read"] },
    // Two characters is the counter's floor: one matches most of the shelf.
    orgInput.extend({ query: z.string().trim().min(2).max(100) }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const settings = await readOrgSettings(scope.orgId);
    const today = businessDate(new Date(), settings.timeZone);
    const pattern = likePattern(input.query);
    const shelf = bucketSum(scope.orgId, "shelf");

    // Only active, sold, non-Schedule-X goods with shelf stock can consume the result limit.
    const found = await db
      .select({
        productId: products.id,
        name: products.name,
        genericName: products.genericName,
        stockUnit: products.stockUnit,
        unitsPerPack: products.unitsPerPack,
        expires: products.expires,
        pack: products.pack,
        schedule: products.schedule,
        taxRatePercent: products.taxRatePercent,
      })
      .from(products)
      .where(
        and(
          eq(products.orgId, scope.orgId),
          eq(products.sold, true),
          eq(products.active, true),
          ne(products.schedule, "x"),
          exists(
            db
              .select({ id: stockBatches.id })
              .from(stockBatches)
              .where(
                and(
                  eq(stockBatches.orgId, scope.orgId),
                  eq(stockBatches.productId, products.id),
                  sql`(${stockBatches.expiryDate} >= ${today}::date or ${stockBatches.expiryDate} is null)`,
                  sql`${shelf} > 0`,
                ),
              ),
          ),
          or(ilike(products.name, pattern), ilike(products.genericName, pattern)),
        ),
      )
      .orderBy(asc(products.name), asc(products.id))
      .limit(20);

    if (found.length === 0) return [];

    const batches = await db
      .select({
        batchId: stockBatches.id,
        productId: stockBatches.productId,
        batchNumber: stockBatches.batchNumber,
        expiryDate: stockBatches.expiryDate,
        mrp: stockBatches.mrp,
        mrpUnits: stockBatches.mrpUnits,
        shelfQty: shelf,
      })
      .from(stockBatches)
      .where(
        and(
          eq(stockBatches.orgId, scope.orgId),
          inArray(
            stockBatches.productId,
            found.map((product) => product.productId),
          ),
          sql`(${stockBatches.expiryDate} >= ${today}::date or ${stockBatches.expiryDate} is null)`,
          sql`${shelf} > 0`,
        ),
      )
      .orderBy(sql`${stockBatches.expiryDate} asc nulls last`, asc(stockBatches.id));

    return found.map((product) => ({
      ...product,
      batches: batches
        .filter((batch) => batch.productId === product.productId)
        .map(({ productId: _productId, ...batch }) => batch),
    }));
  }),

  stockOnHand: orgProcedure(
    { pharmacy: ["read"] },
    orgInput.extend({
      productId: z.string().optional(),
      query: z.string().trim().min(1).max(100).optional(),
      expiringWithinDays: z.number().int().min(0).max(3650).optional(),
      quarantineOnly: z.boolean().default(false),
      includeZero: z.boolean().default(false),
      cursor: z.object({ expiryDate: z.iso.date().nullable(), batchId: z.string() }).optional(),
      limit: pageLimit,
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const shelf = bucketSum(scope.orgId, "shelf");
    const quarantine = bucketSum(scope.orgId, "quarantine");
    const settings = await readOrgSettings(scope.orgId);
    const today = businessDate(new Date(), settings.timeZone);
    const pattern = input.query ? likePattern(input.query) : undefined;

    const rows = await db
      .select({
        batchId: stockBatches.id,
        name: products.name,
        stockUnit: products.stockUnit,
        unitsPerPack: products.unitsPerPack,
        sold: products.sold,
        active: products.active,
        batchNumber: stockBatches.batchNumber,
        expiryDate: stockBatches.expiryDate,
        mrp: stockBatches.mrp,
        mrpUnits: stockBatches.mrpUnits,
        shelfQty: shelf,
        quarantineQty: quarantine,
      })
      .from(stockBatches)
      .innerJoin(
        products,
        and(
          eq(products.orgId, scope.orgId),
          eq(products.orgId, stockBatches.orgId),
          eq(products.id, stockBatches.productId),
        ),
      )
      .where(
        and(
          eq(stockBatches.orgId, scope.orgId),
          input.productId ? eq(stockBatches.productId, input.productId) : undefined,
          pattern
            ? or(ilike(products.name, pattern), ilike(stockBatches.batchNumber, pattern))
            : undefined,
          input.expiringWithinDays === undefined
            ? undefined
            : sql`${stockBatches.expiryDate} <= ${today}::date + ${input.expiringWithinDays}::int`,
          input.quarantineOnly ? sql`${quarantine} > 0` : undefined,
          input.includeZero ? undefined : sql`${shelf} + ${quarantine} <> 0`,
          input.cursor
            ? input.cursor.expiryDate === null
              ? sql`${stockBatches.expiryDate} is null and ${stockBatches.id} > ${input.cursor.batchId}`
              : sql`(
                  ${stockBatches.expiryDate} > ${input.cursor.expiryDate}::date
                  or (${stockBatches.expiryDate} = ${input.cursor.expiryDate}::date
                    and ${stockBatches.id} > ${input.cursor.batchId})
                  or ${stockBatches.expiryDate} is null
                )`
            : undefined,
        ),
      )
      .orderBy(sql`${stockBatches.expiryDate} asc nulls last`, asc(stockBatches.id))
      .limit(input.limit + 1);

    const hasNextPage = rows.length > input.limit;
    const items = rows.slice(0, input.limit);
    const last = items.at(-1);

    return {
      items,
      nextCursor:
        hasNextPage && last ? { expiryDate: last.expiryDate, batchId: last.batchId } : null,
    };
  }),

  listMovements: orgProcedure(
    { pharmacy: ["read"] },
    orgInput.extend({
      batchId: z.string().optional(),
      cursor: z.object({ createdAt: z.iso.datetime(), id: z.string() }).optional(),
      limit: pageLimit,
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    if (input.batchId && !input.cursor) {
      const [batch] = await db
        .select({ id: stockBatches.id })
        .from(stockBatches)
        .where(and(eq(stockBatches.orgId, scope.orgId), eq(stockBatches.id, input.batchId)))
        .limit(1);

      if (!batch) {
        throw new ORPCError("NOT_FOUND", { message: "That batch no longer exists." });
      }
    }

    const rows = await db
      .select({
        id: stockMovements.id,
        productName: products.name,
        batchNumber: stockBatches.batchNumber,
        expiryDate: stockBatches.expiryDate,
        stockUnit: products.stockUnit,
        unitsPerPack: products.unitsPerPack,
        bucket: stockMovements.bucket,
        qty: stockMovements.qty,
        reason: stockMovements.reason,
        sourceType: stockMovements.sourceType,
        departmentName: departments.name,
        note: stockMovements.note,
        createdAt: stockMovements.createdAt,
        createdByName: user.name,
        receipt: {
          opening: goodsReceipts.opening,
          supplierName: goodsReceipts.supplierName,
          supplierReference: goodsReceipts.supplierReference,
          receivedOn: goodsReceipts.receivedOn,
        },
      })
      .from(stockMovements)
      .innerJoin(
        stockBatches,
        and(
          eq(stockBatches.orgId, stockMovements.orgId),
          eq(stockBatches.id, stockMovements.batchId),
        ),
      )
      .innerJoin(
        products,
        and(eq(products.orgId, stockMovements.orgId), eq(products.id, stockBatches.productId)),
      )
      .innerJoin(user, eq(user.id, stockMovements.createdBy))
      .leftJoin(
        departments,
        and(
          eq(departments.orgId, stockMovements.orgId),
          eq(departments.id, stockMovements.departmentId),
        ),
      )
      .leftJoin(
        goodsReceipts,
        and(
          eq(goodsReceipts.orgId, stockMovements.orgId),
          eq(goodsReceipts.id, stockMovements.sourceId),
        ),
      )
      .where(
        and(
          eq(stockMovements.orgId, scope.orgId),
          input.batchId ? eq(stockMovements.batchId, input.batchId) : undefined,
          input.cursor
            ? sql`(${stockMovements.createdAt}, ${stockMovements.id}) < (${input.cursor.createdAt}::timestamptz, ${input.cursor.id})`
            : undefined,
        ),
      )
      .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
      .limit(input.limit + 1);

    const hasNextPage = rows.length > input.limit;

    if (hasNextPage) rows.pop();
    const last = rows.at(-1);

    return {
      items: rows.map(({ sourceType, ...row }) => {
        if (sourceType !== "goods_receipt") return { ...row, receipt: null };

        if (!row.receipt) throw impossible("a goods receipt movement has no receipt");

        return row;
      }),
      nextCursor:
        hasNextPage && last ? { createdAt: last.createdAt.toISOString(), id: last.id } : null,
    };
  }),

  receiveGoods: orgProcedure(
    { pharmacy: ["receive"] },
    orgInput
      .extend({
        // An opening receipt is the cutover count: no supplier, and every batch it names
        // must still be untouched.
        opening: z.boolean().default(false),
        supplierName: shortName.optional(),
        supplierReference: z.string().trim().max(100).optional(),
        receivedOn: z.iso.date(),
        note,
        billTotal: money.optional(),
        adjustments: z
          .array(
            z.object({
              kind: z.enum(RECEIPT_ADJUSTMENT_KINDS),
              reason,
              amount: positiveMoney,
              gstAmount: money,
            }),
          )
          .default([]),
        lines: z
          .array(
            batchLine.extend({
              qty: z.number().int().positive().max(MAX_STOCK_QTY),
              cost: lineCost.optional(),
            }),
          )
          .min(1),
      })
      .superRefine((value, context) => {
        if (!value.opening && !value.supplierName) {
          context.addIssue({
            code: "custom",
            path: ["supplierName"],
            message: "Name the supplier",
          });
        }

        if (value.opening && (value.supplierName || value.supplierReference)) {
          context.addIssue({
            code: "custom",
            path: ["supplierName"],
            message: "Opening stock does not have supplier details",
          });
        }

        // A delivery is priced line by line against its bill; an opening count is not.
        if (value.opening) {
          if (value.adjustments.length > 0) {
            context.addIssue({
              code: "custom",
              path: ["adjustments"],
              message: "Opening stock does not have bill adjustments",
            });
          }

          if (value.billTotal !== undefined || value.lines.some((line) => line.cost)) {
            context.addIssue({
              code: "custom",
              path: ["billTotal"],
              message: "Opening stock is not priced",
            });
          }

          return;
        }

        if (value.billTotal === undefined || value.lines.some((line) => !line.cost)) {
          context.addIssue({
            code: "custom",
            path: ["billTotal"],
            message: "Price every line and enter the bill total",
          });
        }
      }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const receiptId = Bun.randomUUIDv7();
    const now = new Date();

    const today = input.opening
      ? businessDate(now, (await readOrgSettings(scope.orgId)).timeZone)
      : null;

    const batches = await db.transaction(async (tx) => {
      const resolvedLines = await resolveBatches(tx, {
        orgId: scope.orgId,
        now,
        lines: input.lines,
      });

      if (today !== null) {
        const expired = resolvedLines.find(
          ({ batch }) => batch.expiryDate !== null && batch.expiryDate < today,
        );

        if (expired) {
          throw new ORPCError("CONFLICT", {
            message: `Batch ${expired.batch.batchNumber} is expired and cannot be opening stock.`,
          });
        }
      }

      const wanted = new Map<string, number>();
      const priced: (typeof goodsReceiptLines.$inferInsert)[] = [];
      let exactNet = 0n;

      for (const [index, line] of input.lines.entries()) {
        const { batch, divisor } = resolvedLines[index]!;
        const freeQty = line.cost?.freeQty ?? 0;
        const quantity = (wanted.get(batch.id) ?? 0) + line.qty + freeQty;

        if (quantity > MAX_STOCK_QTY) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Batch receipt quantity exceeds stock limit.",
          });
        }

        wanted.set(batch.id, quantity);

        if (!line.cost) continue;

        if (line.qty % divisor !== 0) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Billed quantity must contain whole priced packs.",
          });
        }

        exactNet += receiptLineCost({ qty: line.qty, packSize: divisor, ...line.cost }).net;
        priced.push({
          id: Bun.randomUUIDv7(),
          orgId: scope.orgId,
          receiptId,
          batchId: batch.id,
          qty: line.qty,
          freeQty,
          rate: line.cost.rate,
          packSize: divisor,
          discountPercent: line.cost.discountPercent,
          gstPercent: line.cost.gstPercent,
          hsnCode: line.cost.hsnCode || null,
        });
      }

      if (
        input.billTotal !== undefined &&
        !billMatches(input.billTotal - exactToPaise(exactNet) - adjustmentsTotal(input.adjustments))
      ) {
        throw new ORPCError("BAD_REQUEST", {
          message: "The lines do not add up to the bill total",
        });
      }

      await tx.insert(goodsReceipts).values({
        id: receiptId,
        orgId: scope.orgId,
        opening: input.opening,
        supplierName: input.supplierName ?? null,
        supplierReference: input.supplierReference ?? null,
        receivedOn: input.receivedOn,
        note: input.note ?? null,
        billTotal: input.billTotal ?? null,
        receivedBy: scope.userId,
        createdAt: now,
      });

      if (input.adjustments.length > 0) {
        await tx.insert(goodsReceiptAdjustments).values(
          input.adjustments.map((adjustment) => ({
            ...adjustment,
            id: Bun.randomUUIDv7(),
            orgId: scope.orgId,
            receiptId,
          })),
        );
      }

      const batchIds = [...wanted.keys()];

      // Receiving only adds, but the lock keeps every stock writer in one order.
      await lockBatchStock(tx, scope.orgId, batchIds);

      if (priced.length > 0) await tx.insert(goodsReceiptLines).values(priced);

      if (input.opening) {
        const touched = await tx
          .select({ batchId: stockMovements.batchId })
          .from(stockMovements)
          .where(
            and(eq(stockMovements.orgId, scope.orgId), inArray(stockMovements.batchId, batchIds)),
          )
          .limit(1);

        if (touched.length > 0) {
          throw new ORPCError("CONFLICT", {
            message: "That batch already has stock movements, so it has no opening balance.",
          });
        }
      }

      await insertStockMovements(tx, {
        orgId: scope.orgId,
        userId: scope.userId,
        now,
        rows: [...wanted].map(([batchId, qty]) => ({
          batchId,
          bucket: "shelf" as const,
          qty,
          reason: input.opening ? ("opening" as const) : ("receipt" as const),
          sourceType: "goods_receipt" as const,
          sourceId: receiptId,
          note: input.note ?? null,
        })),
      });

      return [...new Set(resolvedLines.map(({ batch }) => batch))].map((batch) => ({
        batchId: batch.id,
        productId: batch.productId,
        batchNumber: batch.batchNumber,
      }));
    });

    audit({
      action: "pharmacy.receive",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `goodsReceipt:${receiptId}`,
      meta: {
        opening: input.opening,
        supplierName: input.supplierName ?? null,
        billTotal: input.billTotal === undefined ? null : formatDecimal(input.billTotal),
        lines: input.lines.length,
      },
    });

    return { receiptId, batches };
  }),

  adjustStock: orgProcedure(
    { pharmacy: ["adjust"] },
    orgInput
      .extend({
        batchId: z.string(),
        reason: z.enum([
          "release",
          "quarantine",
          "writeoff",
          "breakage",
          "count_correction",
          "internal_issue",
        ]),
        qty: z.number().int(),
        bucket: z.enum(STOCK_BUCKETS).optional(),
        departmentId: z.string().optional(),
        note: reason,
      })
      .superRefine((value, context) => {
        if (value.qty === 0) {
          context.addIssue({ code: "custom", path: ["qty"], message: "Enter a quantity" });
        }

        if (value.qty < 0 && value.reason !== "count_correction") {
          context.addIssue({
            code: "custom",
            path: ["qty"],
            message: "Enter a positive quantity",
          });
        }

        const needsBucket =
          value.reason === "writeoff" ||
          value.reason === "breakage" ||
          value.reason === "count_correction";

        if (needsBucket && value.bucket === undefined) {
          context.addIssue({ code: "custom", path: ["bucket"], message: "Choose a bucket" });
        }

        if (value.reason === "internal_issue" && value.departmentId === undefined) {
          context.addIssue({
            code: "custom",
            path: ["departmentId"],
            message: "Choose the department",
          });
        }

        if (value.reason !== "internal_issue" && value.departmentId !== undefined) {
          context.addIssue({
            code: "custom",
            path: ["departmentId"],
            message: "Only an internal issue names a department",
          });
        }
      }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const sourceId = Bun.randomUUIDv7();
    const now = new Date();

    await db.transaction(async (tx) => {
      if (input.departmentId) {
        const [department] = await tx
          .select({ id: departments.id })
          .from(departments)
          .where(and(eq(departments.orgId, scope.orgId), eq(departments.id, input.departmentId)))
          .limit(1);

        if (!department) {
          throw new ORPCError("NOT_FOUND", { message: "That department no longer exists." });
        }
      }

      const onHand = await lockBatchStock(tx, scope.orgId, [input.batchId]);
      const stock = onHand.get(input.batchId);

      if (!stock) throw impossible("a locked batch vanished before its stock read");

      const rows: StockMovementInput[] = [];

      const shared = {
        batchId: input.batchId,
        reason: input.reason,
        sourceType: "adjustment" as const,
        sourceId,
        departmentId: input.departmentId ?? null,
        note: input.note,
      };

      switch (input.reason) {
        case "release":
          rows.push(
            { ...shared, bucket: "quarantine", qty: -input.qty },
            { ...shared, bucket: "shelf", qty: input.qty },
          );
          break;
        case "quarantine":
          rows.push(
            { ...shared, bucket: "shelf", qty: -input.qty },
            { ...shared, bucket: "quarantine", qty: input.qty },
          );
          break;
        case "internal_issue":
          rows.push({ ...shared, bucket: "shelf", qty: -input.qty });
          break;
        case "writeoff":
        case "breakage":
          rows.push({ ...shared, bucket: input.bucket ?? "shelf", qty: -input.qty });
          break;
        case "count_correction":
          rows.push({ ...shared, bucket: input.bucket ?? "shelf", qty: input.qty });
          break;
      }

      for (const row of rows) {
        if (stock[row.bucket] + row.qty < 0) {
          throw new ORPCError("CONFLICT", {
            message: `That adjustment takes ${row.bucket} stock below zero.`,
          });
        }
      }

      await insertStockMovements(tx, { orgId: scope.orgId, userId: scope.userId, now, rows });
    });

    audit({
      action: "pharmacy.adjust",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `stockBatch:${input.batchId}`,
      meta: {
        reason: input.reason,
        qty: input.qty,
        batchId: input.batchId,
        departmentId: input.departmentId ?? null,
      },
    });

    return { sourceId };
  }),
};
