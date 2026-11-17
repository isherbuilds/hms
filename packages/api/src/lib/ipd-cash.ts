import type { DbTransaction } from "@hms/db/counter";
import { advanceReceipts } from "@hms/db/schema/advance-receipts";
import { invoices } from "@hms/db/schema/invoices";
import { admissions } from "@hms/db/schema/ipd";
import { payments } from "@hms/db/schema/payments";
import { refunds } from "@hms/db/schema/refunds";
import { ORPCError } from "@orpc/server";
import { and, eq, inArray, or, sql } from "drizzle-orm";

import type { PaymentMethod } from "./schemas";

/**
 * Cash received for one stay stays below ₹2,00,000, in paise. The legal basis is
 * unverified: believed to be Income Tax Act s.269ST, for the hospital's accountant to
 * confirm before release.
 */
export const IPD_CASH_LIMIT = 200_000_00n;

/**
 * Refuses cash that would bring the stay's cash to the limit: its cash deposits and cash
 * Payments on its bills, less cash refunded from either. Takes the Admission lock first
 * (D040), so two cash commands on one stay cannot both pass. Other methods do not count.
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

  const receiptIds = tx
    .select({ id: advanceReceipts.id })
    .from(advanceReceipts)
    .where(and(eq(advanceReceipts.orgId, orgId), eq(advanceReceipts.admissionId, admissionId)));

  const invoiceIds = tx
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.admissionId, admissionId)));

  const [[deposited], [paid], [refunded]] = await Promise.all([
    tx
      .select({
        amount: sql<bigint>`coalesce(sum(${advanceReceipts.amount}), 0)::bigint`.mapWith(BigInt),
      })
      .from(advanceReceipts)
      .where(
        and(
          eq(advanceReceipts.orgId, orgId),
          eq(advanceReceipts.admissionId, admissionId),
          eq(advanceReceipts.method, "cash"),
        ),
      ),
    tx
      .select({ amount: sql<bigint>`coalesce(sum(${payments.amount}), 0)::bigint`.mapWith(BigInt) })
      .from(payments)
      .where(
        and(
          eq(payments.orgId, orgId),
          inArray(payments.invoiceId, invoiceIds),
          eq(payments.method, "cash"),
        ),
      ),
    tx
      .select({ amount: sql<bigint>`coalesce(sum(${refunds.amount}), 0)::bigint`.mapWith(BigInt) })
      .from(refunds)
      .where(
        and(
          eq(refunds.orgId, orgId),
          eq(refunds.method, "cash"),
          or(inArray(refunds.advanceReceiptId, receiptIds), inArray(refunds.invoiceId, invoiceIds)),
        ),
      ),
  ]);

  // SAFETY: an aggregate without GROUP BY returns exactly one row.
  const held = deposited!.amount + paid!.amount - refunded!.amount;

  if (held + adding >= IPD_CASH_LIMIT) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "Cash for one stay must stay under ₹2,00,000. Take the rest by UPI, card or bank transfer.",
    });
  }
}
