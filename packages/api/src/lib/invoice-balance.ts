import { db } from "@hms/db";
import { advanceAllocations } from "@hms/db/schema/advance-allocations";
import { creditNotes } from "@hms/db/schema/credit-notes";
import { invoices } from "@hms/db/schema/invoices";
import { payments } from "@hms/db/schema/payments";
import { refunds } from "@hms/db/schema/refunds";
import { inArray, sql, type SQLWrapper } from "drizzle-orm";

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

// For whole-org reads (worklist, register totals and exports): each money table is summed
// once per invoice and hash-joined, instead of correlated sums re-run per invoice: 5.7 s
// became 0.25 s for 95k invoices. One `union all` aggregate looked simpler but hides its
// row count from the planner, which then rescans it per invoice.
export function invoiceMovements(orgId: string) {
  const sumByInvoice = (
    table: typeof payments | typeof advanceAllocations | typeof creditNotes | typeof refunds,
    amount: SQLWrapper,
  ) => sql`(select ${table.invoiceId} as invoice_id, sum(${amount}) as amount
    from ${table} where ${table.orgId} = ${orgId} group by ${table.invoiceId})`;

  return {
    movements: sql`(select ${invoices.id} as invoice_id,
        coalesce(credited.amount, 0)::bigint as credited,
        coalesce(paid.amount, 0)::bigint as paid,
        coalesce(allocated.amount, 0)::bigint as allocated,
        coalesce(refunded.amount, 0)::bigint as refunded
      from ${invoices}
      left join ${sumByInvoice(creditNotes, creditNotes.total)} credited
        on credited.invoice_id = ${invoices.id}
      left join ${sumByInvoice(payments, payments.amount)} paid on paid.invoice_id = ${invoices.id}
      left join ${sumByInvoice(advanceAllocations, advanceAllocations.amount)} allocated
        on allocated.invoice_id = ${invoices.id}
      left join ${sumByInvoice(refunds, refunds.amount)} refunded on refunded.invoice_id = ${invoices.id}
      where ${invoices.orgId} = ${orgId}) movements`,
    joinOn: sql`movements.invoice_id = ${invoices.id}`,
  };
}
