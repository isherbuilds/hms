import type { DbTransaction } from "@hms/db/counter";
import { requestKeys } from "@hms/db/schema/request-keys";
import { ORPCError } from "@orpc/server";

/**
 * Claims the client's key for one money command, first inside its transaction. A retry
 * after a lost response finds the key and is refused; a concurrent retry waits on the
 * first insert and is refused once that commits, or proceeds if it rolled back (D039).
 */
export async function claimRequestKey(tx: DbTransaction, orgId: string, requestKey: string) {
  const claimed = await tx
    .insert(requestKeys)
    .values({ orgId, id: requestKey })
    .onConflictDoNothing()
    .returning({ id: requestKeys.id });

  if (claimed.length === 0) {
    throw new ORPCError("CONFLICT", {
      message:
        "This was already recorded. Find it on the patient's latest visit or receipts before trying again.",
    });
  }
}
