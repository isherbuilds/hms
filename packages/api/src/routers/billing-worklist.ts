import { db } from "@hms/db";
import { charges } from "@hms/db/schema/charges";
import { creditNotes } from "@hms/db/schema/credit-notes";
import { invoices } from "@hms/db/schema/invoices";
import { opdAppointments } from "@hms/db/schema/opd-appointments";
import { patients } from "@hms/db/schema/patients";
import { payments } from "@hms/db/schema/payments";
import { practitioners } from "@hms/db/schema/practitioners";
import { refunds } from "@hms/db/schema/refunds";
import { and, asc, eq, gt, ilike, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import { businessDate } from "../lib/business-date";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { likePattern, searchQuery } from "../lib/schemas";
import { readOrgSettings } from "../lib/settings-cache";

// `worklist` polls pending charges for checked-in visits, all open invoice totals,
// and today's collections. `openInvoices` grows forever, so it pages on a keyset.

const OVERDUE_DAYS = 7;

const STALE_DAYS = 30;

function paidExpression(orgId: string) {
  return sql`coalesce((select sum(${payments.amount}) from ${payments}
        where ${payments.orgId} = ${orgId} and ${payments.invoiceId} = ${invoices.id}), 0)::bigint`;
}

function settledExpression(orgId: string) {
  return sql`
    ${invoices.grandTotal}
    - coalesce((select sum(${creditNotes.total}) from ${creditNotes}
        where ${creditNotes.orgId} = ${orgId} and ${creditNotes.invoiceId} = ${invoices.id}), 0)::bigint
    - ${paidExpression(orgId)}
    + coalesce((select sum(${refunds.amount}) from ${refunds}
        where ${refunds.orgId} = ${orgId} and ${refunds.invoiceId} = ${invoices.id}), 0)::bigint`;
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
    const settled = settledExpression(scope.orgId);
    const staleBefore = daysAgo(STALE_DAYS);
    const search = input.query ? likePattern(input.query) : undefined;
    const threshold = new Date(Date.now() - settings.unbilledAlertHours * 3_600_000);

    const [unbilledMatches, [openMoney], [collected]] = await Promise.all([
      db
        .select({
          appointmentId: opdAppointments.id,
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
        .where(eq(invoices.orgId, scope.orgId)),
      db
        .select({
          total:
            sql`(coalesce(sum(${payments.amount}), 0) - coalesce((select sum(${refunds.amount}) from ${refunds}
              where ${refunds.orgId} = ${scope.orgId} and ${refunds.businessDate} = ${today}), 0))::bigint`.mapWith(
              BigInt,
            ),
          receiptCount: sql<number>`count(*)::integer`,
        })
        .from(payments)
        .where(and(eq(payments.orgId, scope.orgId), eq(payments.businessDate, today))),
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
        collectedToday: collected?.total ?? 0n,
        receiptCount: collected?.receiptCount ?? 0,
        outstanding: openMoney?.outstanding ?? 0n,
        openCount: openMoney?.openCount ?? 0,
        staleTotal: openMoney?.staleTotal ?? 0n,
        staleCount: openMoney?.staleCount ?? 0,
      },
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
    const settled = settledExpression(scope.orgId);
    const paid = paidExpression(scope.orgId);

    const rows = await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        appointmentId: invoices.opdAppointmentId,
        patientName: invoices.patientName,
        patientMrn: invoices.patientMrn,
        patientPhone: invoices.patientPhone,
        grandTotal: invoices.grandTotal,
        paid: sql`(${paid})::bigint`.mapWith(BigInt),
        outstanding: sql`(${settled})::bigint`.mapWith(BigInt),
        createdAt: invoices.createdAt,
      })
      .from(invoices)
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

    const last = rows[rows.length - 1];

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
    const settled = settledExpression(orgId);

    const rows = await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        patientName: invoices.patientName,
        patientMrn: invoices.patientMrn,
        businessDate: invoices.businessDate,
        refundDue: sql`(-(${settled}))::bigint`.mapWith(BigInt),
      })
      .from(invoices)
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
