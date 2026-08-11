import { db } from "@hms/db";
import { member } from "@hms/db/schema/auth";
import { charges } from "@hms/db/schema/charges";
import { departments } from "@hms/db/schema/departments";
import { file } from "@hms/db/schema/file";
import { payments } from "@hms/db/schema/payments";
import { visits } from "@hms/db/schema/visits";
import { sql } from "drizzle-orm";

import { orgInput, orgProcedure } from "../lib/procedures/factory";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC day the queue and the collection totals are both measured against. */
function dayBounds(): { start: Date; end: Date } {
  const start = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

export const dashboardRouter = {
  summary: orgProcedure(
    {
      member: ["read"],
      storage: ["read"],
    },
    orgInput,
  ).handler(async ({ context }) => {
    const { orgId } = context.scope;
    const result = await db.execute<{ files: number; people: number }>(sql`
        select
          (select count(*)::integer from ${file}
            where ${file.orgId} = ${orgId} and ${file.status} = 'ready') as "files",
          (select count(*)::integer from ${member}
            where ${member.organizationId} = ${orgId}) as "people"
      `);
    const summary = result.rows[0];

    if (!summary) {
      throw new Error("Dashboard summary query returned no row");
    }
    return summary;
  }),

  /**
   * Today's clinical shape: how many are waiting, how many are in a room, and
   * which departments the day is actually going to. Separate from `collections`
   * so a role that may read visits but not money still gets a dashboard.
   */
  today: orgProcedure({ visit: ["read"] }, orgInput).handler(async ({ context }) => {
    const { orgId } = context.scope;
    const { start, end } = dayBounds();

    const [counts, mix] = await Promise.all([
      db.execute<{ waiting: number; inConsult: number; completed: number; longestWaitMin: number }>(
        sql`
          select
            count(*) filter (where ${visits.status} = 'waiting')::integer as "waiting",
            count(*) filter (where ${visits.status} = 'in_consult')::integer as "inConsult",
            count(*) filter (where ${visits.status} = 'completed')::integer as "completed",
            coalesce(
              max(extract(epoch from (now() - ${visits.createdAt})))
                filter (where ${visits.status} = 'waiting'),
              0
            )::integer / 60 as "longestWaitMin"
          from ${visits}
          where ${visits.orgId} = ${orgId}
            and ${visits.createdAt} >= ${start} and ${visits.createdAt} < ${end}
        `,
      ),
      db.execute<{ department: string; count: number }>(sql`
          select coalesce(${departments.name}, 'Unassigned') as "department",
                 count(*)::integer as "count"
          from ${visits}
          left join ${departments}
            on ${departments.id} = ${visits.departmentId}
           and ${departments.orgId} = ${orgId}
          where ${visits.orgId} = ${orgId}
            and ${visits.createdAt} >= ${start} and ${visits.createdAt} < ${end}
            and ${visits.status} <> 'cancelled'
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
   * What the desk has taken today and what is still owed. Amounts are returned
   * as strings: they are `numeric` in Postgres, and rounding them through a JS
   * float on the way out would be a money bug waiting to happen.
   */
  collections: orgProcedure({ billing: ["read"] }, orgInput).handler(async ({ context }) => {
    const { orgId } = context.scope;
    const { start, end } = dayBounds();

    const result = await db.execute<{
      collected: string;
      cash: string;
      upi: string;
      card: string;
      unbilled: string;
      unbilledVisits: number;
    }>(sql`
        select
          (select coalesce(sum(${payments.amount}), 0)::text from ${payments}
            where ${payments.orgId} = ${orgId}
              and ${payments.createdAt} >= ${start} and ${payments.createdAt} < ${end}) as "collected",
          (select coalesce(sum(${payments.amount}), 0)::text from ${payments}
            where ${payments.orgId} = ${orgId} and ${payments.method} = 'cash'
              and ${payments.createdAt} >= ${start} and ${payments.createdAt} < ${end}) as "cash",
          (select coalesce(sum(${payments.amount}), 0)::text from ${payments}
            where ${payments.orgId} = ${orgId} and ${payments.method} = 'upi'
              and ${payments.createdAt} >= ${start} and ${payments.createdAt} < ${end}) as "upi",
          (select coalesce(sum(${payments.amount}), 0)::text from ${payments}
            where ${payments.orgId} = ${orgId} and ${payments.method} = 'card'
              and ${payments.createdAt} >= ${start} and ${payments.createdAt} < ${end}) as "card",
          (select coalesce(sum(${charges.unitPrice} * ${charges.qty}), 0)::text from ${charges}
            where ${charges.orgId} = ${orgId} and ${charges.status} = 'pending') as "unbilled",
          (select count(distinct ${charges.visitId})::integer from ${charges}
            where ${charges.orgId} = ${orgId} and ${charges.status} = 'pending') as "unbilledVisits"
      `);

    const totals = result.rows[0];
    if (!totals) {
      throw new Error("Dashboard collections query returned no row");
    }

    // Fourteen days including today, gap-filled: a day with no payments must
    // plot as a zero-height bar, not vanish and silently compress the axis.
    const trend = await db.execute<{ day: string; amount: string }>(sql`
        select to_char(days.day, 'YYYY-MM-DD') as "day",
               coalesce(sum(${payments.amount}), 0)::text as "amount"
        from generate_series(${start}::timestamptz - interval '13 days', ${start}::timestamptz, interval '1 day') as days(day)
        left join ${payments}
          on ${payments.orgId} = ${orgId}
         and ${payments.createdAt} >= days.day
         and ${payments.createdAt} < days.day + interval '1 day'
        group by days.day
        order by days.day asc
      `);

    return { ...totals, trend: trend.rows };
  }),
};
