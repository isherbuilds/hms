import { db } from "@hms/db";
import { creditNotes } from "@hms/db/schema/credit-notes";
import { payments } from "@hms/db/schema/payments";
import { refunds } from "@hms/db/schema/refunds";
import { inArray, sql } from "drizzle-orm";

import { calculateInvoiceBalance, type InvoiceBalance } from "./invoice-math";

type BillingExecutor = Pick<typeof db, "execute">;

type BalanceInvoice = {
  id: string;
  grandTotal: string;
};

export async function invoiceBalancesFor(
  executor: BillingExecutor,
  orgId: string,
  balanceInvoices: readonly BalanceInvoice[],
): Promise<Map<string, InvoiceBalance>> {
  if (balanceInvoices.length === 0) return new Map();

  const invoiceIds = balanceInvoices.map((invoice) => invoice.id);
  const totals = await executor.execute<{
    invoiceId: string;
    creditTotal: string;
    paymentsTotal: string;
    refundsTotal: string;
  }>(sql`
    with movements as (
      select ${creditNotes.invoiceId} as invoice_id,
             ${creditNotes.total} as credit,
             0::numeric as payment,
             0::numeric as refund
      from ${creditNotes}
      where ${creditNotes.orgId} = ${orgId}
        and ${inArray(creditNotes.invoiceId, invoiceIds)}
      union all
      select ${payments.invoiceId}, 0::numeric, ${payments.amount}, 0::numeric
      from ${payments}
      where ${payments.orgId} = ${orgId}
        and ${inArray(payments.invoiceId, invoiceIds)}
      union all
      select ${refunds.invoiceId}, 0::numeric, 0::numeric, ${refunds.amount}
      from ${refunds}
      where ${refunds.orgId} = ${orgId}
        and ${inArray(refunds.invoiceId, invoiceIds)}
    )
    select invoice_id as "invoiceId",
           coalesce(sum(credit), 0)::text as "creditTotal",
           coalesce(sum(payment), 0)::text as "paymentsTotal",
           coalesce(sum(refund), 0)::text as "refundsTotal"
    from movements
    group by invoice_id
  `);
  const totalsByInvoice = new Map(totals.rows.map((row) => [row.invoiceId, row]));

  return new Map(
    balanceInvoices.map((invoice) => [
      invoice.id,
      calculateInvoiceBalance({
        grandTotal: invoice.grandTotal,
        credits: [totalsByInvoice.get(invoice.id)?.creditTotal ?? "0"],
        payments: [totalsByInvoice.get(invoice.id)?.paymentsTotal ?? "0"],
        refunds: [totalsByInvoice.get(invoice.id)?.refundsTotal ?? "0"],
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
