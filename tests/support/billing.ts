import { computeInvoiceLines } from "@hms/api/lib/invoice-math";
import type { AppRouterClient } from "@hms/api/routers/index";
import { db } from "@hms/db";
import { catalogItems } from "@hms/db/schema/catalog-items";
import { charges } from "@hms/db/schema/charges";
import { opdAppointments } from "@hms/db/schema/opd-appointments";
import { and, eq, sql } from "drizzle-orm";

export async function addPendingCatalogCharge({
  orgId,
  userId,
  appointmentId,
  catalogItemId,
  qty = 1,
  id = Bun.randomUUIDv7(),
  createdAt,
}: {
  orgId: string;
  userId: string;
  appointmentId: string;
  catalogItemId: string;
  qty?: number;
  id?: string;
  createdAt?: Date;
}) {
  return db.transaction(async (tx) => {
    const [appointment] = await tx
      .select({ id: opdAppointments.id })
      .from(opdAppointments)
      .where(and(eq(opdAppointments.orgId, orgId), eq(opdAppointments.id, appointmentId)))
      .limit(1)
      .for("update");

    const [item] = await tx
      .select()
      .from(catalogItems)
      .where(and(eq(catalogItems.orgId, orgId), eq(catalogItems.id, catalogItemId)))
      .limit(1);

    if (!appointment || !item) throw new Error("Test charge fixture is incomplete");

    const [charge] = await tx
      .insert(charges)
      .values({
        id,
        orgId,
        opdAppointmentId: appointment.id,
        catalogItemId: item.id,
        description: item.name,
        qty,
        unitPrice: item.unitPrice,
        taxRatePercent: item.taxRatePercent,
        taxCode: item.taxCode,
        revenueCategory: item.category,
        sourceType: "catalog",
        sourceId: null,
        status: "pending",
        createdBy: userId,
        createdAt,
      })
      .returning();

    if (!charge) throw new Error("Test charge was not inserted");

    await tx
      .update(opdAppointments)
      .set({ chargeRevision: sql`${opdAppointments.chargeRevision} + 1` })
      .where(and(eq(opdAppointments.orgId, orgId), eq(opdAppointments.id, appointment.id)));

    return charge;
  });
}

export async function settlePendingCharges(
  api: AppRouterClient,
  input: {
    orgSlug: string;
    appointmentId: string;
    discountAmount?: bigint;
    note?: string;
    payments?: Array<{
      method: "cash" | "upi" | "card";
      amount: bigint;
      reference?: string;
    }>;
  },
) {
  const review = await api.opd.get({
    orgSlug: input.orgSlug,
    appointmentId: input.appointmentId,
  });

  const discountAmount = input.discountAmount ?? 0n;
  const pending = review.charges.filter((charge) => charge.status === "pending");

  const quote = computeInvoiceLines(
    pending.map((charge) => ({
      chargeId: charge.id,
      description: charge.description,
      qty: charge.qty,
      unitPrice: charge.unitPrice,
      priceUnits: charge.priceUnits,
      taxRatePercent: charge.taxRatePercent,
      taxCode: charge.taxCode,
    })),
    discountAmount,
    "exclusive",
    "paise",
  );

  return api.billing.settleCharges({
    ...input,
    discountAmount,
    note: input.note ?? "Test invoice issued without collection",
    expectedChargeRevision: review.appointment.chargeRevision,
    expectedGrandTotal: quote.grandTotal,
  });
}
