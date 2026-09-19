import { db } from "@hms/db";
import { advanceReceipts } from "@hms/db/schema/advance-receipts";
import { charges } from "@hms/db/schema/charges";
import { departments } from "@hms/db/schema/departments";
import { payments } from "@hms/db/schema/payments";
import { refunds } from "@hms/db/schema/refunds";
import { opdAppointments } from "@hms/db/schema/opd-appointments";
import { sql } from "drizzle-orm";

import { businessDate } from "../lib/business-date";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { dayRange, resolveDayRange, type PaymentMethod } from "../lib/schemas";
import { readOrgSettings } from "../lib/settings-cache";

// The window the dashboard reports on: today unless the operator widened it.
const dayInput = orgInput.extend(dayRange);

export const dashboardRouter = {
  today: orgProcedure({ opd: ["read"] }, dayInput).handler(async ({ context, input }) => {
    const { orgId } = context.scope;
    const { timeZone } = await readOrgSettings(orgId);
    const { from, to } = resolveDayRange(input, businessDate(new Date(), timeZone));

    // `businessDate` is the arrival day, so a booking made yesterday for today counts today.
    const [counts, mix] = await Promise.all([
      db.execute<{ checkedIn: number; booked: number }>(
        sql`
          select
            count(*) filter (where ${opdAppointments.status} = 'checked_in')::integer as "checkedIn",
            count(*) filter (where ${opdAppointments.status} = 'booked')::integer as "booked"
          from ${opdAppointments}
          where ${opdAppointments.orgId} = ${orgId}
            and ${opdAppointments.businessDate} between ${from} and ${to}
        `,
      ),
      db.execute<{ department: string; count: number }>(sql`
          select coalesce(${departments.name}, 'Unassigned') as "department",
                 count(*)::integer as "count"
          from ${opdAppointments}
          left join ${departments}
            on ${departments.id} = ${opdAppointments.departmentId}
           and ${departments.orgId} = ${orgId}
          where ${opdAppointments.orgId} = ${orgId}
            and ${opdAppointments.businessDate} between ${from} and ${to}
            and ${opdAppointments.status} = 'checked_in'
          group by 1
          order by 2 desc, 1 asc
        `),
    ]);

    const totals = counts.rows[0];

    if (!totals) {
      throw new Error("Dashboard today query returned no row");
    }

    return { ...totals, mix: mix.rows };
  }),

  collections: orgProcedure({ billing: ["read"] }, dayInput).handler(async ({ context, input }) => {
    const { orgId } = context.scope;
    const { timeZone, unbilledAlertHours } = await readOrgSettings(orgId);
    const { from, to } = resolveDayRange(input, businessDate(new Date(), timeZone));
    const unbilledBefore = new Date(Date.now() - unbilledAlertHours * 3_600_000);
    // Matches the 14-day series below; without it each arm scans the org's whole history.
    // The series always runs back from the window's last day, whatever the window is.
    const trendStart = sql`${to}::date - 13`;

    const [result, byMethod, trend] = await Promise.all([
      db.execute<{ unbilled: string }>(sql`
        with unbilled_appointments as (
          select sum(${charges.unitPrice} * ${charges.qty})::bigint as pending_value
          from ${charges}
          inner join ${opdAppointments}
            on ${opdAppointments.orgId} = ${charges.orgId}
           and ${opdAppointments.id} = ${charges.opdAppointmentId}
          where ${charges.orgId} = ${orgId}
            and ${charges.status} = 'pending'
            and ${opdAppointments.status} = 'checked_in'
          group by ${charges.opdAppointmentId}
          having min(${charges.createdAt}) < ${unbilledBefore}
        )
        select coalesce(sum(pending_value), 0)::bigint as "unbilled"
        from unbilled_appointments
      `),
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
      // Gap-filled: a day with no payments must plot as zero, not compress the axis.
      db.execute<{ day: string; amount: string }>(sql`
        with days as (
          select (${to}::date - series.days_ago)::date as day
          from generate_series(13, 0, -1) as series(days_ago)
        ), collections as (
          select ${payments.businessDate} as day, ${payments.amount} as amount
          from ${payments}
          where ${payments.orgId} = ${orgId}
            and ${payments.businessDate} between ${trendStart} and ${to}
          union all
          select ${advanceReceipts.businessDate} as day, ${advanceReceipts.amount} as amount
          from ${advanceReceipts}
          where ${advanceReceipts.orgId} = ${orgId}
            and ${advanceReceipts.businessDate} between ${trendStart} and ${to}
          union all
          select ${refunds.businessDate} as day, -${refunds.amount} as amount
          from ${refunds}
          where ${refunds.orgId} = ${orgId}
            and ${refunds.businessDate} between ${trendStart} and ${to}
        )
        select to_char(days.day, 'YYYY-MM-DD') as "day",
               coalesce(sum(collections.amount), 0)::bigint as "amount"
        from days
        left join collections on collections.day = days.day
        group by days.day
        order by days.day asc
      `),
    ]);

    const totals = result.rows[0];

    if (!totals) {
      throw new Error("Dashboard collections query returned no row");
    }

    // The window's own total, so it follows the range rather than the trend's last bar.
    const collected = byMethod.rows.reduce((sum, row) => sum + BigInt(row.amount), 0n);

    return {
      collected,
      unbilled: BigInt(totals.unbilled),
      byMethod: byMethod.rows.map((row) => ({
        ...row,
        amount: BigInt(row.amount),
      })),
      trend: trend.rows.map((row) => ({
        ...row,
        amount: BigInt(row.amount),
      })),
    };
  }),
};
