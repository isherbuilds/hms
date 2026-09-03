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

import { businessDate, businessDayWindow } from "../lib/business-date";
import { invoiceBalancesFor } from "../lib/invoice-balance";
import { fromPaise, toPaise } from "../lib/invoice-math";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { likePattern, searchQuery } from "../lib/schemas";
import { readOrgSettings } from "../lib/settings-cache";

// `worklist` polls pending charges for checked-in visits, all open invoice totals,
// and today's collections. `openInvoices` grows forever, so it pages on a keyset.

const OVERDUE_DAYS = 7;
const STALE_DAYS = 30;

function settledExpression(orgId: string) {
  return sql`
    ${invoices.grandTotal}
    - coalesce((select sum(${creditNotes.total}) from ${creditNotes}
        where ${creditNotes.orgId} = ${orgId} and ${creditNotes.invoiceId} = ${invoices.id}), 0)
    - coalesce((select sum(${payments.amount}) from ${payments}
        where ${payments.orgId} = ${orgId} and ${payments.invoiceId} = ${invoices.id}), 0)
    + coalesce((select sum(${refunds.amount}) from ${refunds}
        where ${refunds.orgId} = ${orgId} and ${refunds.invoiceId} = ${invoices.id}), 0)`;
}

const daysAgo = (count: number) => new Date(Date.now() - count * 86_400_000);

export const billingWorklistRouter = {
  worklist: orgProcedure({ billing: ["read"] }, orgInput.extend({ query: searchQuery })).handler(
    async ({ context, input }) => {
      const { scope } = context;
      const settings = await readOrgSettings(scope.orgId);
      const today = businessDayWindow(
        businessDate(new Date(), settings.timeZone),
        settings.timeZone,
      );
      const settled = settledExpression(scope.orgId);
      const staleBefore = daysAgo(STALE_DAYS);
      const search = input.query ? likePattern(input.query) : undefined;

      const [unbilled, [openMoney], [collected]] = await Promise.all([
        db
          .select({
            appointmentId: opdAppointments.id,
            tokenNumber: opdAppointments.tokenNumber,
            patientName: patients.name,
            patientMrn: patients.mrn,
            patientPhone: patients.phone,
            practitionerName: practitioners.name,
            chargeCount: sql<number>`count(*)::integer`,
            pendingValue: sql<string>`sum(${charges.unitPrice} * ${charges.qty})`,
            oldestChargeAt: sql<Date>`min(${charges.createdAt})`,
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
          // Oldest first: the longest wait is the most likely to walk out unbilled.
          .orderBy(sql`min(${charges.createdAt}) asc`, asc(opdAppointments.id)),
        // One scan answers all four figures; four procedures would be four scans per poll.
        db
          .select({
            outstanding: sql<string>`coalesce(sum(case when (${settled}) > 0 then (${settled}) else 0 end), 0)`,
            openCount: sql<number>`count(*) filter (where (${settled}) > 0)::integer`,
            staleTotal: sql<string>`coalesce(sum(case when (${settled}) > 0 and ${invoices.createdAt} < ${staleBefore} then (${settled}) else 0 end), 0)`,
            staleCount: sql<number>`count(*) filter (where (${settled}) > 0 and ${invoices.createdAt} < ${staleBefore})::integer`,
          })
          .from(invoices)
          .where(eq(invoices.orgId, scope.orgId)),
        db
          .select({
            total: sql<string>`coalesce(sum(${payments.amount}), 0)`,
            receiptCount: sql<number>`count(*)::integer`,
          })
          .from(payments)
          .where(
            and(
              eq(payments.orgId, scope.orgId),
              sql`${payments.createdAt} >= ${today.start}`,
              sql`${payments.createdAt} < ${today.end}`,
            ),
          ),
      ]);

      const toBillPaise = unbilled.reduce((sum, row) => sum + toPaise(row.pendingValue), 0);

      return {
        currency: settings.currency,
        unbilled,
        summary: {
          toBillTotal: fromPaise(toBillPaise),
          toBillCount: unbilled.length,
          collectedToday: collected?.total ?? "0",
          receiptCount: collected?.receiptCount ?? 0,
          outstanding: openMoney?.outstanding ?? "0",
          openCount: openMoney?.openCount ?? 0,
          staleTotal: openMoney?.staleTotal ?? "0",
          staleCount: openMoney?.staleCount ?? 0,
        },
      };
    },
  ),

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
    const rows = await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        appointmentId: invoices.opdAppointmentId,
        patientName: invoices.patientName,
        patientMrn: invoices.patientMrn,
        patientPhone: invoices.patientPhone,
        grandTotal: invoices.grandTotal,
        createdAt: invoices.createdAt,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.orgId, scope.orgId),
          sql`(${settledExpression(scope.orgId)}) > 0`,
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

    // Displayed money still comes from `invoiceBalancesFor`, the single source on screen.
    const balances = await invoiceBalancesFor(db, scope.orgId, rows);
    const last = rows[rows.length - 1];

    return {
      items: rows.map((invoice) => {
        const balance = balances.get(invoice.id);
        if (!balance) throw new Error(`Balance missing for invoice ${invoice.id}`);
        return { ...invoice, paid: balance.paymentsTotal, outstanding: balance.outstanding };
      }),
      nextCursor: hasNextPage && last ? last.id : null,
    };
  }),
};
