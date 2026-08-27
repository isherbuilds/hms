import { db } from "@hms/db";
import { nextCounter, type DbTransaction } from "@hms/db/counter";
import { attachments } from "@hms/db/schema/attachments";
import { catalogItems } from "@hms/db/schema/catalog-items";
import { charges } from "@hms/db/schema/charges";
import { invoices } from "@hms/db/schema/invoices";
import { departments } from "@hms/db/schema/departments";
import { file } from "@hms/db/schema/file";
import { OPD_APPOINTMENT_STATUSES, opdAppointments } from "@hms/db/schema/opd-appointments";
import { patients } from "@hms/db/schema/patients";
import { practitioners } from "@hms/db/schema/practitioners";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, getTableColumns, gt, gte, ilike, inArray, like, ne, or } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { businessDate, businessDateAnchor, localDateTime, localMinute } from "../lib/business-date";
import { invoiceBalancesFor } from "../lib/invoice-balance";
import {
  computeInvoiceLines,
  fiscalYearLabel,
  fromPaise,
  toPaise,
  toSignedPaise,
} from "../lib/invoice-math";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { readOrgSettings } from "../lib/settings-cache";
import { issueInvoiceTx, recordPaymentTx } from "./billing";

const DAY_MS = 86_400_000;
const dateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const appointmentIdInput = orgInput.extend({ appointmentId: z.string() });
const localMinuteInput = z.iso.datetime({ local: true, precision: -1 });
function futureLocalDateTime(scheduledLocal: string, timeZone: string, now: Date) {
  if (scheduledLocal <= localMinute(now, timeZone)) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Choose a future date and time",
    });
  }
  return localDateTime(scheduledLocal, timeZone);
}
/** Same shape the billing router accepts, so an amount cannot mean two things. */
const money = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/);
const walkInServices = z
  .array(
    z.object({
      catalogItemId: z.string(),
      qty: z.number().int().min(1).max(999).default(1),
    }),
  )
  .max(20)
  .refine(
    (services) =>
      new Set(services.map((service) => service.catalogItemId)).size === services.length,
    { message: "Add each service once and change its quantity instead" },
  )
  .default([]);
const settlementPayment = z
  .object({
    method: z.enum(["cash", "upi", "card"]),
    amount: money.refine((value: string) => toPaise(value) > 0),
    reference: z.string().trim().min(1).max(100).optional(),
  })
  .superRefine((payment, context) => {
    if (payment.method === "cash" || payment.reference) return;
    context.addIssue({
      code: "custom",
      path: ["reference"],
      message: `Add the ${payment.method === "upi" ? "UPI" : "card"} transaction reference`,
    });
  });

type FeeItemSnapshot = Pick<
  typeof catalogItems.$inferSelect,
  "id" | "name" | "category" | "unitPrice" | "taxRatePercent" | "taxCode"
>;

async function findActiveCatalogItem(
  executor: typeof db | DbTransaction,
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

/**
 * Resolves editable additional services from browser-provided ID claims.
 * Consultation items are server-selected only.
 */
async function findActiveServiceItems(
  executor: typeof db | DbTransaction,
  catalogItemIds: string[],
  orgId: string,
): Promise<Map<string, FeeItemSnapshot>> {
  if (catalogItemIds.length === 0) return new Map();
  const rows = await executor
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
        inArray(catalogItems.id, catalogItemIds),
        eq(catalogItems.active, true),
        ne(catalogItems.category, "consultation"),
      ),
    );
  return new Map(rows.map((row) => [row.id, row]));
}

function requireCatalogItem(items: Map<string, FeeItemSnapshot>, catalogItemId: string) {
  const item = items.get(catalogItemId);
  if (!item) throw new ORPCError("NOT_FOUND");
  return item;
}

async function requireCareTeam(
  executor: typeof db | DbTransaction,
  practitionerId: string,
  departmentId: string,
  patientId: string | null,
  orgId: string,
) {
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
      .where(and(eq(practitioners.orgId, orgId), eq(practitioners.id, practitionerId)))
      .limit(1),
    executor
      .select({ id: departments.id, defaultConsultFeeItemId: departments.defaultConsultFeeItemId })
      .from(departments)
      .where(and(eq(departments.orgId, orgId), eq(departments.id, departmentId)))
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
    throw new ORPCError("NOT_FOUND");
  }
  return { practitioner, department };
}

async function chooseConsultFee(
  executor: typeof db | DbTransaction,
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
          eq(opdAppointments.status, "checked_in"),
          gte(opdAppointments.arrivedAt, new Date(now.getTime() - windowDays * DAY_MS)),
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
  tx: DbTransaction,
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
      id: Bun.randomUUIDv7(),
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

async function serviceChargeValues(
  executor: typeof db | DbTransaction,
  appointmentId: string,
  services: z.infer<typeof walkInServices>,
  orgId: string,
  userId: string,
  now: Date,
) {
  const serviceItems = await findActiveServiceItems(
    executor,
    services.map((service) => service.catalogItemId),
    orgId,
  );
  const values = services.map((service) => {
    const item = requireCatalogItem(serviceItems, service.catalogItemId);
    return {
      id: Bun.randomUUIDv7(),
      orgId,
      opdAppointmentId: appointmentId,
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
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    } as const;
  });
  return values;
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
  executor: typeof db | DbTransaction,
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
  tx: DbTransaction,
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
    scheduledLocal: localMinuteInput,
    services: walkInServices,
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
    const { timeZone } = await readOrgSettings(scope.orgId);
    const now = new Date();
    const scheduledFor = futureLocalDateTime(input.scheduledLocal, timeZone, now);
    return db.transaction(async (tx) => {
      const appointmentId = Bun.randomUUIDv7();
      await requireCareTeam(
        tx,
        input.practitionerId,
        input.departmentId,
        input.patientId ?? null,
        scope.orgId,
      );
      const serviceCharges = await serviceChargeValues(
        tx,
        appointmentId,
        input.services,
        scope.orgId,
        scope.userId,
        now,
      );
      const [appointment] = await tx
        .insert(opdAppointments)
        .values({
          id: appointmentId,
          orgId: scope.orgId,
          patientId: input.patientId ?? null,
          callerName: input.callerName ?? null,
          callerPhone: input.callerPhone ?? null,
          practitionerId: input.practitionerId,
          departmentId: input.departmentId,
          arrivalMode: "scheduled",
          status: "booked",
          businessDate: businessDate(scheduledFor, timeZone),
          scheduledFor,
          createdBy: scope.userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!appointment) throw new ORPCError("INTERNAL_SERVER_ERROR");
      if (serviceCharges.length > 0) await tx.insert(charges).values(serviceCharges);
      return appointment;
    });
  }),

  /**
   * What the walk-in will cost, before anything is created. The fee depends on
   * whether this patient counts as a follow-up, which only the server knows —
   * so the desk cannot work it out and a page that collects money first has to
   * ask.
   */
  quoteWalkIn: orgProcedure(
    { opd: ["read"], patient: ["read"] },
    orgInput.extend({
      patientId: z.string(),
      practitionerId: z.string(),
      departmentId: z.string(),
      services: walkInServices,
      omitConsultFee: z.boolean().optional(),
      discountAmount: money.default("0"),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const [{ practitioner, department }, settings, serviceItems] = await Promise.all([
      requireCareTeam(db, input.practitionerId, input.departmentId, input.patientId, scope.orgId),
      readOrgSettings(scope.orgId),
      findActiveServiceItems(
        db,
        input.services.map((service) => service.catalogItemId),
        scope.orgId,
      ),
    ]);
    const feeItem = !input.omitConsultFee
      ? await chooseConsultFee(
          db,
          scope.orgId,
          input.patientId,
          practitioner,
          department,
          settings.followUpValidityDays,
          new Date(),
        )
      : undefined;
    const quotedItems = [
      ...(feeItem ? [{ item: feeItem, qty: 1, source: "consultation" as const }] : []),
      ...input.services.map((service) => ({
        item: requireCatalogItem(serviceItems, service.catalogItemId),
        qty: service.qty,
        source: "service" as const,
      })),
    ];
    const subtotalPaise = quotedItems.reduce(
      (sum, { item, qty }) => sum + qty * toPaise(item.unitPrice),
      0,
    );
    if (toPaise(input.discountAmount) > subtotalPaise) {
      throw new ORPCError("BAD_REQUEST", { message: "Discount exceeds the bill subtotal" });
    }
    const computed = computeInvoiceLines(
      quotedItems.map(({ item, qty }) => ({
        chargeId: item.id,
        description: item.name,
        qty,
        unitPrice: item.unitPrice,
        taxRatePercent: item.taxRatePercent,
        taxCode: item.taxCode,
      })),
      input.discountAmount,
    );

    return {
      currency: settings.currency,
      lines: computed.lines.map((line, index) => {
        const quoted = quotedItems[index];
        if (!quoted) throw new Error("Computed invoice line has no quoted item");
        return { ...line, category: quoted.item.category, source: quoted.source };
      }),
      subtotal: computed.subtotal,
      discountAmount: input.discountAmount,
      taxTotal: computed.taxTotal,
      grandTotal: computed.grandTotal,
    };
  }),

  createWalkIn: orgProcedure(
    { opd: ["create"], patient: ["read"], billing: ["write"] },
    orgInput.extend({
      patientId: z.string(),
      practitionerId: z.string(),
      departmentId: z.string(),
      settlement: z.object({
        /** Anything the desk already knows about, billed with the consultation. */
        services: walkInServices,
        omitConsultFee: z.boolean().optional(),
        discountAmount: money.default("0"),
        payments: z.array(settlementPayment).max(4).default([]),
        /** Required whenever there is a discount, or the bill is not cleared. */
        note: z.string().trim().max(500).optional(),
      }),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const settings = await readOrgSettings(scope.orgId);
    const now = new Date();
    const day = businessDate(now, settings.timeZone);
    const appointmentId = Bun.randomUUIDv7();
    const settlement = input.settlement;
    const billing = {
      settings,
      now,
      fiscalYear: fiscalYearLabel(
        businessDateAnchor(now, settings.timeZone),
        settings.fiscalYearStartMonth,
      ),
    };

    const result = await db.transaction(async (tx) => {
      const { practitioner, department } = await requireCareTeam(
        tx,
        input.practitionerId,
        input.departmentId,
        input.patientId,
        scope.orgId,
      );
      const serviceCharges = await serviceChargeValues(
        tx,
        appointmentId,
        input.settlement.services,
        scope.orgId,
        scope.userId,
        now,
      );
      const feeItem = input.settlement.omitConsultFee
        ? undefined
        : await chooseConsultFee(
            tx,
            scope.orgId,
            input.patientId,
            practitioner,
            department,
            settings.followUpValidityDays,
            now,
          );
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
          status: "checked_in",
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

      if (serviceCharges.length > 0) await tx.insert(charges).values(serviceCharges);

      if (!charge && settlement.services.length === 0) {
        if (toPaise(settlement.discountAmount) > 0 || settlement.payments.length > 0) {
          throw new ORPCError("BAD_REQUEST", {
            message: "A zero-value walk-in cannot record a discount or payment",
          });
        }
        return { appointment, charge: null, invoice: null, payments: [] };
      }

      // The whole settlement rides on this transaction: either the desk gets a
      // token with its bill posted and its money recorded, or it gets nothing
      // and can try again. There is no state where a token exists owing money
      // nobody chose to owe.
      const invoiceId = Bun.randomUUIDv7();
      const { invoice } = await issueInvoiceTx(tx, {
        scope,
        appointmentId: appointment.id,
        discountAmount: settlement.discountAmount,
        note: settlement.note,
        settings: billing.settings,
        now: billing.now,
        fiscalYear: billing.fiscalYear,
        invoiceId,
      });

      const collected = settlement.payments.reduce(
        (sum, payment) => sum + toPaise(payment.amount),
        0,
      );
      // Charges are meant to be cleared before the token exists. Leaving a
      // balance is allowed, but it is a decision someone made, so it is a
      // decision someone has to explain.
      if (collected < toPaise(invoice.grandTotal) && !settlement.note) {
        throw new ORPCError("BAD_REQUEST", {
          message: "The invoice total changed. Review the settlement and try again",
        });
      }

      const recordedPayments = [];
      for (const payment of settlement.payments) {
        const paymentId = Bun.randomUUIDv7();
        const recorded = await recordPaymentTx(tx, {
          scope,
          invoiceId,
          method: payment.method,
          amount: payment.amount,
          reference: payment.reference,
          settings: billing.settings,
          now: billing.now,
          fiscalYear: billing.fiscalYear,
          paymentId,
        });
        recordedPayments.push(recorded);
      }

      // `issueInvoiceTx` just marked every pending charge on this appointment
      // as invoiced; reflect that in the returned snapshot instead of the
      // pre-settlement row captured above.
      return {
        appointment,
        charge: charge ? { ...charge, status: "invoiced" as const, invoiceId } : charge,
        invoice,
        payments: recordedPayments,
      };
    });
    audit({
      action: "opd.walk_in.create",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `opd:${appointmentId}`,
    });
    if (result.invoice) {
      audit({
        action: "invoice.issue",
        actorId: scope.userId,
        orgId: scope.orgId,
        target: `invoice:${result.invoice.id}`,
        meta: {
          invoiceNumber: result.invoice.invoiceNumber,
          grandTotal: result.invoice.grandTotal,
        },
      });
    }
    for (const payment of result.payments) {
      audit({
        action: "payment.record",
        actorId: scope.userId,
        orgId: scope.orgId,
        target: `payment:${payment.id}`,
        meta: { receiptNumber: payment.receiptNumber, amount: payment.amount },
      });
    }
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
      if (!patientId) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Choose a patient before check-in",
        });
      }
      const { practitioner, department } = await requireCareTeam(
        tx,
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
          status: "checked_in",
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
      scheduledLocal: localMinuteInput,
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { timeZone } = await readOrgSettings(scope.orgId);
    const now = new Date();
    const scheduledFor = futureLocalDateTime(input.scheduledLocal, timeZone, now);
    return transitionAppointment(db, scope.orgId, input.appointmentId, ["booked"], {
      scheduledFor,
      businessDate: businessDate(scheduledFor, timeZone),
      updatedAt: now,
    });
  }),

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
        ["booked", "checked_in"],
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

  day: orgProcedure(
    { opd: ["read"] },
    orgInput.extend({
      date: dateInput.optional(),
      q: z.string().trim().min(1).max(100).optional(),
      includeClosed: z.boolean().default(false),
      cursor: z.object({ dayOrderAt: z.coerce.date(), id: z.string() }).optional(),
      limit: z.number().int().min(1).max(200).default(100),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { timeZone } = await readOrgSettings(scope.orgId);
    const now = new Date();
    const currentDay = businessDate(now, timeZone);
    const day = input.date ?? currentDay;

    if (day < currentDay) {
      const swept = await db.transaction(async (tx) => {
        const closed = await tx
          .update(opdAppointments)
          .set({ status: "no_show", noShowAt: now, updatedAt: now })
          .where(
            and(
              eq(opdAppointments.orgId, scope.orgId),
              eq(opdAppointments.businessDate, day),
              eq(opdAppointments.status, "booked"),
            ),
          )
          .returning({ id: opdAppointments.id });
        if (closed.length === 0) return [];

        const voided = await tx
          .update(charges)
          .set({ status: "voided", voidReason: "No-show", updatedAt: now })
          .where(
            and(
              eq(charges.orgId, scope.orgId),
              inArray(
                charges.opdAppointmentId,
                closed.map((appointment) => appointment.id),
              ),
              eq(charges.status, "pending"),
            ),
          )
          .returning({ appointmentId: charges.opdAppointmentId });
        const voidedByAppointment = new Map<string, number>();
        for (const charge of voided) {
          voidedByAppointment.set(
            charge.appointmentId,
            (voidedByAppointment.get(charge.appointmentId) ?? 0) + 1,
          );
        }
        return closed.map((appointment) => ({
          id: appointment.id,
          voidedCharges: voidedByAppointment.get(appointment.id) ?? 0,
        }));
      });
      for (const appointment of swept) {
        audit({
          action: "opd.no_show",
          actorId: scope.userId,
          orgId: scope.orgId,
          target: `opd:${appointment.id}`,
          meta: { voidedCharges: appointment.voidedCharges, source: "past_day_sweep" },
        });
      }
    }
    const pagePredicate = and(
      eq(opdAppointments.orgId, scope.orgId),
      eq(opdAppointments.businessDate, day),
      input.includeClosed
        ? inArray(opdAppointments.status, OPD_APPOINTMENT_STATUSES)
        : inArray(opdAppointments.status, ["booked", "checked_in"]),
      input.cursor
        ? or(
            gt(opdAppointments.dayOrderAt, input.cursor.dayOrderAt),
            and(
              eq(opdAppointments.dayOrderAt, input.cursor.dayOrderAt),
              gt(opdAppointments.id, input.cursor.id),
            ),
          )
        : undefined,
    );
    const pageColumns = { id: opdAppointments.id, dayOrderAt: opdAppointments.dayOrderAt };
    const tokenNumber =
      input.q && /^\d+$/.test(input.q) && Number(input.q) <= 2_147_483_647
        ? Number(input.q)
        : undefined;
    const page = input.q
      ? db
          .select(pageColumns)
          .from(opdAppointments)
          .leftJoin(
            patients,
            and(eq(patients.orgId, scope.orgId), eq(patients.id, opdAppointments.patientId)),
          )
          .where(
            and(
              pagePredicate,
              or(
                ilike(patients.name, `%${input.q}%`),
                ilike(patients.mrn, `%${input.q}%`),
                ilike(patients.phone, `%${input.q}%`),
                tokenNumber === undefined
                  ? undefined
                  : eq(opdAppointments.tokenNumber, tokenNumber),
              ),
            ),
          )
          .orderBy(asc(opdAppointments.dayOrderAt), asc(opdAppointments.id))
          .limit(input.limit + 1)
          .as("opd_day_page")
      : db
          .select(pageColumns)
          .from(opdAppointments)
          .where(pagePredicate)
          .orderBy(asc(opdAppointments.dayOrderAt), asc(opdAppointments.id))
          .limit(input.limit + 1)
          .as("opd_day_page");

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
      .orderBy(asc(page.dayOrderAt), asc(page.id));

    const pageRows = rows.slice(0, input.limit);
    const appointmentInvoices =
      pageRows.length === 0
        ? []
        : await db
            .select({
              id: invoices.id,
              opdAppointmentId: invoices.opdAppointmentId,
              grandTotal: invoices.grandTotal,
            })
            .from(invoices)
            .where(
              and(
                eq(invoices.orgId, scope.orgId),
                inArray(
                  invoices.opdAppointmentId,
                  pageRows.map((row) => row.id),
                ),
              ),
            );
    const balances = await invoiceBalancesFor(db, scope.orgId, appointmentInvoices);
    const dueByAppointment = new Map<string, number>();
    for (const invoice of appointmentInvoices) {
      const outstanding = balances.get(invoice.id)?.outstanding;
      if (outstanding === undefined) continue;
      dueByAppointment.set(
        invoice.opdAppointmentId,
        (dueByAppointment.get(invoice.opdAppointmentId) ?? 0) + toSignedPaise(outstanding),
      );
    }
    const items = pageRows.map((row) => ({
      ...row,
      balanceDue: fromPaise(dueByAppointment.get(row.id) ?? 0),
    }));
    const last = items[items.length - 1];
    return {
      items,
      nextCursor:
        rows.length > input.limit && last?.dayOrderAt
          ? { dayOrderAt: last.dayOrderAt, id: last.id }
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
          id: Bun.randomUUIDv7(),
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
