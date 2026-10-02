import { db } from "@hms/db";
import { advanceReceipts } from "@hms/db/schema/advance-receipts";
import { invoices } from "@hms/db/schema/invoices";
import { opdAppointments } from "@hms/db/schema/opd-appointments";
import { patients } from "@hms/db/schema/patients";
import { practitioners } from "@hms/db/schema/practitioners";
import { departments } from "@hms/db/schema/departments";
import { payments } from "@hms/db/schema/payments";
import { refunds } from "@hms/db/schema/refunds";
import { and, asc, between, eq, inArray, sql, sum, type SQL } from "drizzle-orm";
import { z } from "zod";

import { closeExpiredBookings } from "../lib/opd-close";
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
 * and its cash/digital split are net of refunds.
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
               coalesce(sum(case when kind = 'in' then amount else -amount end) filter (where method = 'cash'), 0)::bigint
                 as "cash",
               coalesce(sum(case when kind = 'in' then amount else -amount end) filter (where method <> 'cash'), 0)::bigint
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
  queue: orgProcedure({ opd: ["read"] }, dayInput).handler(async ({ context, input }) => {
    const { orgId, userId } = context.scope;
    const { timeZone } = await readOrgSettings(orgId);
    const now = new Date();
    const currentDay = businessDate(now, timeZone);
    const { from, to } = resolveDayRange(input, currentDay);

    if (from < currentDay) {
      await closeExpiredBookings({ orgId, actorId: userId, currentDay, now });
    }

    const scope = and(
      eq(opdAppointments.orgId, orgId),
      between(opdAppointments.businessDate, from, to),
    );

    const [counts, waiting] = await Promise.all([
      db
        .select({
          departmentId: departments.id,
          departmentName: departments.name,
          arrived: sql<number>`count(*) filter (where ${opdAppointments.status} = 'checked_in')::int`,
          booked: sql<number>`count(*) filter (where ${opdAppointments.status} = 'booked')::int`,
          nextBookedAt: sql<
            string | null
          >`min(${opdAppointments.dayOrderAt}) filter (where ${opdAppointments.status} = 'booked')`,
        })
        .from(opdAppointments)
        .innerJoin(
          departments,
          and(eq(departments.id, opdAppointments.departmentId), eq(departments.orgId, orgId)),
        )
        .where(and(scope, inArray(opdAppointments.status, ["booked", "checked_in"])))
        .groupBy(departments.id, departments.name),
      db
        .select({
          id: opdAppointments.id,
          callerName: opdAppointments.callerName,
          tokenNumber: opdAppointments.tokenNumber,
          dayOrderAt: opdAppointments.dayOrderAt,
          patientName: patients.name,
          patientMrn: patients.mrn,
          practitionerName: practitioners.name,
          departmentName: departments.name,
        })
        .from(opdAppointments)
        .leftJoin(
          patients,
          and(eq(patients.id, opdAppointments.patientId), eq(patients.orgId, orgId)),
        )
        .innerJoin(
          practitioners,
          and(eq(practitioners.id, opdAppointments.practitionerId), eq(practitioners.orgId, orgId)),
        )
        .innerJoin(
          departments,
          and(eq(departments.id, opdAppointments.departmentId), eq(departments.orgId, orgId)),
        )
        .where(and(scope, eq(opdAppointments.status, "checked_in")))
        .orderBy(asc(opdAppointments.dayOrderAt), asc(opdAppointments.id))
        .limit(20),
    ]);

    const bookedTimes = counts.flatMap((row) =>
      row.nextBookedAt ? [new Date(row.nextBookedAt).getTime()] : [],
    );

    return {
      arrived: counts.reduce((sum, row) => sum + row.arrived, 0),
      booked: counts.reduce((sum, row) => sum + row.booked, 0),
      nextBookedAt: bookedTimes.length ? new Date(Math.min(...bookedTimes)) : null,
      departments: counts.map(({ departmentId, departmentName, arrived, booked }) => ({
        departmentId,
        departmentName,
        arrived,
        booked,
      })),
      waiting,
      now,
    };
  }),
  collections: orgProcedure({ billing: ["read"] }, dayInput).handler(async ({ context, input }) => {
    const { orgId } = context.scope;
    const { timeZone } = await readOrgSettings(orgId);
    const { from, to } = resolveDayRange(input, businessDate(new Date(), timeZone));

    // Read the money movements once; both breakdowns use the same signed totals.
    const movements = db.$with("movements").as(
      db
        .select({
          method: payments.method,
          source: sql<"opd" | "pharmacy" | "advance">`${invoices.stream}`.as("source"),
          amount: payments.amount,
        })
        .from(payments)
        .innerJoin(invoices, and(eq(invoices.orgId, orgId), eq(invoices.id, payments.invoiceId)))
        .where(and(eq(payments.orgId, orgId), between(payments.businessDate, from, to)))
        .unionAll(
          db
            .select({
              method: advanceReceipts.method,
              source: sql<"opd" | "pharmacy" | "advance">`'advance'`,
              amount: advanceReceipts.amount,
            })
            .from(advanceReceipts)
            .where(
              and(
                eq(advanceReceipts.orgId, orgId),
                between(advanceReceipts.businessDate, from, to),
              ),
            ),
        )
        .unionAll(
          db
            .select({
              method: refunds.method,
              source: sql<"opd" | "pharmacy" | "advance">`coalesce(${invoices.stream}, 'advance')`,
              amount: sql<bigint>`-${refunds.amount}`,
            })
            .from(refunds)
            .leftJoin(invoices, and(eq(invoices.orgId, orgId), eq(invoices.id, refunds.invoiceId)))
            .where(and(eq(refunds.orgId, orgId), between(refunds.businessDate, from, to))),
        ),
    );

    const [totals, earlier] = await Promise.all([
      db
        .with(movements)
        .select({
          method: movements.method,
          source: movements.source,
          amount: sum(movements.amount).mapWith(BigInt),
        })
        .from(movements)
        .groupBy(movements.method, movements.source),
      !input.from && !input.to ? dailySeries(orgId, sql`${to}::date - 1`, USUAL_WEEKS * 7) : [],
    ]);

    const methods = new Map<PaymentMethod, bigint>();
    const sources = new Map<"opd" | "pharmacy" | "advance", bigint>();

    for (const row of totals) {
      methods.set(row.method, (methods.get(row.method) ?? 0n) + row.amount);
      sources.set(row.source, (sources.get(row.source) ?? 0n) + row.amount);
    }

    const descending = (a: { amount: bigint }, b: { amount: bigint }) =>
      a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : 0;

    return {
      collected: totals.reduce((total, row) => total + row.amount, 0n),
      byMethod: [...methods].map(([method, amount]) => ({ method, amount })).sort(descending),
      bySource: [...sources]
        .flatMap(([source, amount]) => (amount !== 0n ? [{ source, amount }] : []))
        .sort(descending),
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
