import { db } from "@hms/db";
import { nextCounter } from "@hms/db/counter";
import { attachments } from "@hms/db/schema/attachments";
import { catalogItems } from "@hms/db/schema/catalog-items";
import { charges } from "@hms/db/schema/charges";
import { departments } from "@hms/db/schema/departments";
import { file } from "@hms/db/schema/file";
import { patients } from "@hms/db/schema/patients";
import { practitioners } from "@hms/db/schema/practitioners";
import { visits } from "@hms/db/schema/visits";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, getTableColumns, gte, inArray, like, lt, ne, or } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { readOrgSettings } from "../lib/settings-cache";

const VISIT_STATUSES = ["waiting", "in_consult", "completed", "cancelled"] as const;
const DAY_MS = 86_400_000;
type FeeItemSnapshot = Pick<
  typeof catalogItems.$inferSelect,
  "id" | "name" | "category" | "unitPrice" | "taxRatePercent" | "taxCode"
>;

async function findActiveCatalogItem(catalogItemId: string | null, orgId: string) {
  if (catalogItemId == null) {
    return undefined;
  }

  const [item] = await db
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
        eq(catalogItems.id, catalogItemId),
        eq(catalogItems.active, true),
      ),
    )
    .limit(1);

  return item;
}

async function throwForMissingOrStaleVisit(visitId: string, orgId: string): Promise<never> {
  const [existing] = await db
    .select({ id: visits.id })
    .from(visits)
    .where(and(eq(visits.orgId, orgId), eq(visits.id, visitId)))
    .limit(1);

  throw new ORPCError(existing ? "CONFLICT" : "NOT_FOUND");
}

export const visitRouter = {
  create: orgProcedure(
    { visit: ["create"] },
    orgInput.extend({
      patientId: z.string(),
      practitionerId: z.string(),
      departmentId: z.string(),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    const [[patient], [practitioner], [department]] = await Promise.all([
      db
        .select({ id: patients.id })
        .from(patients)
        .where(and(eq(patients.orgId, scope.orgId), eq(patients.id, input.patientId)))
        .limit(1),
      db
        .select({
          id: practitioners.id,
          consultFeeItemId: practitioners.consultFeeItemId,
          followUpFeeItemId: practitioners.followUpFeeItemId,
          followUpValidityDays: practitioners.followUpValidityDays,
        })
        .from(practitioners)
        .where(
          and(eq(practitioners.orgId, scope.orgId), eq(practitioners.id, input.practitionerId)),
        )
        .limit(1),
      db
        .select({
          id: departments.id,
          defaultConsultFeeItemId: departments.defaultConsultFeeItemId,
        })
        .from(departments)
        .where(and(eq(departments.orgId, scope.orgId), eq(departments.id, input.departmentId)))
        .limit(1),
    ]);

    if (!patient || !practitioner || !department) {
      throw new ORPCError("NOT_FOUND");
    }

    let feeItem: FeeItemSnapshot | undefined;
    if (practitioner.followUpFeeItemId != null) {
      const settings = await readOrgSettings(scope.orgId);
      const windowDays = practitioner.followUpValidityDays ?? settings.followUpValidityDays;
      const cutoff = new Date(Date.now() - windowDays * DAY_MS);
      const [recentVisit] = await db
        .select({ id: visits.id })
        .from(visits)
        .where(
          and(
            eq(visits.orgId, scope.orgId),
            eq(visits.patientId, input.patientId),
            eq(visits.practitionerId, input.practitionerId),
            ne(visits.status, "cancelled"),
            gte(visits.createdAt, cutoff),
          ),
        )
        .limit(1);

      if (recentVisit) {
        feeItem = await findActiveCatalogItem(practitioner.followUpFeeItemId, scope.orgId);
      }
    }

    feeItem ??= await findActiveCatalogItem(practitioner.consultFeeItemId, scope.orgId);
    feeItem ??= await findActiveCatalogItem(department.defaultConsultFeeItemId, scope.orgId);

    const visitId = crypto.randomUUID();
    const chargeId = feeItem ? crypto.randomUUID() : null;
    // Tokens reset at the UTC day boundary, which is acceptable for the pilot.
    const counterKey = `token:${input.practitionerId}:${new Date().toISOString().slice(0, 10)}`;

    const result = await db.transaction(async (tx) => {
      const tokenNumber = await nextCounter(tx, scope.orgId, counterKey);
      const [visit] = await tx
        .insert(visits)
        .values({
          id: visitId,
          orgId: scope.orgId,
          patientId: input.patientId,
          practitionerId: input.practitionerId,
          departmentId: input.departmentId,
          visitClass: "opd",
          tokenNumber,
          status: "waiting",
          createdBy: scope.userId,
        })
        .returning();

      if (!visit) {
        throw new ORPCError("INTERNAL_SERVER_ERROR");
      }

      if (!feeItem || !chargeId) {
        return { visit, charge: null };
      }

      const [charge] = await tx
        .insert(charges)
        .values({
          id: chargeId,
          orgId: scope.orgId,
          visitId,
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
          createdBy: scope.userId,
        })
        .returning();

      if (!charge) {
        throw new ORPCError("INTERNAL_SERVER_ERROR");
      }

      return { visit, charge };
    });

    audit({
      action: "visit.create",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `visit:${visitId}`,
    });

    return result;
  }),

  transition: orgProcedure(
    { visit: ["update"] },
    orgInput.extend({
      visitId: z.string(),
      to: z.enum(["in_consult", "completed", "cancelled"]),
      cancelReason: z.string().trim().min(1).max(500).optional(),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const now = new Date();

    if (input.to === "cancelled" && input.cancelReason == null) {
      throw new ORPCError("BAD_REQUEST");
    }

    let visit: typeof visits.$inferSelect | undefined;
    let voidedCharges: number | undefined;

    if (input.to === "cancelled") {
      const result = await db.transaction(async (tx) => {
        const [updatedVisit] = await tx
          .update(visits)
          .set({
            status: "cancelled",
            cancelledAt: now,
            cancelReason: input.cancelReason,
            updatedAt: now,
          })
          .where(
            and(
              eq(visits.orgId, scope.orgId),
              eq(visits.id, input.visitId),
              eq(visits.status, "waiting"),
            ),
          )
          .returning();

        if (!updatedVisit) {
          return { visit: undefined, voidedCharges: 0 };
        }

        const voided = await tx
          .update(charges)
          .set({ status: "voided", voidReason: input.cancelReason, updatedAt: now })
          .where(
            and(
              eq(charges.orgId, scope.orgId),
              eq(charges.visitId, input.visitId),
              eq(charges.status, "pending"),
            ),
          )
          .returning({ id: charges.id });

        return { visit: updatedVisit, voidedCharges: voided.length };
      });
      visit = result.visit;
      voidedCharges = result.voidedCharges;
    } else if (input.to === "in_consult") {
      [visit] = await db
        .update(visits)
        .set({ status: "in_consult", startedAt: now, updatedAt: now })
        .where(
          and(
            eq(visits.orgId, scope.orgId),
            eq(visits.id, input.visitId),
            eq(visits.status, "waiting"),
          ),
        )
        .returning();
    } else {
      [visit] = await db
        .update(visits)
        .set({ status: "completed", completedAt: now, updatedAt: now })
        .where(
          and(
            eq(visits.orgId, scope.orgId),
            eq(visits.id, input.visitId),
            eq(visits.status, "in_consult"),
          ),
        )
        .returning();
    }

    if (!visit) {
      return throwForMissingOrStaleVisit(input.visitId, scope.orgId);
    }

    audit({
      action: "visit.transition",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `visit:${input.visitId}`,
      meta:
        input.to === "cancelled"
          ? { to: input.to, voidedCharges: voidedCharges ?? 0 }
          : { to: input.to },
    });

    return visit;
  }),

  queue: orgProcedure(
    { visit: ["read"] },
    orgInput.extend({
      practitionerId: z.string().optional(),
      departmentId: z.string().optional(),
      statuses: z.array(z.enum(VISIT_STATUSES)).optional().default(["waiting", "in_consult"]),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const day = input.date ?? new Date().toISOString().slice(0, 10);
    const start = new Date(`${day}T00:00:00.000Z`);
    const end = new Date(start.getTime() + DAY_MS);

    return db
      .select({
        ...getTableColumns(visits),
        patientName: patients.name,
        patientMrn: patients.mrn,
        patientPhone: patients.phone,
        practitionerName: practitioners.name,
        departmentName: departments.name,
      })
      .from(visits)
      .innerJoin(patients, and(eq(patients.id, visits.patientId), eq(patients.orgId, scope.orgId)))
      .innerJoin(
        practitioners,
        and(eq(practitioners.id, visits.practitionerId), eq(practitioners.orgId, scope.orgId)),
      )
      .innerJoin(
        departments,
        and(eq(departments.id, visits.departmentId), eq(departments.orgId, scope.orgId)),
      )
      .where(
        and(
          eq(visits.orgId, scope.orgId),
          gte(visits.createdAt, start),
          lt(visits.createdAt, end),
          input.practitionerId ? eq(visits.practitionerId, input.practitionerId) : undefined,
          input.departmentId ? eq(visits.departmentId, input.departmentId) : undefined,
          inArray(visits.status, input.statuses),
        ),
      )
      .orderBy(asc(visits.tokenNumber))
      .limit(200);
  }),

  get: orgProcedure({ visit: ["read"] }, orgInput.extend({ visitId: z.string() })).handler(
    async ({ context, input }) => {
      const { scope } = context;
      const [visit] = await db
        .select()
        .from(visits)
        .where(and(eq(visits.orgId, scope.orgId), eq(visits.id, input.visitId)))
        .limit(1);

      if (!visit) {
        throw new ORPCError("NOT_FOUND");
      }

      const [[patient], [practitioner], [department], visitCharges, prescriptions] =
        await Promise.all([
          db
            .select()
            .from(patients)
            .where(and(eq(patients.orgId, scope.orgId), eq(patients.id, visit.patientId)))
            .limit(1),
          db
            .select({ id: practitioners.id, name: practitioners.name })
            .from(practitioners)
            .where(
              and(eq(practitioners.orgId, scope.orgId), eq(practitioners.id, visit.practitionerId)),
            )
            .limit(1),
          db
            .select({ id: departments.id, name: departments.name })
            .from(departments)
            .where(and(eq(departments.orgId, scope.orgId), eq(departments.id, visit.departmentId)))
            .limit(1),
          db
            .select()
            .from(charges)
            .where(and(eq(charges.orgId, scope.orgId), eq(charges.visitId, visit.id)))
            .orderBy(asc(charges.createdAt)),
          db
            .select({
              id: attachments.id,
              fileId: attachments.fileId,
              name: file.name,
              mimeType: file.mimeType,
              size: file.size,
              createdAt: attachments.createdAt,
            })
            .from(attachments)
            .innerJoin(file, and(eq(file.orgId, scope.orgId), eq(file.id, attachments.fileId)))
            .where(
              and(
                eq(attachments.orgId, scope.orgId),
                eq(attachments.targetType, "visit_prescription"),
                eq(attachments.targetId, visit.id),
              ),
            )
            .orderBy(asc(attachments.createdAt)),
        ]);

      if (!patient || !practitioner || !department) {
        throw new ORPCError("NOT_FOUND");
      }

      return { visit, patient, practitioner, department, charges: visitCharges, prescriptions };
    },
  ),

  attachPrescription: orgProcedure(
    { visit: ["update"] },
    orgInput.extend({ visitId: z.string(), fileId: z.string() }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const attachment = await db.transaction(async (tx) => {
      const [visit] = await tx
        .select({ id: visits.id })
        .from(visits)
        .where(
          and(
            eq(visits.orgId, scope.orgId),
            eq(visits.id, input.visitId),
            ne(visits.status, "cancelled"),
          ),
        )
        .limit(1);

      const [readyFile] = await tx
        .select({ id: file.id })
        .from(file)
        .where(
          and(
            eq(file.orgId, scope.orgId),
            eq(file.id, input.fileId),
            eq(file.status, "ready"),
            or(eq(file.mimeType, "application/pdf"), like(file.mimeType, "image/%")),
          ),
        )
        .limit(1)
        .for("key share");

      if (!visit || !readyFile) {
        throw new ORPCError("NOT_FOUND");
      }

      const [created] = await tx
        .insert(attachments)
        .values({
          id: crypto.randomUUID(),
          orgId: scope.orgId,
          targetType: "visit_prescription",
          targetId: visit.id,
          fileId: readyFile.id,
          createdBy: scope.userId,
        })
        .onConflictDoNothing()
        .returning();

      if (!created) {
        throw new ORPCError("CONFLICT");
      }

      return created;
    });

    audit({
      action: "visit.prescription.attach",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `visit:${input.visitId}`,
      meta: { attachmentId: attachment.id, fileId: attachment.fileId },
    });

    return attachment;
  }),

  detachPrescription: orgProcedure(
    { visit: ["update"] },
    orgInput.extend({ attachmentId: z.string() }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const [attachment] = await db
      .delete(attachments)
      .where(
        and(
          eq(attachments.orgId, scope.orgId),
          eq(attachments.targetType, "visit_prescription"),
          eq(attachments.id, input.attachmentId),
        ),
      )
      .returning();

    if (!attachment) {
      throw new ORPCError("NOT_FOUND");
    }

    audit({
      action: "visit.prescription.detach",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `visit:${attachment.targetId}`,
      meta: { attachmentId: attachment.id, fileId: attachment.fileId },
    });

    return attachment;
  }),
};
