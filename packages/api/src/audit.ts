import { db } from "@hms/db";
import { auditLog } from "@hms/db/schema/audit";

export type AuditEntry = Omit<typeof auditLog.$inferInsert, "id" | "createdAt">;

const pendingWrites = new Set<Promise<void>>();

/**
 * Fire-and-forget audit write: one insert, never awaited, so it cannot slow a
 * response down or turn one into a 500. Audit sensitive or destructive
 * actions, not every mutation. When a domain needs the entry to commit
 * atomically with its mutation (patient/student data), insert into `auditLog`
 * inside that mutation's transaction instead.
 */
export function audit(entry: AuditEntry): void {
  const write = db
    .insert(auditLog)
    .values(entry)
    .then(
      () => undefined,
      (error: unknown) => console.error(`audit write failed: ${entry.action}`, error),
    );
  pendingWrites.add(write);
  void write.finally(() => pendingWrites.delete(write));
}

/** Waits only for writes already in flight; production request paths never call this. */
export async function drainAuditWrites(): Promise<void> {
  await Promise.all(pendingWrites);
}
