import type { db } from "@hms/db";
import type { DbTransaction } from "@hms/db/counter";
import { advanceAllocations } from "@hms/db/schema/advance-allocations";
import { advanceReceipts } from "@hms/db/schema/advance-receipts";
import { refunds } from "@hms/db/schema/refunds";
import { and, eq, inArray, sql } from "drizzle-orm";

/**
 * A receipt's unused credit: its amount less allocations and advance refunds. The one
 * owner of that rule; it correlates to an unaliased `advance_receipts`, so any select
 * over that table can use it.
 *
 * The receipt side is spelled out because Drizzle drops table prefixes from a
 * single-table selection, which would bind `"id"` to the subquery's own table.
 */
export function advanceRemaining(orgId: string) {
  return sql<bigint>`("advance_receipts"."amount"
    - coalesce((select sum(${advanceAllocations.amount}) from ${advanceAllocations}
        where ${advanceAllocations.orgId} = ${orgId}
          and ${advanceAllocations.advanceReceiptId} = "advance_receipts"."id"), 0)
    - coalesce((select sum(${refunds.amount}) from ${refunds}
        where ${refunds.orgId} = ${orgId}
          and ${refunds.advanceReceiptId} = "advance_receipts"."id"), 0))::bigint`.mapWith(BigInt);
}

/** The deposit each stay still holds, in one query; a stay without one holds 0. */
export async function readDepositsHeld(
  executor: typeof db | DbTransaction,
  orgId: string,
  admissionIds: string[],
): Promise<Map<string, bigint>> {
  if (admissionIds.length === 0) return new Map();

  const rows = await executor
    .select({
      admissionId: advanceReceipts.admissionId,
      held: sql<bigint>`sum(${advanceRemaining(orgId)})::bigint`.mapWith(BigInt),
    })
    .from(advanceReceipts)
    .where(
      and(eq(advanceReceipts.orgId, orgId), inArray(advanceReceipts.admissionId, admissionIds)),
    )
    .groupBy(advanceReceipts.admissionId);

  const held = new Map(rows.map((row) => [row.admissionId!, row.held]));

  return new Map(admissionIds.map((id) => [id, held.get(id) ?? 0n]));
}
