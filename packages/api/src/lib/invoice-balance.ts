import { db } from "@hms/db";
import { creditNotes } from "@hms/db/schema/credit-notes";
import { payments } from "@hms/db/schema/payments";
import { refunds } from "@hms/db/schema/refunds";
import { and, eq, inArray } from "drizzle-orm";

import { calculateInvoiceBalance, type InvoiceBalance } from "./invoice-math";

type BillingExecutor = Pick<typeof db, "select">;

type BalanceInvoice = {
  id: string;
  grandTotal: string;
};

function appendAmount(amounts: Map<string, string[]>, invoiceId: string, amount: string): void {
  const invoiceAmounts = amounts.get(invoiceId) ?? [];
  invoiceAmounts.push(amount);
  amounts.set(invoiceId, invoiceAmounts);
}

export async function invoiceBalancesFor(
  executor: BillingExecutor,
  orgId: string,
  balanceInvoices: readonly BalanceInvoice[],
): Promise<Map<string, InvoiceBalance>> {
  if (balanceInvoices.length === 0) return new Map();

  const invoiceIds = balanceInvoices.map((invoice) => invoice.id);
  // This executor may be a transaction client. node-postgres requires its
  // queries to stay serial even when the reads are logically independent.
  const invoiceCreditNotes = await executor
    .select({ invoiceId: creditNotes.invoiceId, amount: creditNotes.total })
    .from(creditNotes)
    .where(and(eq(creditNotes.orgId, orgId), inArray(creditNotes.invoiceId, invoiceIds)));
  const invoicePayments = await executor
    .select({ invoiceId: payments.invoiceId, amount: payments.amount })
    .from(payments)
    .where(and(eq(payments.orgId, orgId), inArray(payments.invoiceId, invoiceIds)));
  const invoiceRefunds = await executor
    .select({ invoiceId: refunds.invoiceId, amount: refunds.amount })
    .from(refunds)
    .where(and(eq(refunds.orgId, orgId), inArray(refunds.invoiceId, invoiceIds)));

  const creditsByInvoice = new Map<string, string[]>();
  const paymentsByInvoice = new Map<string, string[]>();
  const refundsByInvoice = new Map<string, string[]>();
  for (const row of invoiceCreditNotes) appendAmount(creditsByInvoice, row.invoiceId, row.amount);
  for (const row of invoicePayments) appendAmount(paymentsByInvoice, row.invoiceId, row.amount);
  for (const row of invoiceRefunds) appendAmount(refundsByInvoice, row.invoiceId, row.amount);

  return new Map(
    balanceInvoices.map((invoice) => [
      invoice.id,
      calculateInvoiceBalance({
        grandTotal: invoice.grandTotal,
        credits: creditsByInvoice.get(invoice.id) ?? [],
        payments: paymentsByInvoice.get(invoice.id) ?? [],
        refunds: refundsByInvoice.get(invoice.id) ?? [],
      }),
    ]),
  );
}

export async function invoiceBalanceFor(
  executor: BillingExecutor,
  orgId: string,
  invoice: BalanceInvoice,
): Promise<InvoiceBalance> {
  const balance = (await invoiceBalancesFor(executor, orgId, [invoice])).get(invoice.id);
  if (!balance) throw new Error(`Balance missing for invoice ${invoice.id}`);
  return balance;
}
