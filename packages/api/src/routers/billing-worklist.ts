import { db } from "@hms/db";
import { advanceAllocations } from "@hms/db/schema/advance-allocations";
import { advanceReceipts } from "@hms/db/schema/advance-receipts";
import { charges } from "@hms/db/schema/charges";
import { creditNotes } from "@hms/db/schema/credit-notes";
import { invoices } from "@hms/db/schema/invoices";
import { opdAppointments } from "@hms/db/schema/opd-appointments";
import { patients } from "@hms/db/schema/patients";
import { payments } from "@hms/db/schema/payments";
import { practitioners } from "@hms/db/schema/practitioners";
import { refunds } from "@hms/db/schema/refunds";
import { treatmentPlans } from "@hms/db/schema/treatment-plans";
import { and, asc, eq, gt, ilike, lt, or, sql, type SQLWrapper } from "drizzle-orm";
import { z } from "zod";

import { advanceRemaining } from "../lib/advance-credit";
import { businessDate } from "../lib/business-date";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { likePattern, pageLimit, searchQuery } from "../lib/schemas";
import { readOrgSettings } from "../lib/settings-cache";

// `worklist` polls pending charges for checked-in visits, all open invoice totals,
// and today's collections. `openInvoices` grows forever, so it pages on a keyset.

const OVERDUE_DAYS = 7;

const STALE_DAYS = 30;

// Each money table is summed once per invoice and hash-joined, instead of correlated
// sums re-run per invoice for every reference to the balance: 5.7 s became 0.25 s for
// 95k invoices. One `union all` aggregate looked simpler but hides its row count from
// the planner, which then rescans it per invoice. Credit applied from an advance settles
// an invoice as cash does, so it counts as paid, as in `opdRegister`.
function invoiceBalances(orgId: string) {
  const sumByInvoice = (
    table: typeof payments | typeof advanceAllocations | typeof creditNotes | typeof refunds,
    amount: SQLWrapper,
  ) => sql`(select ${table.invoiceId} as invoice_id, sum(${amount}) as amount
    from ${table} where ${table.orgId} = ${orgId} group by ${table.invoiceId})`;

  return {
    movements: sql`(select ${invoices.id} as invoice_id,
        (coalesce(paid.amount, 0) + coalesce(allocated.amount, 0))::bigint as paid,
        (coalesce(paid.amount, 0) + coalesce(allocated.amount, 0) + coalesce(credited.amount, 0)
          - coalesce(refunded.amount, 0))::bigint as settles
      from ${invoices}
      left join ${sumByInvoice(payments, payments.amount)} paid on paid.invoice_id = ${invoices.id}
      left join ${sumByInvoice(advanceAllocations, advanceAllocations.amount)} allocated
        on allocated.invoice_id = ${invoices.id}
      left join ${sumByInvoice(creditNotes, creditNotes.total)} credited
        on credited.invoice_id = ${invoices.id}
      left join ${sumByInvoice(refunds, refunds.amount)} refunded on refunded.invoice_id = ${invoices.id}
      where ${invoices.orgId} = ${orgId}) movements`,
    joinOn: sql`movements.invoice_id = ${invoices.id}`,
    paid: sql<bigint>`coalesce(movements.paid, 0)::bigint`,
    settled: sql<bigint>`(${invoices.grandTotal} - coalesce(movements.settles, 0))::bigint`,
  };
}

const daysAgo = (count: number) => new Date(Date.now() - count * 86_400_000);

export const billingWorklistRouter = {
  worklist: orgProcedure(
    { billing: ["read"] },
    orgInput.extend({
      query: searchQuery,
      limit: z.number().int().min(1).max(200).default(50),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const settings = await readOrgSettings(scope.orgId);
    const today = businessDate(new Date(), settings.timeZone);
    const { movements, joinOn, settled } = invoiceBalances(scope.orgId);
    const staleBefore = daysAgo(STALE_DAYS);
    const search = input.query ? likePattern(input.query) : undefined;
    const threshold = new Date(Date.now() - settings.unbilledAlertHours * 3_600_000);

    const [unbilledMatches, [openMoney], [collected]] = await Promise.all([
      db
        .select({
          appointmentId: opdAppointments.id,
          patientId: patients.id,
          tokenNumber: opdAppointments.tokenNumber,
          patientName: patients.name,
          patientMrn: patients.mrn,
          patientPhone: patients.phone,
          practitionerName: practitioners.name,
          chargeCount: sql<number>`count(*)::integer`,
          pendingValue: sql`sum(${charges.unitPrice} * ${charges.qty})::bigint`.mapWith(BigInt),
          oldestChargeAt: sql<Date>`min(${charges.createdAt})`,
          matchCount: sql<number>`count(*) over()::integer`,
          matchValue: sql`sum(sum(${charges.unitPrice} * ${charges.qty})) over()::bigint`.mapWith(
            BigInt,
          ),
        })
        .from(charges)
        .innerJoin(
          opdAppointments,
          and(
            eq(opdAppointments.orgId, scope.orgId),
            eq(opdAppointments.id, charges.opdAppointmentId),
          ),
        )
        .innerJoin(
          patients,
          and(eq(patients.orgId, scope.orgId), eq(patients.id, opdAppointments.patientId)),
        )
        .innerJoin(
          practitioners,
          and(
            eq(practitioners.orgId, scope.orgId),
            eq(practitioners.id, opdAppointments.practitionerId),
          ),
        )
        .where(
          and(
            eq(charges.orgId, scope.orgId),
            eq(charges.status, "pending"),
            eq(opdAppointments.status, "checked_in"),
            search ? or(ilike(patients.name, search), ilike(patients.mrn, search)) : undefined,
          ),
        )
        .groupBy(
          opdAppointments.id,
          opdAppointments.tokenNumber,
          patients.id,
          patients.name,
          patients.mrn,
          patients.phone,
          practitioners.name,
        )
        .having(sql`min(${charges.createdAt}) < ${threshold}`)
        // Oldest first: the longest wait is the most likely to walk out unbilled.
        .orderBy(sql`min(${charges.createdAt}) asc`, asc(opdAppointments.id))
        .limit(input.limit + 1),
      // One scan answers all four figures; four procedures would be four scans per poll.
      db
        .select({
          outstanding:
            sql`coalesce(sum(case when (${settled}) > 0 then (${settled}) else 0 end), 0)::bigint`.mapWith(
              BigInt,
            ),
          openCount: sql<number>`count(*) filter (where (${settled}) > 0)::integer`,
          staleTotal:
            sql`coalesce(sum(case when (${settled}) > 0 and ${invoices.createdAt} < ${staleBefore} then (${settled}) else 0 end), 0)::bigint`.mapWith(
              BigInt,
            ),
          staleCount: sql<number>`count(*) filter (where (${settled}) > 0 and ${invoices.createdAt} < ${staleBefore})::integer`,
        })
        .from(invoices)
        .leftJoin(movements, joinOn)
        .where(eq(invoices.orgId, scope.orgId)),
      db
        .execute<{ total: string; receiptCount: number }>(sql`
        select (
          coalesce((select sum(${payments.amount}) from ${payments}
            where ${payments.orgId} = ${scope.orgId} and ${payments.businessDate} = ${today}), 0)
          + coalesce((select sum(${advanceReceipts.amount}) from ${advanceReceipts}
            where ${advanceReceipts.orgId} = ${scope.orgId} and ${advanceReceipts.businessDate} = ${today}), 0)
          - coalesce((select sum(${refunds.amount}) from ${refunds}
            where ${refunds.orgId} = ${scope.orgId} and ${refunds.businessDate} = ${today}), 0)
        )::bigint as total,
        (
          (select count(*) from ${payments}
            where ${payments.orgId} = ${scope.orgId} and ${payments.businessDate} = ${today})
          + (select count(*) from ${advanceReceipts}
            where ${advanceReceipts.orgId} = ${scope.orgId} and ${advanceReceipts.businessDate} = ${today})
        )::int as "receiptCount"
      `)
        .then((result) => result.rows),
    ]);

    const match = unbilledMatches[0];
    const hasMore = unbilledMatches.length > input.limit;

    const unbilled = unbilledMatches
      .slice(0, input.limit)
      .map(({ matchCount: _count, matchValue: _value, ...row }) => row);

    return {
      unbilled,
      hasMore,
      summary: {
        toBillTotal: match?.matchValue ?? 0n,
        toBillCount: match?.matchCount ?? 0,
        collectedToday: BigInt(collected?.total ?? "0"),
        receiptCount: collected?.receiptCount ?? 0,
        outstanding: openMoney?.outstanding ?? 0n,
        openCount: openMoney?.openCount ?? 0,
        staleTotal: openMoney?.staleTotal ?? 0n,
        staleCount: openMoney?.staleCount ?? 0,
      },
    };
  }),

  advancesHeld: orgProcedure(
    { billing: ["read"] },
    orgInput.extend({
      query: searchQuery,
      cursor: z.object({ createdAt: z.coerce.date(), id: z.string() }).optional(),
      limit: pageLimit,
    }),
  ).handler(async ({ context, input }) => {
    const { orgId } = context.scope;
    const pattern = input.query ? likePattern(input.query) : undefined;
    const remaining = advanceRemaining(orgId);

    const rows = await db
      .select({
        id: advanceReceipts.id,
        patientId: advanceReceipts.patientId,
        patientName: advanceReceipts.patientName,
        patientMrn: advanceReceipts.patientMrn,
        purpose: advanceReceipts.purpose,
        planStatus: treatmentPlans.status,
        receiptNumber: advanceReceipts.receiptNumber,
        businessDate: advanceReceipts.businessDate,
        createdAt: advanceReceipts.createdAt,
        remaining,
      })
      .from(advanceReceipts)
      .leftJoin(
        treatmentPlans,
        and(
          eq(treatmentPlans.orgId, orgId),
          eq(treatmentPlans.id, advanceReceipts.treatmentPlanId),
        ),
      )
      .where(
        and(
          eq(advanceReceipts.orgId, orgId),
          sql`${remaining} > 0`,
          pattern
            ? or(
                ilike(advanceReceipts.patientName, pattern),
                ilike(advanceReceipts.patientMrn, pattern),
              )
            : undefined,
          input.cursor
            ? sql`(${advanceReceipts.createdAt}, ${advanceReceipts.id}) > (${input.cursor.createdAt}, ${input.cursor.id})`
            : undefined,
        ),
      )
      .orderBy(asc(advanceReceipts.createdAt), asc(advanceReceipts.id))
      .limit(input.limit + 1);

    const items = rows.slice(0, input.limit);
    const last = items.at(-1);

    return {
      items,
      nextCursor:
        rows.length > input.limit && last ? { createdAt: last.createdAt, id: last.id } : null,
    };
  }),

  openInvoices: orgProcedure(
    { billing: ["read"] },
    orgInput.extend({
      query: searchQuery,
      overdueOnly: z.boolean().default(false),
      // Keyset on the UUIDv7 id alone: ids are minted at issue so they order
      // chronologically, and a timestamp cursor's millisecond truncation loses rows.
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(25),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const search = input.query ? likePattern(input.query) : undefined;
    const { movements, joinOn, settled, paid } = invoiceBalances(scope.orgId);

    const rows = await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        appointmentId: invoices.opdAppointmentId,
        patientName: invoices.patientName,
        patientId: invoices.patientId,
        patientMrn: invoices.patientMrn,
        patientPhone: invoices.patientPhone,
        grandTotal: invoices.grandTotal,
        paid: sql`${paid}`.mapWith(BigInt),
        outstanding: sql`${settled}`.mapWith(BigInt),
        createdAt: invoices.createdAt,
      })
      .from(invoices)
      .leftJoin(movements, joinOn)
      .where(
        and(
          eq(invoices.orgId, scope.orgId),
          sql`(${settled}) > 0`,
          input.cursor ? gt(invoices.id, input.cursor) : undefined,
          input.overdueOnly ? lt(invoices.createdAt, daysAgo(OVERDUE_DAYS)) : undefined,
          search
            ? or(
                ilike(invoices.patientName, search),
                ilike(invoices.patientMrn, search),
                ilike(invoices.invoiceNumber, search),
              )
            : undefined,
        ),
      )
      .orderBy(asc(invoices.id))
      .limit(input.limit + 1);

    const hasNextPage = rows.length > input.limit;

    if (hasNextPage) rows.pop();

    const last = rows.at(-1);

    return {
      items: rows,
      nextCursor: hasNextPage && last ? last.id : null,
    };
  }),

  refundDue: orgProcedure(
    { billing: ["read"] },
    orgInput.extend({
      query: searchQuery,
      limit: z.number().int().min(1).max(200).default(50),
    }),
  ).handler(async ({ context, input }) => {
    const { orgId } = context.scope;
    const search = input.query ? likePattern(input.query) : undefined;
    const { movements, joinOn, settled } = invoiceBalances(orgId);

    const rows = await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        patientName: invoices.patientName,
        patientMrn: invoices.patientMrn,
        stream: invoices.stream,
        businessDate: invoices.businessDate,
        refundDue: sql`(-(${settled}))::bigint`.mapWith(BigInt),
      })
      .from(invoices)
      .leftJoin(movements, joinOn)
      .where(
        and(
          eq(invoices.orgId, orgId),
          sql`(${settled}) < 0`,
          search
            ? or(
                ilike(invoices.patientName, search),
                ilike(invoices.patientMrn, search),
                ilike(invoices.invoiceNumber, search),
              )
            : undefined,
        ),
      )
      .orderBy(asc(invoices.createdAt), asc(invoices.id))
      .limit(input.limit + 1);

    const hasMore = rows.length > input.limit;

    if (hasMore) rows.pop();

    return {
      rows: rows.map(({ id, ...row }) => ({
        ...row,
        invoiceId: id,
      })),
      hasMore,
    };
  }),
};
