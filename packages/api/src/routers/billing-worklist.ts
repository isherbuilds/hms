import { db } from "@hms/db";
import { charges } from "@hms/db/schema/charges";
import { creditNotes } from "@hms/db/schema/credit-notes";
import { invoices } from "@hms/db/schema/invoices";
import { opdAppointments } from "@hms/db/schema/opd-appointments";
import { patients } from "@hms/db/schema/patients";
import { payments } from "@hms/db/schema/payments";
import { practitioners } from "@hms/db/schema/practitioners";
import { refunds } from "@hms/db/schema/refunds";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { invoiceBalancesFor } from "../lib/invoice-balance";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { readOrgSettings } from "../lib/settings-cache";

/**
 * The organization-wide money worklist: charges still waiting for an Invoice,
 * and issued Invoices still waiting for collection. The lists stay separate
 * because resolving them takes different actions and they have different row
 * shapes.
 *
 * Both lists filter before applying their oldest-first cap. The unpaid SQL
 * predicate only selects rows; displayed balances still come from
 * `invoiceBalancesFor`, which remains the source of truth for money on screen.
 */
export const billingWorklistRouter = {
  worklist: orgProcedure(
    { billing: ["read"] },
    orgInput.extend({ limit: z.number().int().min(1).max(200).default(50) }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const pendingValue = sql<string>`sum(${charges.unitPrice} * ${charges.qty})`;
    const settled = sql`
      ${invoices.grandTotal}
      - coalesce((select sum(${creditNotes.total}) from ${creditNotes}
          where ${creditNotes.orgId} = ${scope.orgId} and ${creditNotes.invoiceId} = ${invoices.id}), 0)
      - coalesce((select sum(${payments.amount}) from ${payments}
          where ${payments.orgId} = ${scope.orgId} and ${payments.invoiceId} = ${invoices.id}), 0)
      + coalesce((select sum(${refunds.amount}) from ${refunds}
          where ${refunds.orgId} = ${scope.orgId} and ${refunds.invoiceId} = ${invoices.id}), 0)`;

    const [unbilled, openInvoices, settings] = await Promise.all([
      db
        .select({
          appointmentId: opdAppointments.id,
          tokenNumber: opdAppointments.tokenNumber,
          opdStatus: opdAppointments.status,
          patientName: patients.name,
          patientMrn: patients.mrn,
          practitionerName: practitioners.name,
          chargeCount: sql<number>`count(*)::integer`,
          pendingValue,
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
        .where(and(eq(charges.orgId, scope.orgId), eq(charges.status, "pending")))
        .groupBy(
          opdAppointments.id,
          opdAppointments.tokenNumber,
          opdAppointments.status,
          patients.name,
          patients.mrn,
          practitioners.name,
        )
        .orderBy(sql`min(${charges.createdAt}) asc`, asc(opdAppointments.id))
        .limit(input.limit),
      db
        .select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          currency: invoices.currency,
          grandTotal: invoices.grandTotal,
          createdAt: invoices.createdAt,
          patientName: invoices.patientName,
          patientMrn: invoices.patientMrn,
          appointmentId: opdAppointments.id,
          tokenNumber: opdAppointments.tokenNumber,
        })
        .from(invoices)
        .innerJoin(
          opdAppointments,
          and(
            eq(opdAppointments.orgId, scope.orgId),
            eq(opdAppointments.id, invoices.opdAppointmentId),
          ),
        )
        .where(and(eq(invoices.orgId, scope.orgId), sql`${settled} > 0`))
        .orderBy(asc(invoices.createdAt), asc(invoices.id))
        .limit(input.limit),
      readOrgSettings(scope.orgId),
    ]);

    const balances = await invoiceBalancesFor(db, scope.orgId, openInvoices);

    return {
      currency: settings.currency,
      unbilled,
      unpaid: openInvoices.map((invoice) => {
        const balance = balances.get(invoice.id);
        if (!balance) throw new Error(`Balance missing for invoice ${invoice.id}`);
        return { ...invoice, outstanding: balance.outstanding, paid: balance.paymentsTotal };
      }),
    };
  }),
};
