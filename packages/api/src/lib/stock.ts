import type { DbTransaction } from "@hms/db/counter";
import { stockBatches } from "@hms/db/schema/stock-batches";
import {
  type StockBucket,
  type StockMovementReason,
  type StockMovementSource,
  stockMovements,
} from "@hms/db/schema/stock-movements";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

type BucketQty = { shelf: number; quarantine: number };

/**
 * Locks the batches in the documented order and returns the per-bucket sums on hand.
 * Callers aggregate their lines by batch before calling, so two lines on one batch
 * cannot each pass the below-zero check alone.
 */
export async function lockBatchStock(
  tx: DbTransaction,
  orgId: string,
  batchIds: readonly string[],
): Promise<Map<string, BucketQty>> {
  const ids = [...new Set(batchIds)];

  if (ids.length === 0) return new Map();

  const locked = await tx
    .select({ id: stockBatches.id })
    .from(stockBatches)
    .where(and(eq(stockBatches.orgId, orgId), inArray(stockBatches.id, ids)))
    .orderBy(asc(stockBatches.expiryDate), asc(stockBatches.id))
    .for("update");

  if (locked.length !== ids.length) {
    throw new ORPCError("NOT_FOUND", { message: "That batch no longer exists." });
  }

  // A new statement after the lock: under READ COMMITTED only a statement that starts
  // after the lock sees the movements committed while it waited.
  const sums = await tx
    .select({
      batchId: stockMovements.batchId,
      bucket: stockMovements.bucket,
      qty: sql<number>`sum(${stockMovements.qty})::int`,
    })
    .from(stockMovements)
    .where(and(eq(stockMovements.orgId, orgId), inArray(stockMovements.batchId, ids)))
    .groupBy(stockMovements.batchId, stockMovements.bucket);

  const onHand = new Map<string, BucketQty>(ids.map((id) => [id, { shelf: 0, quarantine: 0 }]));

  for (const row of sums) {
    const bucket = onHand.get(row.batchId);

    if (bucket) bucket[row.bucket] = row.qty;
  }

  return onHand;
}

export type StockMovementInput = {
  batchId: string;
  bucket: StockBucket;
  qty: number;
  reason: StockMovementReason;
  sourceType: StockMovementSource;
  sourceId: string;
  departmentId?: string | null;
  note: string | null;
};

export async function insertStockMovements(
  tx: DbTransaction,
  args: { orgId: string; userId: string; now: Date; rows: readonly StockMovementInput[] },
): Promise<void> {
  if (args.rows.length === 0) return;

  await tx.insert(stockMovements).values(
    args.rows.map((row) => ({
      ...row,
      id: Bun.randomUUIDv7(),
      orgId: args.orgId,
      createdBy: args.userId,
      createdAt: args.now,
    })),
  );
}
