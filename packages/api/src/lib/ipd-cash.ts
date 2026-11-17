import type { DbTransaction } from "@hms/db/counter";
import { advanceReceipts } from "@hms/db/schema/advance-receipts";
import { invoices } from "@hms/db/schema/invoices";
import { admissions } from "@hms/db/schema/ipd";
import { payments } from "@hms/db/schema/payments";
import { refunds } from "@hms/db/schema/refunds";
import { ORPCError } from "@orpc/server";
import { and, eq, sql, type SQL } from "drizzle-orm";

import type { PaymentMethod } from "./schemas";

/**
 * Cash received for one stay stays below ₹2,00,000, in paise. The legal basis is
 * unverified: believed to be Income Tax Act s.269ST, for the hospital's accountant to
 * confirm before release.
 */
const IPD_CASH_LIMIT = 200_000_00n;

/**
 * Refuses cash that would bring the stay's cash to the limit. The stay's cash is what its
 * cash deposits and the cash Payments on its bills still hold: each less the cash handed
 * back from that same receipt or bill. Cash handed back out of money that arrived another
 * way frees no room for more. Takes the Admission lock first (D040), so two cash commands
 * on one stay cannot both pass. Other methods do not count.
 */
export async function requireUnderCashLimit(
  tx: DbTransaction,
  orgId: string,
  admissionId: string,
  lines: Array<{ method: PaymentMethod; amount: bigint }>,
) {
  const adding = lines.reduce(
    (sum, line) => (line.method === "cash" ? sum + line.amount : sum),
    0n,
  );

  if (adding === 0n) return;

  await tx
    .select({ id: admissions.id })
    .from(admissions)
    .where(and(eq(admissions.orgId, orgId), eq(admissions.id, admissionId)))
    .for("update");

  const cashRefunded = (source: SQL) =>
    sql`coalesce((select sum(${refunds.amount}) from ${refunds}
      where ${refunds.orgId} = ${orgId} and ${refunds.method} = 'cash' and ${source}), 0)`;

  const cashPaid = sql`coalesce((select sum(${payments.amount}) from ${payments}
    where ${payments.orgId} = ${orgId} and ${payments.method} = 'cash'
      and ${payments.invoiceId} = ${invoices.id}), 0)`;

  const [[deposits], [bills]] = await Promise.all([
    tx
      .select({
        held: sql<bigint>`coalesce(sum(${advanceReceipts.amount}
          - ${cashRefunded(sql`${refunds.advanceReceiptId} = ${advanceReceipts.id}`)}), 0)::bigint`.mapWith(
          BigInt,
        ),
      })
      .from(advanceReceipts)
      .where(
        and(
          eq(advanceReceipts.orgId, orgId),
          eq(advanceReceipts.admissionId, admissionId),
          eq(advanceReceipts.method, "cash"),
        ),
      ),
    // A bill paid by card and refunded in cash holds no cash, not less than none.
    tx
      .select({
        held: sql<bigint>`coalesce(sum(greatest(${cashPaid}
          - ${cashRefunded(sql`${refunds.invoiceId} = ${invoices.id}`)}, 0)), 0)::bigint`.mapWith(
          BigInt,
        ),
      })
      .from(invoices)
      .where(and(eq(invoices.orgId, orgId), eq(invoices.admissionId, admissionId))),
  ]);

  // SAFETY: an aggregate without GROUP BY returns exactly one row.
  const held = deposits!.held + bills!.held;

  if (held + adding >= IPD_CASH_LIMIT) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "Cash for one stay must stay under ₹2,00,000. Take the rest by UPI, card or bank transfer.",
    });
  }
}
