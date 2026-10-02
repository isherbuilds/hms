import { db } from "@hms/db";
import { advanceReceipts } from "@hms/db/schema/advance-receipts";
import { invoices } from "@hms/db/schema/invoices";
import { payments } from "@hms/db/schema/payments";
import { refunds } from "@hms/db/schema/refunds";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { businessDate } from "../lib/business-date";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { dayRange, resolveDayRange, type PaymentMethod } from "../lib/schemas";
import { readOrgSettings } from "../lib/settings-cache";

// The window the dashboard reports on: today unless the operator widened it.
const dayInput = orgInput.extend(dayRange);

const USUAL_WEEKS = 8;

type Day = { day: string; amount: bigint; cash: bigint; digital: bigint };

/**
 * Net collection per day for `days` days ending on `end`, oldest first. Gap-filled:
 * a day with no payments plots as zero rather than compressing the axis. Money in
 * is split cash against digital; the amount is net of refunds.
 */
async function dailySeries(orgId: string, end: SQL, days: number): Promise<Day[]> {
  const start = sql`(${end}) - ${days - 1}::int`;

  const result = await db.execute<{ day: string; amount: string; cash: string; digital: string }>(
    sql`
        with days as (
          select ((${end}) - series.days_ago)::date as day
          from generate_series(${days - 1}::int, 0, -1) as series(days_ago)
        ), collections as (
          select ${payments.businessDate} as day, ${payments.method} as method,
                 'in'::text as kind, ${payments.amount} as amount
          from ${payments}
          where ${payments.orgId} = ${orgId}
            and ${payments.businessDate} between ${start} and ${end}
          union all
          select ${advanceReceipts.businessDate}, ${advanceReceipts.method}, 'in',
                 ${advanceReceipts.amount}
          from ${advanceReceipts}
          where ${advanceReceipts.orgId} = ${orgId}
            and ${advanceReceipts.businessDate} between ${start} and ${end}
          union all
          select ${refunds.businessDate}, ${refunds.method}, 'out', ${refunds.amount}
          from ${refunds}
          where ${refunds.orgId} = ${orgId}
            and ${refunds.businessDate} between ${start} and ${end}
        )
        select to_char(days.day, 'YYYY-MM-DD') as "day",
               coalesce(sum(case when kind = 'in' then amount else -amount end), 0)::bigint
                 as "amount",
               coalesce(sum(amount) filter (where kind = 'in' and method = 'cash'), 0)::bigint
                 as "cash",
               coalesce(sum(amount) filter (where kind = 'in' and method <> 'cash'), 0)::bigint
                 as "digital"
        from days
        left join collections on collections.day = days.day
        group by days.day
        order by days.day asc
      `,
  );

  return result.rows.map((row) => ({
    day: row.day,
    amount: BigInt(row.amount),
    cash: BigInt(row.cash),
    digital: BigInt(row.digital),
  }));
}

/**
 * A usual day: the mean of earlier open days on the same weekday, or of every
 * earlier open day when none share it. Closed days would drag the mean down.
 */
function usualDay(earlier: Day[], day: string) {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  const open = earlier.filter((row) => row.amount > 0n);
  const same = open.filter((row) => new Date(`${row.day}T00:00:00Z`).getUTCDay() === weekday);
  const basis = same.length > 0 ? same : open;

  if (basis.length === 0) return null;

  return {
    amount: basis.reduce((sum, row) => sum + row.amount, 0n) / BigInt(basis.length),
    sameWeekday: same.length > 0,
  };
}

export const dashboardRouter = {
  collections: orgProcedure({ billing: ["read"] }, dayInput).handler(async ({ context, input }) => {
    const { orgId } = context.scope;
    const { timeZone } = await readOrgSettings(orgId);
    const { from, to } = resolveDayRange(input, businessDate(new Date(), timeZone));

    const [byMethod, bySource, earlier] = await Promise.all([
      db.execute<{ method: PaymentMethod; amount: string }>(sql`
        with collections as (
          select ${payments.method} as method, ${payments.amount} as amount
          from ${payments}
          where ${payments.orgId} = ${orgId}
            and ${payments.businessDate} between ${from} and ${to}
          union all
          select ${advanceReceipts.method} as method, ${advanceReceipts.amount} as amount
          from ${advanceReceipts}
          where ${advanceReceipts.orgId} = ${orgId}
            and ${advanceReceipts.businessDate} between ${from} and ${to}
          union all
          select ${refunds.method} as method, -${refunds.amount} as amount
          from ${refunds}
          where ${refunds.orgId} = ${orgId}
            and ${refunds.businessDate} between ${from} and ${to}
        )
        select method, sum(amount)::bigint as "amount"
        from collections
        group by method
        order by sum(amount) desc
      `),
      // What the money was for: an invoice's stream, or an advance. A refund counts
      // against the stream of the invoice it reverses, or against advances.
      db.execute<{ source: "opd" | "pharmacy" | "advance"; amount: string }>(sql`
        with collections as (
          select ${invoices.stream} as source, ${payments.amount} as amount
          from ${payments}
          inner join ${invoices}
            on ${invoices.orgId} = ${payments.orgId}
           and ${invoices.id} = ${payments.invoiceId}
          where ${payments.orgId} = ${orgId}
            and ${payments.businessDate} between ${from} and ${to}
          union all
          select 'advance', ${advanceReceipts.amount}
          from ${advanceReceipts}
          where ${advanceReceipts.orgId} = ${orgId}
            and ${advanceReceipts.businessDate} between ${from} and ${to}
          union all
          select coalesce(${invoices.stream}, 'advance'), -${refunds.amount}
          from ${refunds}
          left join ${invoices}
            on ${invoices.orgId} = ${refunds.orgId}
           and ${invoices.id} = ${refunds.invoiceId}
          where ${refunds.orgId} = ${orgId}
            and ${refunds.businessDate} between ${from} and ${to}
        )
        select source, sum(amount)::bigint as "amount"
        from collections
        group by source
        having sum(amount) <> 0
        order by sum(amount) desc
      `),
      // Eight weeks before a single day, for its usual-day comparison.
      from === to ? dailySeries(orgId, sql`${to}::date - 1`, USUAL_WEEKS * 7) : [],
    ]);

    // The window's own total, so it follows the range rather than the trend's last bar.
    const collected = byMethod.rows.reduce((sum, row) => sum + BigInt(row.amount), 0n);

    return {
      collected,
      byMethod: byMethod.rows.map((row) => ({
        ...row,
        amount: BigInt(row.amount),
      })),
      bySource: bySource.rows.map((row) => ({
        source: row.source,
        amount: BigInt(row.amount),
      })),
      usual: usualDay(earlier, to),
    };
  }),

  // The chart's bars, loaded per range so a longer range costs only when asked for.
  // A week more than shown, so each bar can compare with the same weekday before it.
  trend: orgProcedure(
    { billing: ["read"] },
    orgInput.extend({
      to: dayRange.to,
      days: z.union([z.literal(7), z.literal(14), z.literal(30)]),
    }),
  ).handler(async ({ context, input }) => {
    const { orgId } = context.scope;
    const { timeZone } = await readOrgSettings(orgId);
    const to = input.to ?? businessDate(new Date(), timeZone);

    return dailySeries(orgId, sql`${to}::date`, input.days + 7);
  }),
};
