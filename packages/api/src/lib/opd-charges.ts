import type { db } from "@hms/db";
import type { DbTransaction } from "@hms/db/counter";
import { catalogItems, OPD_BILLABLE_CATEGORIES } from "@hms/db/schema/catalog-items";
import { charges } from "@hms/db/schema/charges";
import { departments } from "@hms/db/schema/departments";
import { opdAppointments } from "@hms/db/schema/opd-appointments";
import { patients } from "@hms/db/schema/patients";
import { practitioners } from "@hms/db/schema/practitioners";
import { ORPCError } from "@orpc/server";

import { impossible } from "./conflict";
import { and, eq, gte, inArray, ne } from "drizzle-orm";

const DAY_MS = 86_400_000;

type Executor = typeof db | DbTransaction;

/** The catalog fields a charge copies at creation. Charges never re-read the item. */
export type FeeItemSnapshot = Pick<
  typeof catalogItems.$inferSelect,
  "id" | "name" | "category" | "unitPrice" | "taxRatePercent" | "taxCode"
>;

const FEE_ITEM_COLUMNS = {
  id: catalogItems.id,
  name: catalogItems.name,
  category: catalogItems.category,
  unitPrice: catalogItems.unitPrice,
  taxRatePercent: catalogItems.taxRatePercent,
  taxCode: catalogItems.taxCode,
} as const;

export async function findActiveCatalogItem(options: {
  executor: Executor;
  catalogItemId: string | null;
  orgId: string;
}): Promise<FeeItemSnapshot | undefined> {
  if (options.catalogItemId == null) return undefined;
  const [item] = await options.executor
    .select(FEE_ITEM_COLUMNS)
    .from(catalogItems)
    .where(
      and(
        eq(catalogItems.orgId, options.orgId),
        eq(catalogItems.id, options.catalogItemId),
        eq(catalogItems.active, true),
      ),
    )
    .limit(1);
  return item;
}

// Walk-in paths accept consultation items; booking rejects them because check-in
// would stack a second ladder fee.
export async function findActiveServiceItems(options: {
  executor: Executor;
  catalogItemIds: string[];
  orgId: string;
  includeConsultation: boolean;
}): Promise<Map<string, FeeItemSnapshot>> {
  if (options.catalogItemIds.length === 0) return new Map();
  const rows = await options.executor
    .select(FEE_ITEM_COLUMNS)
    .from(catalogItems)
    .where(
      and(
        eq(catalogItems.orgId, options.orgId),
        inArray(catalogItems.id, options.catalogItemIds),
        eq(catalogItems.active, true),
        // The backstop for revenue bifurcation: hiding an option in the picker is not a
        // rule, so an item this appointment may not carry resolves to nothing here.
        inArray(catalogItems.category, [...OPD_BILLABLE_CATEGORIES]),
        options.includeConsultation ? undefined : ne(catalogItems.category, "consultation"),
      ),
    );
  return new Map(rows.map((row) => [row.id, row]));
}

export function requireCatalogItem(
  items: Map<string, FeeItemSnapshot>,
  catalogItemId: string,
): FeeItemSnapshot {
  const item = items.get(catalogItemId);
  if (!item) throw new ORPCError("NOT_FOUND", { message: "That service is no longer available." });
  return item;
}

export async function requireCareTeam(options: {
  executor: Executor;
  orgId: string;
  practitionerId: string;
  departmentId: string;
  patientId: string | null;
}) {
  const { executor, orgId, patientId } = options;
  const [[practitioner], [department], patientRows] = await Promise.all([
    executor
      .select({
        id: practitioners.id,
        departmentId: practitioners.departmentId,
        consultFeeItemId: practitioners.consultFeeItemId,
        followUpFeeItemId: practitioners.followUpFeeItemId,
        followUpValidityDays: practitioners.followUpValidityDays,
      })
      .from(practitioners)
      .where(and(eq(practitioners.orgId, orgId), eq(practitioners.id, options.practitionerId)))
      .limit(1),
    executor
      .select({ id: departments.id, defaultConsultFeeItemId: departments.defaultConsultFeeItemId })
      .from(departments)
      .where(and(eq(departments.orgId, orgId), eq(departments.id, options.departmentId)))
      .limit(1),
    patientId
      ? executor
          .select({ id: patients.id })
          .from(patients)
          .where(and(eq(patients.orgId, orgId), eq(patients.id, patientId)))
          .limit(1)
      : Promise.resolve([]),
  ]);

  if (
    !practitioner ||
    !department ||
    practitioner.departmentId !== department.id ||
    (patientId != null && !patientRows[0])
  ) {
    throw new ORPCError("NOT_FOUND", {
      message: "The practitioner, department, or patient on this appointment no longer exists.",
    });
  }
  return { practitioner, department };
}

export type CareTeam = Awaited<ReturnType<typeof requireCareTeam>>;

export async function chooseConsultFee(options: {
  executor: Executor;
  orgId: string;
  patientId: string;
  practitioner: CareTeam["practitioner"];
  department: CareTeam["department"];
  followUpValidityDays: number;
  now: Date;
}): Promise<FeeItemSnapshot | undefined> {
  const { executor, orgId, practitioner, department, now } = options;

  if (practitioner.followUpFeeItemId != null) {
    const windowDays = practitioner.followUpValidityDays ?? options.followUpValidityDays;
    const [recent] = await executor
      .select({ id: opdAppointments.id })
      .from(opdAppointments)
      .where(
        and(
          eq(opdAppointments.orgId, orgId),
          eq(opdAppointments.patientId, options.patientId),
          eq(opdAppointments.practitionerId, practitioner.id),
          eq(opdAppointments.status, "checked_in"),
          gte(opdAppointments.arrivedAt, new Date(now.getTime() - windowDays * DAY_MS)),
        ),
      )
      .limit(1);
    if (recent) {
      const fee = await findActiveCatalogItem({
        executor,
        catalogItemId: practitioner.followUpFeeItemId,
        orgId,
      });
      if (fee) return fee;
    }
  }

  return (
    (await findActiveCatalogItem({
      executor,
      catalogItemId: practitioner.consultFeeItemId,
      orgId,
    })) ??
    (await findActiveCatalogItem({
      executor,
      catalogItemId: department.defaultConsultFeeItemId,
      orgId,
    }))
  );
}

export async function createConsultCharge(options: {
  tx: DbTransaction;
  appointmentId: string;
  feeItem: FeeItemSnapshot | undefined;
  orgId: string;
  userId: string;
  now: Date;
  chargeId?: string;
}) {
  const { feeItem, now } = options;
  if (!feeItem) return null;
  const [charge] = await options.tx
    .insert(charges)
    .values({
      id: options.chargeId ?? Bun.randomUUIDv7(),
      orgId: options.orgId,
      opdAppointmentId: options.appointmentId,
      catalogItemId: feeItem.id,
      description: feeItem.name,
      unitPrice: feeItem.unitPrice,
      taxRatePercent: feeItem.taxRatePercent,
      taxCode: feeItem.taxCode,
      revenueCategory: feeItem.category,
      qty: 1,
      sourceType: "consult_fee",
      sourceId: null,
      status: "pending",
      createdBy: options.userId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!charge) throw impossible("consult fee charge insert returned no row");
  return charge;
}

export async function serviceChargeValues(options: {
  executor: Executor;
  appointmentId: string;
  services: readonly { catalogItemId: string; qty: number }[];
  orgId: string;
  includeConsultation: boolean;
  userId: string;
  now: Date;
}) {
  const { orgId, now, services } = options;
  const serviceItems = await findActiveServiceItems({
    executor: options.executor,
    catalogItemIds: services.map((service) => service.catalogItemId),
    orgId,
    includeConsultation: options.includeConsultation,
  });

  return services.map((service) => {
    const item = requireCatalogItem(serviceItems, service.catalogItemId);
    return {
      id: Bun.randomUUIDv7(),
      orgId,
      opdAppointmentId: options.appointmentId,
      catalogItemId: item.id,
      description: item.name,
      qty: service.qty,
      unitPrice: item.unitPrice,
      taxRatePercent: item.taxRatePercent,
      taxCode: item.taxCode,
      revenueCategory: item.category,
      sourceType: "catalog",
      sourceId: null,
      status: "pending",
      createdBy: options.userId,
      createdAt: now,
      updatedAt: now,
    } as const;
  });
}
