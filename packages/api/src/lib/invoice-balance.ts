import { db } from "@hms/db";
import { advanceAllocations } from "@hms/db/schema/advance-allocations";
import { creditNotes } from "@hms/db/schema/credit-notes";
import { payments } from "@hms/db/schema/payments";
import { refunds } from "@hms/db/schema/refunds";
import { inArray, sql } from "drizzle-orm";

import { calculateInvoiceBalance, type InvoiceBalance } from "./invoice-math";

type BillingExecutor = Pick<typeof db, "execute">;

type BalanceInvoice = {
  id: string;
  grandTotal: bigint;
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
    allocationsTotal: string;
    refundsTotal: string;
  }>(sql`
    with movements as (
      select ${creditNotes.invoiceId} as invoice_id,
             ${creditNotes.total} as credit,
             0::bigint as payment,
             0::bigint as allocation,
             0::bigint as refund
      from ${creditNotes}
      where ${creditNotes.orgId} = ${orgId}
        and ${inArray(creditNotes.invoiceId, invoiceIds)}
      union all
      select ${payments.invoiceId}, 0::bigint, ${payments.amount}, 0::bigint, 0::bigint
      from ${payments}
      where ${payments.orgId} = ${orgId}
        and ${inArray(payments.invoiceId, invoiceIds)}
      union all
      select ${advanceAllocations.invoiceId}, 0::bigint, 0::bigint, ${advanceAllocations.amount}, 0::bigint
      from ${advanceAllocations}
      where ${advanceAllocations.orgId} = ${orgId}
        and ${inArray(advanceAllocations.invoiceId, invoiceIds)}
      union all
      select ${refunds.invoiceId}, 0::bigint, 0::bigint, 0::bigint, ${refunds.amount}
      from ${refunds}
      where ${refunds.orgId} = ${orgId}
        and ${inArray(refunds.invoiceId, invoiceIds)}
    )
    select invoice_id as "invoiceId",
           coalesce(sum(credit), 0)::bigint as "creditTotal",
           coalesce(sum(payment), 0)::bigint as "paymentsTotal",
           coalesce(sum(allocation), 0)::bigint as "allocationsTotal",
           coalesce(sum(refund), 0)::bigint as "refundsTotal"
    from movements
    group by invoice_id
  `);

  const totalsByInvoice = new Map(totals.rows.map((row) => [row.invoiceId, row]));

  return new Map(
    balanceInvoices.map((invoice) => {
      const movementTotals = totalsByInvoice.get(invoice.id);

      return [
        invoice.id,
        calculateInvoiceBalance({
          grandTotal: invoice.grandTotal,
          creditTotal: BigInt(movementTotals?.creditTotal ?? "0"),
          paymentsTotal: BigInt(movementTotals?.paymentsTotal ?? "0"),
          allocationsTotal: BigInt(movementTotals?.allocationsTotal ?? "0"),
          refundsTotal: BigInt(movementTotals?.refundsTotal ?? "0"),
        }),
      ] as const;
    }),
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
