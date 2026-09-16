import { advanceAllocations } from "@hms/db/schema/advance-allocations";
import { refunds } from "@hms/db/schema/refunds";
import { sql } from "drizzle-orm";

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
