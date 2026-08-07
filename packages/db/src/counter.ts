import { sql } from "drizzle-orm";

import type { db } from "./index";
import { counter } from "./schema/counter";

/** The transaction handle `db.transaction` passes to its callback. */
export type DbTransaction = Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];

/**
 * Increments and returns the org's named sequence inside the caller's
 * transaction. The single upsert takes the row lock until that transaction
 * ends, so concurrent callers serialize per (org, key) and a committed series
 * has no gaps — a rolled-back transaction returns its number with it.
 *
 * A transaction that increments several counters must do so in a stable key
 * order, or two such transactions can deadlock.
 */
export async function nextCounter(tx: DbTransaction, orgId: string, key: string): Promise<number> {
  const [row] = await tx
    .insert(counter)
    .values({ orgId, key, value: 1 })
    .onConflictDoUpdate({
      target: [counter.orgId, counter.key],
      set: { value: sql`${counter.value} + 1` },
    })
    .returning({ value: counter.value });

  if (!row) {
    throw new Error(`Counter increment returned no row for key "${key}"`);
  }
  return row.value;
}
