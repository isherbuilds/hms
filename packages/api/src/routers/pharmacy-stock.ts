import { db } from "@hms/db";
import type { DbTransaction } from "@hms/db/counter";
import { user } from "@hms/db/schema/auth";
import { catalogItems } from "@hms/db/schema/catalog-items";
import { departments } from "@hms/db/schema/departments";
import { file } from "@hms/db/schema/file";
import { goodsReceiptLines } from "@hms/db/schema/goods-receipt-lines";
import { goodsReceipts } from "@hms/db/schema/goods-receipts";
import { PRODUCT_SCHEDULES, STOCK_UNITS, products } from "@hms/db/schema/products";
import { stockBatches } from "@hms/db/schema/stock-batches";
import { STOCK_BUCKETS, type StockBucket, stockMovements } from "@hms/db/schema/stock-movements";
import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, exists, ilike, inArray, like, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { formatDecimal } from "../core/money";
import {
  BILL_ROUND_OFF_LIMIT,
  MAX_STOCK_QTY,
  PERCENT_PATTERN,
  exactToPaise,
  receiptLineCost,
} from "../core/receipt-math";
import { businessDate } from "../lib/business-date";
import { conflict, impossible } from "../lib/conflict";
import { uniqueViolationConstraint } from "../lib/db-errors";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import {
  expiryMonth,
  likePattern,
  money,
  note,
  pageLimit,
  reason,
  searchQuery,
  shortName,
} from "../lib/schemas";
import { readOrgSettings } from "../lib/settings-cache";
import { insertStockMovements, lockBatchStock, type StockMovementInput } from "../lib/stock";

// Present only for a product that is sold across the counter. Without it the product is
// an internal supply: stocked and issued, never billed.
const catalogDetails = z.object({
  code: z.string().trim().min(1).max(20),
  taxRatePercent: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/),
  taxCode: z.string().trim().max(20).optional(),
  active: z.boolean().default(true),
});

const productFields = {
  name: shortName,
  genericName: z.string().trim().max(200).optional(),
  form: z.string().trim().max(50).optional(),
  strength: z.string().trim().max(50).optional(),
  stockUnit: z.enum(STOCK_UNITS),
  unitsPerPack: z.number().int().min(1),
  schedule: z.enum(PRODUCT_SCHEDULES).default("none"),
  manufacturer: z.string().trim().max(200).optional(),
  catalog: catalogDetails.optional(),
};

// A pack prints a month, so the receipt names one; the batch is good until its last day.
function monthEnd(month: string): string {
  const [year, index] = month.split("-");

  return new Date(Date.UTC(Number(year), Number(index), 0)).toISOString().slice(0, 10);
}

const batchLine = z.object({
  productId: z.string(),
  batchNumber: z.string().trim().min(1).max(50),
  expiryDate: expiryMonth.transform(monthEnd),
  pricedPer: z.enum(["pack", "unit"]),
  mrp: money,
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
  expiryDate: string;
  pricedPer: "pack" | "unit";
  mrp: bigint;
};

type ResolvedBatch = {
  id: string;
  productId: string;
  batchNumber: string;
  expiryDate: string;
  mrp: bigint;
  mrpUnits: number;
};

const batchKey = (line: { productId: string; batchNumber: string }) =>
  `${line.productId}\0${line.batchNumber}`;

/**
 * Batches are immutable. Product locks determine each priced-unit divisor before
 * comparing printed MRPs as ratios, preserving the products → batches lock order.
 */
async function resolveBatches(
  tx: DbTransaction,
  args: { orgId: string; now: Date; lines: readonly BatchRequest[] },
): Promise<{ resolved: Map<string, ResolvedBatch>; unitsPerPack: Map<string, number> }> {
  const { orgId } = args;
  const productIds = [...new Set(args.lines.map((line) => line.productId))];

  // Lock order: products (by id) → stock batches.
  const known = await tx
    .select({ id: products.id, unitsPerPack: products.unitsPerPack })
    .from(products)
    .where(and(eq(products.orgId, orgId), inArray(products.id, productIds)))
    .orderBy(asc(products.id))
    .for("update");

  if (known.length !== productIds.length) {
    throw new ORPCError("NOT_FOUND", { message: "That product no longer exists." });
  }

  const unitsPerPack = new Map(known.map((product) => [product.id, product.unitsPerPack]));

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

  for (const line of args.lines) {
    const lineKey = batchKey(line);
    const packUnits = unitsPerPack.get(line.productId);

    if (packUnits === undefined) throw impossible("a locked receipt product vanished");
    const divisor = line.pricedPer === "pack" ? packUnits : 1;
    const canonical = resolved.get(lineKey);

    if (canonical) {
      if (
        canonical.expiryDate !== line.expiryDate ||
        canonical.mrp * BigInt(divisor) !== line.mrp * BigInt(canonical.mrpUnits)
      ) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Batch ${line.batchNumber} is listed twice with a different expiry or MRP.`,
        });
      }

      continue;
    }

    const match = byKey.get(lineKey);

    if (match) {
      if (
        match.expiryDate !== line.expiryDate ||
        match.mrp * BigInt(divisor) !== line.mrp * BigInt(match.mrpUnits)
      ) {
        throw new ORPCError("CONFLICT", {
          message: `Batch ${line.batchNumber} already exists with a different expiry or MRP.`,
        });
      }

      resolved.set(lineKey, match);
      continue;
    }

    const batch = {
      id: Bun.randomUUIDv7(),
      orgId,
      productId: line.productId,
      batchNumber: line.batchNumber,
      expiryDate: line.expiryDate,
      mrp: line.mrp,
      mrpUnits: divisor,
      createdAt: args.now,
    };

    created.push(batch);
    resolved.set(lineKey, batch);
  }

  if (created.length > 0) {
    await tx.insert(stockBatches).values(created);
  }

  return { resolved, unitsPerPack };
}

export const pharmacyStockRouter = {
  createProduct: orgProcedure(
    { pharmacy: ["manageItems"] },
    orgInput.extend(productFields),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { catalog } = input;
    const catalogItemId = catalog ? Bun.randomUUIDv7() : null;
    const productId = Bun.randomUUIDv7();
    const now = new Date();

    try {
      await db.transaction(async (tx) => {
        if (catalog && catalogItemId) {
          await tx.insert(catalogItems).values({
            id: catalogItemId,
            orgId: scope.orgId,
            name: input.name,
            code: catalog.code,
            category: "pharmacy",
            unitPrice: 0n,
            customRate: false,
            taxRatePercent: catalog.taxRatePercent,
            taxCode: catalog.taxCode ?? null,
            active: catalog.active,
            createdAt: now,
            updatedAt: now,
          });
        }

        await tx.insert(products).values({
          id: productId,
          orgId: scope.orgId,
          catalogItemId,
          name: input.name,
          genericName: input.genericName ?? null,
          form: input.form ?? null,
          strength: input.strength ?? null,
          stockUnit: input.stockUnit,
          unitsPerPack: input.unitsPerPack,
          schedule: input.schedule,
          manufacturer: input.manufacturer ?? null,
          createdAt: now,
          updatedAt: now,
        });
      });
    } catch (error) {
      if (uniqueViolationConstraint(error) !== undefined) {
        throw conflict("duplicate", "A catalog item with this code already exists.");
      }

      throw error;
    }

    audit({
      action: "pharmacy.product.create",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `product:${productId}`,
      meta: { name: input.name, code: catalog?.code ?? null, schedule: input.schedule },
    });

    return { productId, catalogItemId };
  }),

  updateProduct: orgProcedure(
    { pharmacy: ["manageItems"] },
    orgInput.extend({ productId: z.string(), ...productFields }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { catalog } = input;
    const now = new Date();

    const catalogItemId = await db
      .transaction(async (tx) => {
        const [existing] = await tx
          .select({
            catalogItemId: products.catalogItemId,
            stockUnit: products.stockUnit,
            unitsPerPack: products.unitsPerPack,
          })
          .from(products)
          .where(and(eq(products.orgId, scope.orgId), eq(products.id, input.productId)))
          .orderBy(asc(products.id))
          .limit(1)
          .for("update");

        if (!existing) {
          throw new ORPCError("NOT_FOUND", { message: "That product no longer exists." });
        }

        if (!catalog && existing.catalogItemId) {
          throw new ORPCError("BAD_REQUEST", {
            message: "This product is sold at the counter, so it needs a code and tax rate.",
          });
        }

        const unitsChanged =
          existing.stockUnit !== input.stockUnit || existing.unitsPerPack !== input.unitsPerPack;

        if (unitsChanged) {
          const [batch] = await tx
            .select({ id: stockBatches.id })
            .from(stockBatches)
            .where(
              and(eq(stockBatches.orgId, scope.orgId), eq(stockBatches.productId, input.productId)),
            )
            .limit(1);

          if (batch) {
            throw new ORPCError("CONFLICT", {
              message: "This product already has stock, so its unit and pack size are fixed.",
            });
          }
        }

        // The catalog row is the invoice snapshot source (D027), so its name follows the
        // product's inside this transaction.
        let catalogItemId = existing.catalogItemId;

        if (catalog && catalogItemId) {
          await tx
            .update(catalogItems)
            .set({
              name: input.name,
              code: catalog.code,
              taxRatePercent: catalog.taxRatePercent,
              taxCode: catalog.taxCode ?? null,
              active: catalog.active,
              updatedAt: now,
            })
            .where(and(eq(catalogItems.orgId, scope.orgId), eq(catalogItems.id, catalogItemId)));
        } else if (catalog) {
          catalogItemId = Bun.randomUUIDv7();

          await tx.insert(catalogItems).values({
            id: catalogItemId,
            orgId: scope.orgId,
            name: input.name,
            code: catalog.code,
            category: "pharmacy",
            unitPrice: 0n,
            customRate: false,
            taxRatePercent: catalog.taxRatePercent,
            taxCode: catalog.taxCode ?? null,
            active: catalog.active,
            createdAt: now,
            updatedAt: now,
          });
        }

        await tx
          .update(products)
          .set({
            catalogItemId,
            name: input.name,
            genericName: input.genericName ?? null,
            form: input.form ?? null,
            strength: input.strength ?? null,
            stockUnit: input.stockUnit,
            unitsPerPack: input.unitsPerPack,
            schedule: input.schedule,
            manufacturer: input.manufacturer ?? null,
            updatedAt: now,
          })
          .where(and(eq(products.orgId, scope.orgId), eq(products.id, input.productId)));

        return catalogItemId;
      })
      .catch((error: unknown) => {
        if (uniqueViolationConstraint(error) !== undefined) {
          throw conflict("duplicate", "A catalog item with this code already exists.");
        }

        throw error;
      });

    audit({
      action: "pharmacy.product.update",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `product:${input.productId}`,
      meta: { name: input.name, code: catalog?.code ?? null, active: catalog?.active ?? null },
    });

    return { productId: input.productId, catalogItemId };
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
        catalogItemId: products.catalogItemId,
        name: products.name,
        code: catalogItems.code,
        genericName: products.genericName,
        form: products.form,
        strength: products.strength,
        stockUnit: products.stockUnit,
        unitsPerPack: products.unitsPerPack,
        schedule: products.schedule,
        manufacturer: products.manufacturer,
        taxRatePercent: catalogItems.taxRatePercent,
        taxCode: catalogItems.taxCode,
        active: catalogItems.active,
      })
      .from(products)
      .leftJoin(
        catalogItems,
        and(eq(catalogItems.orgId, products.orgId), eq(catalogItems.id, products.catalogItemId)),
      )
      .where(
        and(
          eq(products.orgId, scope.orgId),
          pattern
            ? or(
                ilike(products.name, pattern),
                ilike(catalogItems.code, pattern),
                ilike(products.genericName, pattern),
              )
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

    // The inner join and existence check are the sale rule: only a non-Schedule-X product
    // with an active catalog row and sellable shelf stock can consume the result limit.
    const found = await db
      .select({
        productId: products.id,
        catalogItemId: catalogItems.id,
        name: products.name,
        code: catalogItems.code,
        genericName: products.genericName,
        stockUnit: products.stockUnit,
        unitsPerPack: products.unitsPerPack,
        schedule: products.schedule,
        taxRatePercent: catalogItems.taxRatePercent,
      })
      .from(products)
      .innerJoin(
        catalogItems,
        and(eq(catalogItems.orgId, products.orgId), eq(catalogItems.id, products.catalogItemId)),
      )
      .where(
        and(
          eq(products.orgId, scope.orgId),
          eq(catalogItems.active, true),
          ne(products.schedule, "x"),
          exists(
            db
              .select({ id: stockBatches.id })
              .from(stockBatches)
              .where(
                and(
                  eq(stockBatches.orgId, scope.orgId),
                  eq(stockBatches.productId, products.id),
                  sql`${stockBatches.expiryDate} >= ${today}::date`,
                  sql`${shelf} > 0`,
                ),
              ),
          ),
          or(
            ilike(products.name, pattern),
            ilike(catalogItems.code, pattern),
            ilike(products.genericName, pattern),
          ),
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
          sql`${stockBatches.expiryDate} >= ${today}::date`,
          sql`${shelf} > 0`,
        ),
      )
      .orderBy(asc(stockBatches.expiryDate), asc(stockBatches.id));

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
      cursor: z.object({ expiryDate: z.iso.date(), batchId: z.string() }).optional(),
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
        productId: stockBatches.productId,
        name: products.name,
        code: catalogItems.code,
        stockUnit: products.stockUnit,
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
        and(eq(products.orgId, stockBatches.orgId), eq(products.id, stockBatches.productId)),
      )
      .leftJoin(
        catalogItems,
        and(eq(catalogItems.orgId, products.orgId), eq(catalogItems.id, products.catalogItemId)),
      )
      .where(
        and(
          eq(stockBatches.orgId, scope.orgId),
          input.productId ? eq(stockBatches.productId, input.productId) : undefined,
          pattern
            ? or(
                ilike(products.name, pattern),
                ilike(catalogItems.code, pattern),
                ilike(stockBatches.batchNumber, pattern),
              )
            : undefined,
          input.expiringWithinDays === undefined
            ? undefined
            : sql`${stockBatches.expiryDate} <= ${today}::date + ${input.expiringWithinDays}::int`,
          input.quarantineOnly ? sql`${quarantine} > 0` : undefined,
          input.includeZero ? undefined : sql`${shelf} + ${quarantine} <> 0`,
          input.cursor
            ? sql`(${stockBatches.expiryDate}, ${stockBatches.id}) > (${input.cursor.expiryDate}::date, ${input.cursor.batchId})`
            : undefined,
        ),
      )
      .orderBy(asc(stockBatches.expiryDate), asc(stockBatches.id))
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
    orgInput.extend({ batchId: z.string() }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    const [batch] = await db
      .select({ id: stockBatches.id })
      .from(stockBatches)
      .where(and(eq(stockBatches.orgId, scope.orgId), eq(stockBatches.id, input.batchId)))
      .limit(1);

    if (!batch) {
      throw new ORPCError("NOT_FOUND", { message: "That batch no longer exists." });
    }

    const rows = await db
      .select({
        id: stockMovements.id,
        bucket: stockMovements.bucket,
        qty: stockMovements.qty,
        reason: stockMovements.reason,
        sourceType: stockMovements.sourceType,
        sourceId: stockMovements.sourceId,
        departmentId: stockMovements.departmentId,
        departmentName: departments.name,
        note: stockMovements.note,
        createdAt: stockMovements.createdAt,
        createdByName: user.name,
        receipt: {
          opening: goodsReceipts.opening,
          supplierName: goodsReceipts.supplierName,
          supplierReference: goodsReceipts.supplierReference,
          receivedOn: goodsReceipts.receivedOn,
          fileId: goodsReceipts.fileId,
        },
      })
      .from(stockMovements)
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
      .where(and(eq(stockMovements.orgId, scope.orgId), eq(stockMovements.batchId, input.batchId)))
      .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id));

    return rows.map((row) => {
      if (row.sourceType !== "goods_receipt") return { ...row, receipt: null };

      if (!row.receipt) throw impossible("a goods receipt movement has no receipt");

      return row;
    });
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
        // The supplier's delivery note; required when this is an opening receipt's signed
        // count sheet.
        fileId: z.string().optional(),
        note,
        billTotal: money.optional(),
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

        if (value.opening && !value.fileId) {
          context.addIssue({
            code: "custom",
            path: ["fileId"],
            message: "Attach the signed count sheet",
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

    const batches = await db.transaction(async (tx) => {
      if (input.fileId) {
        const [sheet] = await tx
          .select({ id: file.id })
          .from(file)
          .where(
            and(
              eq(file.orgId, scope.orgId),
              eq(file.id, input.fileId),
              eq(file.status, "ready"),
              or(eq(file.mimeType, "application/pdf"), like(file.mimeType, "image/%")),
            ),
          )
          .limit(1)
          .for("key share");

        if (!sheet) {
          throw new ORPCError("NOT_FOUND", { message: "That document is not available." });
        }
      }

      const { resolved, unitsPerPack } = await resolveBatches(tx, {
        orgId: scope.orgId,
        now,
        lines: input.lines,
      });

      const wanted = new Map<string, number>();
      const priced: (typeof goodsReceiptLines.$inferInsert)[] = [];
      let exactNet = 0n;

      for (const line of input.lines) {
        const batch = resolved.get(batchKey(line));

        if (!batch) throw impossible("a resolved receipt batch vanished before its movement");

        const freeQty = line.cost?.freeQty ?? 0;
        const quantity = line.qty + freeQty;

        if (quantity > MAX_STOCK_QTY) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Receipt line quantity exceeds stock limit.",
          });
        }

        const total = (wanted.get(batch.id) ?? 0) + quantity;

        if (total > MAX_STOCK_QTY) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Batch receipt quantity exceeds stock limit.",
          });
        }

        wanted.set(batch.id, total);

        if (!line.cost) continue;
        const packUnits = unitsPerPack.get(line.productId);

        if (packUnits === undefined) throw impossible("a locked receipt product vanished");
        const divisor = line.pricedPer === "pack" ? packUnits : 1;

        if (line.qty % divisor !== 0) {
          throw new ORPCError("BAD_REQUEST", { message: "Quantity must be whole priced units" });
        }

        exactNet += receiptLineCost({ qty: line.qty, packSize: divisor, ...line.cost }).net;
        priced.push({
          id: Bun.randomUUIDv7(),
          orgId: scope.orgId,
          receiptId,
          batchId: batch.id,
          qty: line.qty,
          freeQty,
          packSize: divisor,
          rate: line.cost.rate,
          discountPercent: line.cost.discountPercent,
          gstPercent: line.cost.gstPercent,
          hsnCode: line.cost.hsnCode || null,
        });
      }

      if (input.billTotal !== undefined) {
        const roundOff = input.billTotal - exactToPaise(exactNet);

        if (roundOff > BILL_ROUND_OFF_LIMIT || roundOff < -BILL_ROUND_OFF_LIMIT) {
          throw new ORPCError("BAD_REQUEST", {
            message: "The lines do not add up to the bill total",
          });
        }
      }

      await tx.insert(goodsReceipts).values({
        id: receiptId,
        orgId: scope.orgId,
        opening: input.opening,
        supplierName: input.supplierName ?? null,
        supplierReference: input.supplierReference ?? null,
        receivedOn: input.receivedOn,
        fileId: input.fileId ?? null,
        note: input.note ?? null,
        billTotal: input.billTotal ?? null,
        receivedBy: scope.userId,
        createdAt: now,
      });

      if (priced.length > 0) await tx.insert(goodsReceiptLines).values(priced);

      const batchIds = [...wanted.keys()];

      // Receiving only adds, but the lock keeps every stock writer in one order.
      await lockBatchStock(tx, scope.orgId, batchIds);

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

      return [...resolved.values()].map((batch) => ({
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
