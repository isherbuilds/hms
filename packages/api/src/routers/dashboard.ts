import { db } from "@hms/db";
import { charges } from "@hms/db/schema/charges";
import { departments } from "@hms/db/schema/departments";
import { payments } from "@hms/db/schema/payments";
import { opdAppointments } from "@hms/db/schema/opd-appointments";
import { sql } from "drizzle-orm";

import { businessDate } from "../lib/business-date";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { readOrgSettings } from "../lib/settings-cache";

export const dashboardRouter = {
  today: orgProcedure({ opd: ["read"] }, orgInput).handler(async ({ context }) => {
    const { orgId } = context.scope;
    const { timeZone } = await readOrgSettings(orgId);
    const currentDay = businessDate(new Date(), timeZone);

    // `businessDate` is the arrival day, so a booking made yesterday for today counts today.
    const [counts, mix] = await Promise.all([
      db.execute<{ checkedIn: number; booked: number }>(
        sql`
          select
            count(*) filter (where ${opdAppointments.status} = 'checked_in')::integer as "checkedIn",
            count(*) filter (where ${opdAppointments.status} = 'booked')::integer as "booked"
          from ${opdAppointments}
          where ${opdAppointments.orgId} = ${orgId}
            and ${opdAppointments.businessDate} = ${currentDay}
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
            and ${opdAppointments.businessDate} = ${currentDay}
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

  // Amounts stay strings: Postgres stores them as `numeric`, and a JavaScript float
  // would cause money errors.
  collections: orgProcedure({ billing: ["read"] }, orgInput).handler(async ({ context }) => {
    const { orgId } = context.scope;
    const { timeZone, unbilledAlertHours } = await readOrgSettings(orgId);
    const currentDay = businessDate(new Date(), timeZone);
    const unbilledBefore = new Date(Date.now() - unbilledAlertHours * 3_600_000);

    // `filter` clauses split the day's takings by method in one scan of `payments`
    // rather than a subselect per method.
    const [result, trend] = await Promise.all([
      db.execute<{
        collected: string;
        cash: string;
        upi: string;
        card: string;
        unbilled: string;
        unbilledOpdAppointments: number;
      }>(sql`
        with unbilled_appointments as (
          select sum(${charges.unitPrice} * ${charges.qty}) as pending_value
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
        select
          coalesce(sum(${payments.amount}), 0)::text as "collected",
          coalesce(sum(${payments.amount}) filter (where ${payments.method} = 'cash'), 0)::text as "cash",
          coalesce(sum(${payments.amount}) filter (where ${payments.method} = 'upi'), 0)::text as "upi",
          coalesce(sum(${payments.amount}) filter (where ${payments.method} = 'card'), 0)::text as "card",
          (select coalesce(sum(pending_value), 0)::text
            from unbilled_appointments) as "unbilled",
          (select count(*)::integer
            from unbilled_appointments) as "unbilledOpdAppointments"
        from ${payments}
        where ${payments.orgId} = ${orgId}
          and ${payments.businessDate} = ${currentDay}
      `),
      // Gap-filled: a day with no payments must plot as zero, not compress the axis.
      db.execute<{ day: string; amount: string }>(sql`
        with days as (
          select (${currentDay}::date - series.days_ago)::date as day
          from generate_series(13, 0, -1) as series(days_ago)
        )
        select to_char(days.day, 'YYYY-MM-DD') as "day",
               coalesce(sum(${payments.amount}), 0)::text as "amount"
        from days
        left join ${payments}
          on ${payments.orgId} = ${orgId}
         and ${payments.businessDate} = days.day
        group by days.day
        order by days.day asc
      `),
    ]);

    const totals = result.rows[0];
    if (!totals) {
      throw new Error("Dashboard collections query returned no row");
    }

    return { ...totals, trend: trend.rows };
  }),
};
