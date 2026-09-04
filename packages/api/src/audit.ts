import { db } from "@hms/db";
import { auditLog } from "@hms/db/schema/audit";

type AuditEntry = Omit<typeof auditLog.$inferInsert, "id" | "createdAt">;

const pendingWrites = new Set<Promise<void>>();

// Never awaited, so an audit write can never slow a response or turn one into a
// 500. Audit sensitive or destructive actions only (hard rule 3).
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

// Loops because a write can be added while an earlier batch is still settling.
export async function drainAuditWrites(): Promise<void> {
  while (pendingWrites.size > 0) {
    await Promise.all(pendingWrites);
  }
}
