import { db } from "@hms/db";
import { nextCounter } from "@hms/db/counter";
import { attachments } from "@hms/db/schema/attachments";
import { catalogItems } from "@hms/db/schema/catalog-items";
import { charges } from "@hms/db/schema/charges";
import { departments } from "@hms/db/schema/departments";
import { file } from "@hms/db/schema/file";
import {
  OPD_APPOINTMENT_STATUSES,
  OPD_KINDS,
  opdAppointments,
} from "@hms/db/schema/opd-appointments";
import { patients } from "@hms/db/schema/patients";
import { practitioners } from "@hms/db/schema/practitioners";
import { ORPCError } from "@orpc/server";
import {
  and,
  asc,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  isNotNull,
  like,
  ne,
  or,
} from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { businessDate, localDateTime } from "../lib/business-date";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { readOrgSettings } from "../lib/settings-cache";

const DAY_MS = 86_400_000;
const dateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const appointmentIdInput = orgInput.extend({ appointmentId: z.string() });
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type FeeItemSnapshot = Pick<
  typeof catalogItems.$inferSelect,
  "id" | "name" | "category" | "unitPrice" | "taxRatePercent" | "taxCode"
>;

async function findActiveCatalogItem(
  executor: typeof db | Transaction,
  catalogItemId: string | null,
  orgId: string,
) {
  if (catalogItemId == null) return undefined;
  const [item] = await executor
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

async function requireCareTeam(
  practitionerId: string,
  departmentId: string,
  patientId: string | null,
  orgId: string,
) {
  const [[practitioner], [department], patientRows] = await Promise.all([
    db
      .select({
        id: practitioners.id,
        departmentId: practitioners.departmentId,
        consultFeeItemId: practitioners.consultFeeItemId,
        followUpFeeItemId: practitioners.followUpFeeItemId,
        followUpValidityDays: practitioners.followUpValidityDays,
      })
      .from(practitioners)
      .where(and(eq(practitioners.orgId, orgId), eq(practitioners.id, practitionerId)))
      .limit(1),
    db
      .select({ id: departments.id, defaultConsultFeeItemId: departments.defaultConsultFeeItemId })
      .from(departments)
      .where(and(eq(departments.orgId, orgId), eq(departments.id, departmentId)))
      .limit(1),
    patientId
      ? db
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
    throw new ORPCError("NOT_FOUND");
  }
  return { practitioner, department };
}

async function chooseConsultFee(
  executor: typeof db | Transaction,
  orgId: string,
  patientId: string,
  practitioner: Awaited<ReturnType<typeof requireCareTeam>>["practitioner"],
  department: Awaited<ReturnType<typeof requireCareTeam>>["department"],
  followUpValidityDays: number,
  now: Date,
): Promise<FeeItemSnapshot | undefined> {
  if (practitioner.followUpFeeItemId != null) {
    const windowDays = practitioner.followUpValidityDays ?? followUpValidityDays;
    const [recent] = await executor
      .select({ id: opdAppointments.id })
      .from(opdAppointments)
      .where(
        and(
          eq(opdAppointments.orgId, orgId),
          eq(opdAppointments.patientId, patientId),
          eq(opdAppointments.practitionerId, practitioner.id),
          eq(opdAppointments.status, "completed"),
          gte(opdAppointments.completedAt, new Date(now.getTime() - windowDays * DAY_MS)),
        ),
      )
      .limit(1);
    if (recent) {
      const fee = await findActiveCatalogItem(executor, practitioner.followUpFeeItemId, orgId);
      if (fee) return fee;
    }
  }
  return (
    (await findActiveCatalogItem(executor, practitioner.consultFeeItemId, orgId)) ??
    (await findActiveCatalogItem(executor, department.defaultConsultFeeItemId, orgId))
  );
}

async function createConsultCharge(
  tx: Transaction,
  appointmentId: string,
  feeItem: FeeItemSnapshot | undefined,
  orgId: string,
  userId: string,
  now: Date,
) {
  if (!feeItem) return null;
  const [charge] = await tx
    .insert(charges)
    .values({
      id: crypto.randomUUID(),
      orgId,
      opdAppointmentId: appointmentId,
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
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!charge) throw new ORPCError("INTERNAL_SERVER_ERROR");
  return charge;
}

async function throwForMissingOrStaleAppointment(
  appointmentId: string,
  orgId: string,
): Promise<never> {
  const [existing] = await db
    .select({ id: opdAppointments.id })
    .from(opdAppointments)
    .where(and(eq(opdAppointments.orgId, orgId), eq(opdAppointments.id, appointmentId)))
    .limit(1);
  throw new ORPCError(existing ? "CONFLICT" : "NOT_FOUND");
}

/**
 * Guarded lifecycle transition shared by every OPD command. The status
 * predicate keeps the UPDATE a no-op when a concurrent command already moved
 * the row — that re-check is load-bearing even after a FOR UPDATE read — so
 * the helper is safe against `db` and inside a transaction alike. Losing the
 * race surfaces as CONFLICT; a missing or foreign row as NOT_FOUND.
 */
async function transitionAppointment(
  executor: typeof db | Transaction,
  orgId: string,
  appointmentId: string,
  fromStatuses: (typeof OPD_APPOINTMENT_STATUSES)[number][],
  set: Partial<typeof opdAppointments.$inferInsert>,
) {
  const [appointment] = await executor
    .update(opdAppointments)
    .set(set)
    .where(
      and(
        eq(opdAppointments.orgId, orgId),
        eq(opdAppointments.id, appointmentId),
        inArray(opdAppointments.status, fromStatuses),
      ),
    )
    .returning();
  if (!appointment) return throwForMissingOrStaleAppointment(appointmentId, orgId);
  return appointment;
}

async function voidPendingCharges(
  tx: Transaction,
  orgId: string,
  appointmentId: string,
  reason: string,
  now: Date,
) {
  const voided = await tx
    .update(charges)
    .set({ status: "voided", voidReason: reason, updatedAt: now })
    .where(
      and(
        eq(charges.orgId, orgId),
        eq(charges.opdAppointmentId, appointmentId),
        eq(charges.status, "pending"),
      ),
    )
    .returning({ id: charges.id });
  return voided.length;
}

const bookInput = orgInput
  .extend({
    patientId: z.string().nullable().optional(),
    callerName: z.string().trim().min(1).max(200).optional(),
    callerPhone: z.string().trim().min(4).max(20).optional(),
    practitionerId: z.string(),
    departmentId: z.string(),
    kind: z.enum(OPD_KINDS).default("consultation"),
    scheduledLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  })
  .superRefine((value, context) => {
    if (!value.patientId && (!value.callerName || !value.callerPhone)) {
      context.addIssue({
        code: "custom",
        path: ["callerName"],
        message: "Choose a patient or enter caller name and phone",
      });
    }
  });

export const opdRouter = {
  book: orgProcedure({ opd: ["create"] }, bookInput).handler(async ({ context, input }) => {
    const { scope } = context;
    const [, { timeZone }] = await Promise.all([
      requireCareTeam(
        input.practitionerId,
        input.departmentId,
        input.patientId ?? null,
        scope.orgId,
      ),
      readOrgSettings(scope.orgId),
    ]);
    const scheduledFor = localDateTime(input.scheduledLocal, timeZone);
    const now = new Date();
    const [appointment] = await db
      .insert(opdAppointments)
      .values({
        id: crypto.randomUUID(),
        orgId: scope.orgId,
        patientId: input.patientId ?? null,
        callerName: input.callerName ?? null,
        callerPhone: input.callerPhone ?? null,
        practitionerId: input.practitionerId,
        departmentId: input.departmentId,
        arrivalMode: "scheduled",
        kind: input.kind,
        status: "booked",
        businessDate: businessDate(scheduledFor, timeZone),
        scheduledFor,
        createdBy: scope.userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!appointment) throw new ORPCError("INTERNAL_SERVER_ERROR");
    audit({
      action: "opd.book",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `opd:${appointment.id}`,
    });
    return appointment;
  }),

  createWalkIn: orgProcedure(
    { opd: ["create"] },
    orgInput.extend({
      patientId: z.string(),
      practitionerId: z.string(),
      departmentId: z.string(),
      kind: z.enum(OPD_KINDS).default("consultation"),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const [{ practitioner, department }, settings] = await Promise.all([
      requireCareTeam(input.practitionerId, input.departmentId, input.patientId, scope.orgId),
      readOrgSettings(scope.orgId),
    ]);
    const now = new Date();
    const day = businessDate(now, settings.timeZone);
    const feeItem = await chooseConsultFee(
      db,
      scope.orgId,
      input.patientId,
      practitioner,
      department,
      settings.followUpValidityDays,
      now,
    );
    const appointmentId = crypto.randomUUID();
    const result = await db.transaction(async (tx) => {
      const tokenNumber = await nextCounter(
        tx,
        scope.orgId,
        `opd-token:${input.practitionerId}:${day}`,
      );
      const [appointment] = await tx
        .insert(opdAppointments)
        .values({
          id: appointmentId,
          orgId: scope.orgId,
          patientId: input.patientId,
          practitionerId: input.practitionerId,
          departmentId: input.departmentId,
          arrivalMode: "walk_in",
          kind: input.kind,
          status: "waiting",
          businessDate: day,
          tokenNumber,
          arrivedAt: now,
          createdBy: scope.userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!appointment) throw new ORPCError("INTERNAL_SERVER_ERROR");
      const charge = await createConsultCharge(
        tx,
        appointment.id,
        feeItem,
        scope.orgId,
        scope.userId,
        now,
      );
      return { appointment, charge };
    });
    audit({
      action: "opd.walk_in.create",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `opd:${appointmentId}`,
    });
    return result;
  }),

  checkIn: orgProcedure(
    { opd: ["update"] },
    appointmentIdInput.extend({ patientId: z.string().optional() }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const settings = await readOrgSettings(scope.orgId);
    const now = new Date();
    const result = await db.transaction(async (tx) => {
      const [booked] = await tx
        .select()
        .from(opdAppointments)
        .where(
          and(
            eq(opdAppointments.orgId, scope.orgId),
            eq(opdAppointments.id, input.appointmentId),
            eq(opdAppointments.status, "booked"),
          ),
        )
        .limit(1)
        .for("update");
      if (!booked) return undefined;
      const patientId = input.patientId ?? booked.patientId;
      if (!patientId) throw new ORPCError("BAD_REQUEST");
      const { practitioner, department } = await requireCareTeam(
        booked.practitionerId,
        booked.departmentId,
        patientId,
        scope.orgId,
      );
      const day = businessDate(now, settings.timeZone);
      const tokenNumber = await nextCounter(
        tx,
        scope.orgId,
        `opd-token:${booked.practitionerId}:${day}`,
      );
      const feeItem = await chooseConsultFee(
        tx,
        scope.orgId,
        patientId,
        practitioner,
        department,
        settings.followUpValidityDays,
        now,
      );
      const appointment = await transitionAppointment(
        tx,
        scope.orgId,
        input.appointmentId,
        ["booked"],
        {
          patientId,
          status: "waiting",
          businessDate: day,
          tokenNumber,
          arrivedAt: now,
          updatedAt: now,
        },
      );
      const charge = await createConsultCharge(
        tx,
        appointment.id,
        feeItem,
        scope.orgId,
        scope.userId,
        now,
      );
      return { appointment, charge };
    });
    if (!result) return throwForMissingOrStaleAppointment(input.appointmentId, scope.orgId);
    return result;
  }),

  reschedule: orgProcedure(
    { opd: ["update"] },
    appointmentIdInput.extend({
      scheduledLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { timeZone } = await readOrgSettings(scope.orgId);
    const scheduledFor = localDateTime(input.scheduledLocal, timeZone);
    return transitionAppointment(db, scope.orgId, input.appointmentId, ["booked"], {
      scheduledFor,
      businessDate: businessDate(scheduledFor, timeZone),
      updatedAt: new Date(),
    });
  }),

  startConsultation: orgProcedure({ opd: ["update"] }, appointmentIdInput).handler(
    async ({ context, input }) => {
      const { scope } = context;
      const now = new Date();
      const appointment = await transitionAppointment(
        db,
        scope.orgId,
        input.appointmentId,
        ["waiting"],
        {
          status: "in_consult",
          consultationStartedAt: now,
          updatedAt: now,
        },
      );
      return appointment;
    },
  ),

  complete: orgProcedure({ opd: ["update"] }, appointmentIdInput).handler(
    async ({ context, input }) => {
      const { scope } = context;
      const now = new Date();
      const appointment = await transitionAppointment(
        db,
        scope.orgId,
        input.appointmentId,
        ["in_consult"],
        {
          status: "completed",
          completedAt: now,
          updatedAt: now,
        },
      );
      return appointment;
    },
  ),

  cancel: orgProcedure(
    { opd: ["update"] },
    appointmentIdInput.extend({ reason: z.string().trim().min(1).max(500) }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const now = new Date();
    const result = await db.transaction(async (tx) => {
      const appointment = await transitionAppointment(
        tx,
        scope.orgId,
        input.appointmentId,
        ["booked", "waiting"],
        { status: "cancelled", cancelledAt: now, cancelReason: input.reason, updatedAt: now },
      );
      const voidedCharges = await voidPendingCharges(
        tx,
        scope.orgId,
        appointment.id,
        input.reason,
        now,
      );
      return { appointment, voidedCharges };
    });
    audit({
      action: "opd.cancel",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `opd:${input.appointmentId}`,
      meta: { voidedCharges: result.voidedCharges },
    });
    return result.appointment;
  }),

  markNoShow: orgProcedure({ opd: ["update"] }, appointmentIdInput).handler(
    async ({ context, input }) => {
      const { scope } = context;
      const now = new Date();
      const result = await db.transaction(async (tx) => {
        const appointment = await transitionAppointment(
          tx,
          scope.orgId,
          input.appointmentId,
          ["booked"],
          { status: "no_show", noShowAt: now, updatedAt: now },
        );
        const voidedCharges = await voidPendingCharges(
          tx,
          scope.orgId,
          appointment.id,
          "No-show",
          now,
        );
        return { appointment, voidedCharges };
      });
      audit({
        action: "opd.no_show",
        actorId: scope.userId,
        orgId: scope.orgId,
        target: `opd:${input.appointmentId}`,
        meta: { voidedCharges: result.voidedCharges },
      });
      return result.appointment;
    },
  ),

  markLeftUnseen: orgProcedure(
    { opd: ["update"] },
    appointmentIdInput.extend({ reason: z.string().trim().min(1).max(500) }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const now = new Date();
    const result = await db.transaction(async (tx) => {
      const appointment = await transitionAppointment(
        tx,
        scope.orgId,
        input.appointmentId,
        ["waiting"],
        { status: "left_unseen", leftUnseenAt: now, cancelReason: input.reason, updatedAt: now },
      );
      const voidedCharges = await voidPendingCharges(
        tx,
        scope.orgId,
        appointment.id,
        input.reason,
        now,
      );
      return { appointment, voidedCharges };
    });
    audit({
      action: "opd.left_unseen",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `opd:${input.appointmentId}`,
      meta: { voidedCharges: result.voidedCharges },
    });
    return result.appointment;
  }),

  queue: orgProcedure(
    { opd: ["read"] },
    orgInput.extend({
      practitionerId: z.string().optional(),
      departmentId: z.string().optional(),
      includeClosed: z.boolean().default(false),
      date: dateInput.optional(),
      cursor: z.object({ arrivedAt: z.coerce.date(), id: z.string() }).optional(),
      limit: z.number().int().min(1).max(200).default(100),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { timeZone } = await readOrgSettings(scope.orgId);
    const day = input.date ?? businessDate(new Date(), timeZone);
    const page = db
      .select({ id: opdAppointments.id, arrivedAt: opdAppointments.arrivedAt })
      .from(opdAppointments)
      .where(
        and(
          eq(opdAppointments.orgId, scope.orgId),
          eq(opdAppointments.businessDate, day),
          isNotNull(opdAppointments.tokenNumber),
          input.practitionerId
            ? eq(opdAppointments.practitionerId, input.practitionerId)
            : undefined,
          input.departmentId ? eq(opdAppointments.departmentId, input.departmentId) : undefined,
          input.includeClosed
            ? undefined
            : inArray(opdAppointments.status, ["waiting", "in_consult"]),
          input.cursor
            ? or(
                gt(opdAppointments.arrivedAt, input.cursor.arrivedAt),
                and(
                  eq(opdAppointments.arrivedAt, input.cursor.arrivedAt),
                  gt(opdAppointments.id, input.cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(asc(opdAppointments.arrivedAt), asc(opdAppointments.id))
      .limit(input.limit + 1)
      .as("opd_queue_page");
    const rows = await db
      .select({
        ...getTableColumns(opdAppointments),
        patientName: patients.name,
        patientMrn: patients.mrn,
        patientPhone: patients.phone,
        practitionerName: practitioners.name,
        departmentName: departments.name,
      })
      .from(page)
      .innerJoin(
        opdAppointments,
        and(eq(opdAppointments.orgId, scope.orgId), eq(opdAppointments.id, page.id)),
      )
      .innerJoin(
        patients,
        and(eq(patients.id, opdAppointments.patientId), eq(patients.orgId, scope.orgId)),
      )
      .innerJoin(
        practitioners,
        and(
          eq(practitioners.id, opdAppointments.practitionerId),
          eq(practitioners.orgId, scope.orgId),
        ),
      )
      .innerJoin(
        departments,
        and(eq(departments.id, opdAppointments.departmentId), eq(departments.orgId, scope.orgId)),
      )
      .orderBy(asc(page.arrivedAt), asc(page.id));
    const items = rows.slice(0, input.limit);
    const last = items[items.length - 1];
    return {
      items,
      nextCursor:
        rows.length > input.limit && last?.arrivedAt
          ? { arrivedAt: last.arrivedAt, id: last.id }
          : null,
    };
  }),

  appointments: orgProcedure(
    { opd: ["read"] },
    orgInput.extend({
      date: dateInput.optional(),
      cursor: z.object({ scheduledFor: z.coerce.date(), id: z.string() }).optional(),
      limit: z.number().int().min(1).max(200).default(100),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { timeZone } = await readOrgSettings(scope.orgId);
    const day = input.date ?? businessDate(new Date(), timeZone);
    const page = db
      .select({ id: opdAppointments.id, scheduledFor: opdAppointments.scheduledFor })
      .from(opdAppointments)
      .where(
        and(
          eq(opdAppointments.orgId, scope.orgId),
          eq(opdAppointments.arrivalMode, "scheduled"),
          eq(opdAppointments.businessDate, day),
          input.cursor
            ? or(
                gt(opdAppointments.scheduledFor, input.cursor.scheduledFor),
                and(
                  eq(opdAppointments.scheduledFor, input.cursor.scheduledFor),
                  gt(opdAppointments.id, input.cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(asc(opdAppointments.scheduledFor), asc(opdAppointments.id))
      .limit(input.limit + 1)
      .as("opd_appointments_page");
    const rows = await db
      .select({
        ...getTableColumns(opdAppointments),
        patientName: patients.name,
        patientMrn: patients.mrn,
        practitionerName: practitioners.name,
        departmentName: departments.name,
      })
      .from(page)
      .innerJoin(
        opdAppointments,
        and(eq(opdAppointments.orgId, scope.orgId), eq(opdAppointments.id, page.id)),
      )
      .leftJoin(
        patients,
        and(eq(patients.id, opdAppointments.patientId), eq(patients.orgId, scope.orgId)),
      )
      .innerJoin(
        practitioners,
        and(
          eq(practitioners.id, opdAppointments.practitionerId),
          eq(practitioners.orgId, scope.orgId),
        ),
      )
      .innerJoin(
        departments,
        and(eq(departments.id, opdAppointments.departmentId), eq(departments.orgId, scope.orgId)),
      )
      .orderBy(asc(page.scheduledFor), asc(page.id));
    const items = rows.slice(0, input.limit);
    const last = items[items.length - 1];
    return {
      items,
      nextCursor:
        rows.length > input.limit && last?.scheduledFor
          ? { scheduledFor: last.scheduledFor, id: last.id }
          : null,
    };
  }),

  get: orgProcedure({ opd: ["read"] }, appointmentIdInput).handler(async ({ context, input }) => {
    const { scope } = context;
    const [appointment] = await db
      .select()
      .from(opdAppointments)
      .where(
        and(eq(opdAppointments.orgId, scope.orgId), eq(opdAppointments.id, input.appointmentId)),
      )
      .limit(1);
    if (!appointment) throw new ORPCError("NOT_FOUND");
    // A booked row may exist on caller details alone, so `patient` is null
    // until check-in links one; caller fields ride on the appointment itself.
    const [[patient], [practitioner], [department], appointmentCharges, prescriptions] =
      await Promise.all([
        appointment.patientId
          ? db
              .select()
              .from(patients)
              .where(and(eq(patients.orgId, scope.orgId), eq(patients.id, appointment.patientId)))
              .limit(1)
          : Promise.resolve([]),
        db
          .select({ id: practitioners.id, name: practitioners.name })
          .from(practitioners)
          .where(
            and(
              eq(practitioners.orgId, scope.orgId),
              eq(practitioners.id, appointment.practitionerId),
            ),
          )
          .limit(1),
        db
          .select({ id: departments.id, name: departments.name })
          .from(departments)
          .where(
            and(eq(departments.orgId, scope.orgId), eq(departments.id, appointment.departmentId)),
          )
          .limit(1),
        db
          .select()
          .from(charges)
          .where(and(eq(charges.orgId, scope.orgId), eq(charges.opdAppointmentId, appointment.id)))
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
              eq(attachments.targetType, "prescription"),
              eq(attachments.targetId, appointment.id),
            ),
          )
          .orderBy(asc(attachments.createdAt)),
      ]);
    if (!practitioner || !department || (appointment.patientId != null && !patient)) {
      throw new ORPCError("NOT_FOUND");
    }
    return {
      appointment,
      patient: patient ?? null,
      practitioner,
      department,
      charges: appointmentCharges,
      prescriptions,
    };
  }),

  attachPrescription: orgProcedure(
    { opd: ["update"] },
    appointmentIdInput.extend({ fileId: z.string() }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const attachment = await db.transaction(async (tx) => {
      const [appointment] = await tx
        .select({ id: opdAppointments.id })
        .from(opdAppointments)
        .where(
          and(
            eq(opdAppointments.orgId, scope.orgId),
            eq(opdAppointments.id, input.appointmentId),
            ne(opdAppointments.status, "cancelled"),
          ),
        )
        .limit(1)
        .for("update");
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
      if (!appointment || !readyFile) throw new ORPCError("NOT_FOUND");
      const [created] = await tx
        .insert(attachments)
        .values({
          id: crypto.randomUUID(),
          orgId: scope.orgId,
          targetType: "prescription",
          targetId: appointment.id,
          fileId: readyFile.id,
          createdBy: scope.userId,
        })
        .onConflictDoNothing()
        .returning();
      if (!created) throw new ORPCError("CONFLICT");
      return created;
    });
    audit({
      action: "opd.prescription.attach",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `opd:${attachment.targetId}`,
      meta: { attachmentId: attachment.id, fileId: attachment.fileId },
    });
    return attachment;
  }),

  detachPrescription: orgProcedure(
    { opd: ["update"] },
    orgInput.extend({ attachmentId: z.string() }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const [attachment] = await db
      .delete(attachments)
      .where(
        and(
          eq(attachments.orgId, scope.orgId),
          eq(attachments.targetType, "prescription"),
          eq(attachments.id, input.attachmentId),
        ),
      )
      .returning();
    if (!attachment) throw new ORPCError("NOT_FOUND");
    audit({
      action: "opd.prescription.detach",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `opd:${attachment.targetId}`,
      meta: { attachmentId: attachment.id, fileId: attachment.fileId },
    });
    return attachment;
  }),
};
