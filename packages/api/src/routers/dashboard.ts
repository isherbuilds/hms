import { db } from "@hms/db";
import { charges } from "@hms/db/schema/charges";
import { departments } from "@hms/db/schema/departments";
import { payments } from "@hms/db/schema/payments";
import { opdAppointments } from "@hms/db/schema/opd-appointments";
import { sql } from "drizzle-orm";

import { businessDate, businessDayWindow } from "../lib/business-date";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { readOrgSettings } from "../lib/settings-cache";

export const dashboardRouter = {
  /**
   * The organization's local clinical day: how many are waiting, how many are
   * in a room, and which departments the day is going to. Separate from
   * `collections` so a role that may read OPD appointments but not money still gets a
   * dashboard.
   */
  today: orgProcedure({ opd: ["read"] }, orgInput).handler(async ({ context }) => {
    const { orgId } = context.scope;
    const { timeZone } = await readOrgSettings(orgId);
    const currentDay = businessDate(new Date(), timeZone);

    // Both queries window on `businessDate`, which check-in (or walk-in
    // creation) sets to the arrival day — a booking created yesterday for
    // today belongs to today, and a booking for next week does not.
    const [counts, mix] = await Promise.all([
      db.execute<{ waiting: number; inConsult: number; completed: number; longestWaitMin: number }>(
        sql`
          select
            count(*) filter (where ${opdAppointments.status} = 'waiting')::integer as "waiting",
            count(*) filter (where ${opdAppointments.status} = 'in_consult')::integer as "inConsult",
            count(*) filter (where ${opdAppointments.status} = 'completed')::integer as "completed",
            coalesce(
              max(extract(epoch from (now() - ${opdAppointments.arrivedAt})))
                filter (where ${opdAppointments.status} = 'waiting'),
              0
            )::integer / 60 as "longestWaitMin"
          from ${opdAppointments}
          where ${opdAppointments.orgId} = ${orgId}
            and ${opdAppointments.businessDate} = ${currentDay}
        `,
      ),
      // The mix counts arrived attendance only: a `booked` row for today may
      // still cancel or no-show, and `cancelled`/`no_show` work never happened.
      db.execute<{ department: string; count: number }>(sql`
          select coalesce(${departments.name}, 'Unassigned') as "department",
                 count(*)::integer as "count"
          from ${opdAppointments}
          left join ${departments}
            on ${departments.id} = ${opdAppointments.departmentId}
           and ${departments.orgId} = ${orgId}
          where ${opdAppointments.orgId} = ${orgId}
            and ${opdAppointments.businessDate} = ${currentDay}
            and ${opdAppointments.status} in ('waiting', 'in_consult', 'completed', 'left_unseen')
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

  /**
   * What the desk has taken on the organization's local day and what is still
   * owed. Amounts are strings because Postgres stores them as `numeric`.
   * Converting them through a JavaScript float would cause money errors.
   */
  collections: orgProcedure({ billing: ["read"] }, orgInput).handler(async ({ context }) => {
    const { orgId } = context.scope;
    const { timeZone } = await readOrgSettings(orgId);
    const currentDay = businessDate(new Date(), timeZone);
    const { start, end } = businessDayWindow(currentDay, timeZone);

    // The two statements are independent, so they go out together. The totals
    // split the day's takings by method with `filter` clauses instead of one
    // subselect per method, so `payments` is scanned once rather than four
    // times. The charges subselects stay scalar: they read another table and a
    // different predicate (pending, no date window).
    const [result, trend] = await Promise.all([
      db.execute<{
        collected: string;
        cash: string;
        upi: string;
        card: string;
        unbilled: string;
        unbilledOpdAppointments: number;
      }>(sql`
        select
          coalesce(sum(${payments.amount}), 0)::text as "collected",
          coalesce(sum(${payments.amount}) filter (where ${payments.method} = 'cash'), 0)::text as "cash",
          coalesce(sum(${payments.amount}) filter (where ${payments.method} = 'upi'), 0)::text as "upi",
          coalesce(sum(${payments.amount}) filter (where ${payments.method} = 'card'), 0)::text as "card",
          (select coalesce(sum(${charges.unitPrice} * ${charges.qty}), 0)::text from ${charges}
            where ${charges.orgId} = ${orgId} and ${charges.status} = 'pending') as "unbilled",
          (select count(distinct ${charges.opdAppointmentId})::integer from ${charges}
            where ${charges.orgId} = ${orgId} and ${charges.status} = 'pending') as "unbilledOpdAppointments"
        from ${payments}
        where ${payments.orgId} = ${orgId}
          and ${payments.createdAt} >= ${start} and ${payments.createdAt} < ${end}
      `),
      // Fourteen days including today, gap-filled: a day with no payments must
      // plot as a zero-height bar, not vanish and silently compress the axis.
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
         and ${payments.createdAt} >= days.day::timestamp at time zone ${timeZone}
         and ${payments.createdAt} < (days.day + 1)::timestamp at time zone ${timeZone}
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
