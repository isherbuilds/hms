import { db } from "@hms/db";
import { catalogItems, OPD_BILLABLE_CATEGORIES } from "@hms/db/schema/catalog-items";
import { departments } from "@hms/db/schema/departments";
import { opdAppointments } from "@hms/db/schema/opd-appointments";
import { patients } from "@hms/db/schema/patients";
import { practitioners } from "@hms/db/schema/practitioners";
import { ORPCError } from "@orpc/server";
import { and, eq, gte, inArray } from "drizzle-orm";

const DAY_MS = 86_400_000;

type OpdItemSnapshot = Pick<
  typeof catalogItems.$inferSelect,
  "id" | "name" | "category" | "unitPrice" | "taxRatePercent" | "taxCode"
>;

export async function resolveOpdPricing(options: {
  orgId: string;
  practitionerId: string;
  patientId: string | null;
  services: readonly { catalogItemId: string; qty: number }[];
  consultation: "auto" | "omit" | "none";
  followUpValidityDays: number;
  now: Date;
}) {
  const { orgId, patientId } = options;
  const [careTeam] = await db
    .select({
      id: practitioners.id,
      departmentId: practitioners.departmentId,
      consultFeeItemId: practitioners.consultFeeItemId,
      followUpFeeItemId: practitioners.followUpFeeItemId,
      followUpValidityDays: practitioners.followUpValidityDays,
      defaultConsultFeeItemId: departments.defaultConsultFeeItemId,
    })
    .from(practitioners)
    .innerJoin(
      departments,
      and(eq(departments.orgId, orgId), eq(departments.id, practitioners.departmentId)),
    )
    .where(and(eq(practitioners.orgId, orgId), eq(practitioners.id, options.practitionerId)))
    .limit(1);
  if (!careTeam) {
    throw new ORPCError("NOT_FOUND", { message: "That practitioner no longer exists." });
  }

  const serviceIds = options.services.map((service) => service.catalogItemId);
  const feeIds =
    options.consultation === "auto"
      ? [
          careTeam.followUpFeeItemId,
          careTeam.consultFeeItemId,
          careTeam.defaultConsultFeeItemId,
        ].filter((id): id is string => id != null)
      : [];
  const catalogItemIds = [...new Set([...feeIds, ...serviceIds])];
  const followUpDays = careTeam.followUpValidityDays ?? options.followUpValidityDays;

  const [patientRows, recentRows, itemRows] = await Promise.all([
    patientId
      ? db
          .select({ id: patients.id })
          .from(patients)
          .where(and(eq(patients.orgId, orgId), eq(patients.id, patientId)))
          .limit(1)
      : Promise.resolve([]),
    options.consultation === "auto" && careTeam.followUpFeeItemId != null && patientId != null
      ? db
          .select({ id: opdAppointments.id })
          .from(opdAppointments)
          .where(
            and(
              eq(opdAppointments.orgId, orgId),
              eq(opdAppointments.patientId, patientId),
              eq(opdAppointments.practitionerId, careTeam.id),
              eq(opdAppointments.status, "checked_in"),
              gte(
                opdAppointments.arrivedAt,
                new Date(options.now.getTime() - followUpDays * DAY_MS),
              ),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
    catalogItemIds.length > 0
      ? db
          .select({
            id: catalogItems.id,
            name: catalogItems.name,
            category: catalogItems.category,
            unitPrice: catalogItems.unitPrice,
            taxRatePercent: catalogItems.taxRatePercent,
            taxCode: catalogItems.taxCode,
          })
          .from(catalogItems)
          .where(
            and(
              eq(catalogItems.orgId, orgId),
              eq(catalogItems.active, true),
              inArray(catalogItems.id, catalogItemIds),
            ),
          )
      : Promise.resolve([] as OpdItemSnapshot[]),
  ]);

  if (patientId != null && !patientRows[0]) {
    throw new ORPCError("NOT_FOUND", { message: "That patient no longer exists." });
  }

  const items: Record<string, OpdItemSnapshot> = Object.fromEntries(
    itemRows.map((item) => [item.id, item]),
  );
  const feeItem =
    options.consultation === "auto"
      ? ((recentRows[0] && careTeam.followUpFeeItemId
          ? items[careTeam.followUpFeeItemId]
          : undefined) ??
        (careTeam.consultFeeItemId ? items[careTeam.consultFeeItemId] : undefined) ??
        (careTeam.defaultConsultFeeItemId ? items[careTeam.defaultConsultFeeItemId] : undefined))
      : undefined;
  const serviceItems = options.services.map((service) => {
    const item = items[service.catalogItemId];
    const billable = item && OPD_BILLABLE_CATEGORIES.some((category) => category === item.category);
    if (
      !item ||
      !billable ||
      (options.consultation === "none" && item.category === "consultation")
    ) {
      throw new ORPCError("NOT_FOUND", { message: "That service is no longer available." });
    }
    return { item, qty: service.qty };
  });

  return { departmentId: careTeam.departmentId, feeItem, serviceItems };
}

export function chargeRow(args: {
  orgId: string;
  appointmentId: string;
  item: OpdItemSnapshot;
  qty: number;
  sourceType: "consult_fee" | "catalog";
  userId: string;
  now: Date;
}) {
  return {
    id: Bun.randomUUIDv7(),
    orgId: args.orgId,
    opdAppointmentId: args.appointmentId,
    catalogItemId: args.item.id,
    description: args.item.name,
    qty: args.qty,
    unitPrice: args.item.unitPrice,
    taxRatePercent: args.item.taxRatePercent,
    taxCode: args.item.taxCode,
    revenueCategory: args.item.category,
    sourceType: args.sourceType,
    sourceId: null,
    status: "pending",
    createdBy: args.userId,
    createdAt: args.now,
    updatedAt: args.now,
  } as const;
}
