import { sql } from "drizzle-orm";

import type { db } from "./index";
import { counter } from "./schema/counter";

export type DbTransaction = Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];

// Reserves `count` consecutive values in one upsert and returns the first. The upsert
// holds the row lock until the caller's transaction ends, which is what makes a series
// gapless. Increment several counters in a stable key order or two such transactions
// deadlock.
export async function nextCounter(
  tx: DbTransaction,
  orgId: string,
  key: string,
  count = 1,
): Promise<number> {
  const [row] = await tx
    .insert(counter)
    .values({ orgId, key, value: count })
    .onConflictDoUpdate({
      target: [counter.orgId, counter.key],
      set: { value: sql`${counter.value} + ${count}` },
    })
    .returning({ value: counter.value });

  if (!row) {
    throw new Error(`Counter increment returned no row for key "${key}"`);
  }

  return row.value - count + 1;
}
