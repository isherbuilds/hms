import { db } from "@hms/db";
import { nextCounter, type DbTransaction } from "@hms/db/counter";
import { attachments } from "@hms/db/schema/attachments";
import { charges } from "@hms/db/schema/charges";
import { invoices } from "@hms/db/schema/invoices";
import { departments } from "@hms/db/schema/departments";
import { file } from "@hms/db/schema/file";
import { OPD_APPOINTMENT_STATUSES, opdAppointments } from "@hms/db/schema/opd-appointments";
import { patients } from "@hms/db/schema/patients";
import { practitioners } from "@hms/db/schema/practitioners";
import { treatmentPlans } from "@hms/db/schema/treatment-plans";
import { ORPCError } from "@orpc/server";
import {
  and,
  asc,
  between,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  like,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { formatDecimal } from "../core/money";
import { impossible } from "../lib/conflict";
import { businessDate, localDateTime, localMinute } from "../lib/business-date";
import { invoiceBalancesFor } from "../lib/invoice-balance";
import { computeInvoiceLines } from "../lib/invoice-math";
import { closeExpiredBookings, voidPendingCharges } from "../lib/opd-close";
import { chargeRow, resolveOpdPricing } from "../lib/opd-charges";
import { normalizePhone } from "../lib/phone";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { readOrgSettings } from "../lib/settings-cache";
import {
  dayRange,
  money,
  note,
  paymentLine,
  phone,
  reason,
  resolveDayRange,
  likePattern,
  searchQuery,
  personName,
} from "../lib/schemas";
import { billingDocumentContext } from "../lib/billing-documents";
import { settleInvoiceTx } from "./billing";

const appointmentIdInput = orgInput.extend({ appointmentId: z.string() });

const localMinuteInput = z.iso.datetime({ local: true, precision: -1 });

const serviceLines = z
  .array(
    z.object({
      catalogItemId: z.string(),
      qty: z.number().int().min(1).max(999).default(1),
      unitPrice: money.optional(),
    }),
  )
  .max(20)
  .refine((lines) => new Set(lines.map((line) => line.catalogItemId)).size === lines.length, {
    message: "Add each service once and change its quantity instead",
  });

function futureLocalDateTime(scheduledLocal: string, timeZone: string, now: Date) {
  if (scheduledLocal <= localMinute(now, timeZone)) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Choose a future date and time",
    });
  }

  try {
    return localDateTime(scheduledLocal, timeZone);
  } catch {
    // Only a DST gap is left, and that is the operator's input.
    throw new ORPCError("BAD_REQUEST", {
      message: "That time does not exist on that day in this timezone",
    });
  }
}

// The status predicate keeps the UPDATE a no-op after a concurrent move, even after FOR UPDATE.
async function transitionAppointment(options: {
  executor: typeof db | DbTransaction;
  orgId: string;
  appointmentId: string;
  from: (typeof OPD_APPOINTMENT_STATUSES)[number][];
  set: Partial<typeof opdAppointments.$inferInsert>;
}) {
  const { orgId, appointmentId } = options;

  const [appointment] = await options.executor
    .update(opdAppointments)
    .set(options.set)
    .where(
      and(
        eq(opdAppointments.orgId, orgId),
        eq(opdAppointments.id, appointmentId),
        inArray(opdAppointments.status, options.from),
      ),
    )
    .returning();

  if (!appointment) {
    throw new ORPCError("CONFLICT", {
      message: "That appointment was already moved or no longer exists.",
    });
  }

  return appointment;
}

/** A sitting belongs to an open plan of the same patient. Double-charging is `treatment.postToVisit`'s rule. */
async function requireOpenTreatmentPlan(
  tx: DbTransaction,
  orgId: string,
  treatmentPlanId: string | undefined,
  patientId: string | null | undefined,
) {
  if (!treatmentPlanId) return null;

  if (!patientId) {
    throw new ORPCError("BAD_REQUEST", { message: "Choose a patient for this sitting." });
  }

  const [plan] = await tx
    .select({ id: treatmentPlans.id })
    .from(treatmentPlans)
    .where(
      and(
        eq(treatmentPlans.orgId, orgId),
        eq(treatmentPlans.id, treatmentPlanId),
        eq(treatmentPlans.patientId, patientId),
        eq(treatmentPlans.status, "open"),
      ),
    )
    .limit(1)
    .for("update");

  if (!plan) {
    throw new ORPCError("CONFLICT", { message: "That treatment plan is no longer available." });
  }

  return plan;
}

const bookInput = orgInput
  .extend({
    patientId: z.string().nullable().optional(),
    callerName: personName.optional(),
    callerPhone: phone.optional(),
    practitionerId: z.string(),
    scheduledLocal: localMinuteInput,
    treatmentPlanId: z.string().optional(),
    services: serviceLines.default([]),
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
    const settings = await readOrgSettings(scope.orgId);
    const now = new Date();
    const scheduledFor = futureLocalDateTime(input.scheduledLocal, settings.timeZone, now);

    const pricing = await resolveOpdPricing({
      orgId: scope.orgId,
      practitionerId: input.practitionerId,
      patientId: input.patientId ?? null,
      services: input.services,
      consultation: "none",
      followUpValidityDays: settings.followUpValidityDays,
      now,
    });

    const appointmentId = Bun.randomUUIDv7();

    const chargeRows = pricing.serviceItems.map((line) =>
      chargeRow({
        ...line,
        orgId: scope.orgId,
        appointmentId,
        sourceType: "catalog",
        userId: scope.userId,
        now,
      }),
    );

    return db.transaction(async (tx) => {
      const plan = await requireOpenTreatmentPlan(
        tx,
        scope.orgId,
        input.treatmentPlanId,
        input.patientId,
      );

      const [appointment] = await tx
        .insert(opdAppointments)
        .values({
          id: appointmentId,
          orgId: scope.orgId,
          patientId: input.patientId ?? null,
          treatmentPlanId: plan?.id ?? null,
          callerName: input.callerName ?? null,
          callerPhone: input.callerPhone ?? null,
          practitionerId: input.practitionerId,
          departmentId: pricing.departmentId,
          arrivalMode: "scheduled",
          status: "booked",
          businessDate: businessDate(scheduledFor, settings.timeZone),
          scheduledFor,
          createdBy: scope.userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!appointment) throw impossible("appointment insert returned no row");

      if (chargeRows.length > 0) {
        await tx.insert(charges).values(chargeRows);
      }

      return appointment;
    });
  }),

  quoteWalkIn: orgProcedure(
    { opd: ["read"], patient: ["read"] },
    orgInput.extend({
      patientId: z.string(),
      practitionerId: z.string(),
      services: serviceLines.default([]),
      omitConsultFee: z.boolean().optional(),
      discountAmount: money.default(0n),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const settings = await readOrgSettings(scope.orgId);

    const pricing = await resolveOpdPricing({
      orgId: scope.orgId,
      practitionerId: input.practitionerId,
      patientId: input.patientId,
      services: input.services,
      consultation: input.omitConsultFee ? "omit" : "auto",
      followUpValidityDays: settings.followUpValidityDays,
      now: new Date(),
    });

    const quotedItems = [
      ...(pricing.fee ? [{ ...pricing.fee, source: "consultation" as const }] : []),
      ...pricing.serviceItems.map((line) => ({ ...line, source: "service" as const })),
    ];

    const subtotalPaise = quotedItems.reduce(
      (sum, { unitPrice, qty }) => sum + BigInt(qty) * unitPrice,
      0n,
    );

    if (input.discountAmount > subtotalPaise) {
      throw new ORPCError("BAD_REQUEST", { message: "Discount exceeds the bill subtotal" });
    }

    const computed = computeInvoiceLines(
      quotedItems.map(({ item, qty, unitPrice }) => ({
        chargeId: item.id,
        description: item.name,
        qty,
        unitPrice,
        priceUnits: 1,
        taxRatePercent: item.taxRatePercent,
        taxCode: item.taxCode,
      })),
      input.discountAmount,
      "opd",
    );

    return {
      currency: settings.currency,
      lines: computed.lines.map((line, index) => {
        const quoted = quotedItems[index];

        if (!quoted) throw new Error("Computed invoice line has no quoted item");

        return {
          ...line,
          category: quoted.item.category,
          source: quoted.source,
        };
      }),
      subtotal: computed.subtotal,
      discountAmount: input.discountAmount,
      taxTotal: computed.taxTotal,
      roundOff: computed.roundOff,
      grandTotal: computed.grandTotal,
    };
  }),

  createWalkIn: orgProcedure(
    { opd: ["create"], patient: ["read"], billing: ["write"] },
    orgInput.extend({
      patientId: z.string(),
      practitionerId: z.string(),
      treatmentPlanId: z.string().optional(),
      settlement: z.object({
        services: serviceLines.default([]),
        omitConsultFee: z.boolean().optional(),
        discountAmount: money.default(0n),
        expectedGrandTotal: money,
        payments: z.array(paymentLine).max(4).default([]),
        applyCredit: money.default(0n),
        note,
      }),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const billing = await billingDocumentContext(scope.orgId);
    const day = businessDate(billing.now, billing.settings.timeZone);
    const appointmentId = Bun.randomUUIDv7();
    const settlement = input.settlement;

    const pricing = await resolveOpdPricing({
      orgId: scope.orgId,
      practitionerId: input.practitionerId,
      patientId: input.patientId,
      services: settlement.services,
      consultation: settlement.omitConsultFee ? "omit" : "auto",
      followUpValidityDays: billing.settings.followUpValidityDays,
      now: billing.now,
    });

    const chargeRows = [
      ...(pricing.fee
        ? [
            chargeRow({
              ...pricing.fee,
              orgId: scope.orgId,
              appointmentId,
              sourceType: "consult_fee",
              userId: scope.userId,
              now: billing.now,
            }),
          ]
        : []),
      ...pricing.serviceItems.map((line) =>
        chargeRow({
          ...line,
          orgId: scope.orgId,
          appointmentId,
          sourceType: "catalog",
          userId: scope.userId,
          now: billing.now,
        }),
      ),
    ];

    const result = await db.transaction(async (tx) => {
      const plan = await requireOpenTreatmentPlan(
        tx,
        scope.orgId,
        input.treatmentPlanId,
        input.patientId,
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
          treatmentPlanId: plan?.id ?? null,
          practitionerId: input.practitionerId,
          departmentId: pricing.departmentId,
          arrivalMode: "walk_in",
          status: "checked_in",
          businessDate: day,
          tokenNumber,
          arrivedAt: billing.now,
          createdBy: scope.userId,
          createdAt: billing.now,
          updatedAt: billing.now,
        })
        .returning();

      if (!appointment) throw impossible("appointment insert returned no row");

      if (chargeRows.length > 0) {
        await tx.insert(charges).values(chargeRows);
      }

      if (chargeRows.length === 0) {
        if (settlement.expectedGrandTotal !== 0n) {
          throw new ORPCError("CONFLICT", {
            message: "The charges changed. Review the settlement and try again",
          });
        }

        if (
          settlement.discountAmount > 0n ||
          settlement.payments.length > 0 ||
          settlement.applyCredit > 0n
        ) {
          throw new ORPCError("BAD_REQUEST", {
            message: "A zero-value walk-in cannot record a discount or payment",
          });
        }

        return { appointment, invoice: null, payments: [] };
      }

      const invoiceId = Bun.randomUUIDv7();

      const settled = await settleInvoiceTx(tx, {
        scope,
        appointmentId: appointment.id,
        discountAmount: settlement.discountAmount,
        note: settlement.note,
        settings: billing.settings,
        now: billing.now,
        fiscalYear: billing.fiscalYear,
        invoiceId,
        payments: settlement.payments,
        applyCredit: settlement.applyCredit,
        expectedGrandTotal: settlement.expectedGrandTotal,
        // This transaction inserted the appointment, so no concurrent charge writer exists.
        expectedChargeRevision: "fresh",
      });

      return {
        appointment: { ...appointment, chargeRevision: settled.chargeRevision },
        invoice: settled.invoice,
        payments: settled.payments,
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
          grandTotal: formatDecimal(result.invoice.grandTotal),
        },
      });
    }

    for (const payment of result.payments) {
      audit({
        action: "payment.record",
        actorId: scope.userId,
        orgId: scope.orgId,
        target: `payment:${payment.id}`,
        meta: { receiptNumber: payment.receiptNumber, amount: formatDecimal(payment.amount) },
      });
    }

    return result;
  }),

  checkIn: orgProcedure(
    { opd: ["update"] },
    appointmentIdInput.extend({ patientId: z.string().optional() }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const now = new Date();

    const [settings, [snapshot]] = await Promise.all([
      readOrgSettings(scope.orgId),
      db
        .select({
          patientId: opdAppointments.patientId,
          practitionerId: opdAppointments.practitionerId,
          departmentId: opdAppointments.departmentId,
          status: opdAppointments.status,
        })
        .from(opdAppointments)
        .where(
          and(eq(opdAppointments.orgId, scope.orgId), eq(opdAppointments.id, input.appointmentId)),
        )
        .limit(1),
    ]);

    if (!snapshot) {
      throw new ORPCError("NOT_FOUND", { message: "That appointment no longer exists." });
    }

    if (snapshot.status !== "booked") {
      throw new ORPCError("CONFLICT", {
        message: "That appointment was already moved.",
      });
    }

    const patientId = input.patientId ?? snapshot.patientId;

    if (!patientId) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Choose a patient before check-in",
      });
    }

    const pricing = await resolveOpdPricing({
      orgId: scope.orgId,
      practitionerId: snapshot.practitionerId,
      patientId,
      services: [],
      consultation: "auto",
      followUpValidityDays: settings.followUpValidityDays,
      now,
    });

    if (pricing.departmentId !== snapshot.departmentId) {
      throw new ORPCError("CONFLICT", {
        message: "That practitioner moved departments after this appointment was booked.",
      });
    }

    const day = businessDate(now, settings.timeZone);

    return db.transaction(async (tx) => {
      const [booked] = await tx
        .select({ id: opdAppointments.id })
        .from(opdAppointments)
        .where(
          and(
            eq(opdAppointments.orgId, scope.orgId),
            eq(opdAppointments.id, input.appointmentId),
            eq(opdAppointments.status, "booked"),
            or(isNull(opdAppointments.treatmentPlanId), eq(opdAppointments.patientId, patientId)),
          ),
        )
        .limit(1)
        .for("update");

      if (!booked) {
        throw new ORPCError("CONFLICT", {
          message: "That appointment was already moved or no longer exists.",
        });
      }

      const tokenNumber = await nextCounter(
        tx,
        scope.orgId,
        `opd-token:${snapshot.practitionerId}:${day}`,
      );

      const appointment = await transitionAppointment({
        executor: tx,
        orgId: scope.orgId,
        appointmentId: input.appointmentId,
        from: ["booked"],
        set: {
          patientId,
          status: "checked_in",
          businessDate: day,
          tokenNumber,
          arrivedAt: now,
          updatedAt: now,
        },
      });

      let charge: typeof charges.$inferSelect | null = null;

      if (pricing.fee) {
        const [inserted] = await tx
          .insert(charges)
          .values(
            chargeRow({
              ...pricing.fee,
              orgId: scope.orgId,
              appointmentId: appointment.id,
              sourceType: "consult_fee",
              userId: scope.userId,
              now,
            }),
          )
          .returning();

        if (!inserted) throw impossible("consult fee charge insert returned no row");
        charge = inserted;
      }

      return {
        appointment,
        charge,
      };
    });
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

    return transitionAppointment({
      executor: db,
      orgId: scope.orgId,
      appointmentId: input.appointmentId,
      from: ["booked"],
      set: {
        scheduledFor,
        businessDate: businessDate(scheduledFor, timeZone),
        updatedAt: now,
      },
    });
  }),

  cancel: orgProcedure({ opd: ["update"] }, appointmentIdInput.extend({ reason })).handler(
    async ({ context, input }) => {
      const { scope } = context;
      const now = new Date();

      const result = await db.transaction(async (tx) => {
        const appointment = await transitionAppointment({
          executor: tx,
          orgId: scope.orgId,
          appointmentId: input.appointmentId,
          from: ["booked", "checked_in"],
          set: {
            status: "cancelled",
            cancelledAt: now,
            cancelReason: input.reason,
            updatedAt: now,
          },
        });

        const voided = await voidPendingCharges({
          tx,
          orgId: scope.orgId,
          where: eq(charges.opdAppointmentId, appointment.id),
          reason: input.reason,
          now,
        });

        const voidedCharges = voided.length;

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
    },
  ),

  markNoShow: orgProcedure({ opd: ["update"] }, appointmentIdInput).handler(
    async ({ context, input }) => {
      const { scope } = context;
      const now = new Date();

      const result = await db.transaction(async (tx) => {
        const appointment = await transitionAppointment({
          executor: tx,
          orgId: scope.orgId,
          appointmentId: input.appointmentId,
          from: ["booked"],
          set: { status: "no_show", noShowAt: now, updatedAt: now },
        });

        const voided = await voidPendingCharges({
          tx,
          orgId: scope.orgId,
          where: eq(charges.opdAppointmentId, appointment.id),
          reason: "No-show",
          now,
        });

        const voidedCharges = voided.length;

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
      ...dayRange,
      q: searchQuery,
      includeClosed: z.boolean().default(false),
      cursor: z.object({ dayOrderAt: z.coerce.date(), id: z.string() }).optional(),
      limit: z.number().int().min(1).max(200).default(100),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { timeZone } = await readOrgSettings(scope.orgId);
    const now = new Date();
    const currentDay = businessDate(now, timeZone);
    const { from, to } = resolveDayRange(input, currentDay);

    // A past day can still hold bookings nobody closed; the queue is where that shows.
    if (from < currentDay) {
      await closeExpiredBookings({
        orgId: scope.orgId,
        actorId: scope.userId,
        currentDay,
        now,
      });
    }

    const pagePredicate = and(
      eq(opdAppointments.orgId, scope.orgId),
      between(opdAppointments.businessDate, from, to),
      input.includeClosed
        ? inArray(opdAppointments.status, OPD_APPOINTMENT_STATUSES)
        : inArray(opdAppointments.status, ["booked", "checked_in"]),
      input.cursor
        ? or(
            lt(opdAppointments.dayOrderAt, input.cursor.dayOrderAt),
            and(
              eq(opdAppointments.dayOrderAt, input.cursor.dayOrderAt),
              lt(opdAppointments.id, input.cursor.id),
            ),
          )
        : undefined,
    );

    const tokenNumber =
      input.q && /^\d+$/.test(input.q) && Number(input.q) <= 2_147_483_647
        ? Number(input.q)
        : undefined;

    const search = input.q ? likePattern(input.q) : undefined;
    const digits = input.q ? normalizePhone(input.q) : "";
    const phoneSearch = digits.length >= 4 ? likePattern(digits) : undefined;

    const rows = await db
      .select({
        id: opdAppointments.id,
        patientId: opdAppointments.patientId,
        callerName: opdAppointments.callerName,
        callerPhone: opdAppointments.callerPhone,
        status: opdAppointments.status,
        tokenNumber: opdAppointments.tokenNumber,
        dayOrderAt: opdAppointments.dayOrderAt,
        createdAt: opdAppointments.createdAt,
        patientName: patients.name,
        patientMrn: patients.mrn,
        practitionerName: practitioners.name,
        departmentName: departments.name,
      })
      .from(opdAppointments)
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
      .where(
        and(
          pagePredicate,
          search
            ? or(
                ilike(patients.name, search),
                ilike(patients.mrn, search),
                ilike(opdAppointments.callerName, search),
                phoneSearch === undefined
                  ? undefined
                  : or(
                      ilike(sql`regexp_replace(${patients.phone}, '\\D', '', 'g')`, phoneSearch),
                      ilike(
                        sql`regexp_replace(${opdAppointments.callerPhone}, '\\D', '', 'g')`,
                        phoneSearch,
                      ),
                    ),
                tokenNumber === undefined
                  ? undefined
                  : eq(opdAppointments.tokenNumber, tokenNumber),
              )
            : undefined,
        ),
      )
      .orderBy(desc(opdAppointments.dayOrderAt), desc(opdAppointments.id))
      .limit(input.limit + 1);

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
    const dueByAppointment = new Map<string, bigint>();

    for (const invoice of appointmentInvoices) {
      const outstanding = balances.get(invoice.id)?.outstanding;

      if (outstanding === undefined) continue;

      if (invoice.opdAppointmentId === null) {
        throw impossible(`invoice ${invoice.id} selected by appointment has no appointment`);
      }

      dueByAppointment.set(
        invoice.opdAppointmentId,
        (dueByAppointment.get(invoice.opdAppointmentId) ?? 0n) + outstanding,
      );
    }

    const items = pageRows.map((row) => ({
      ...row,
      balanceDue: dueByAppointment.get(row.id) ?? 0n,
    }));

    const last = items.at(-1);

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

    if (!appointment)
      throw new ORPCError("NOT_FOUND", { message: "That appointment no longer exists." });

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
          .orderBy(asc(charges.createdAt), asc(charges.id)),
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
      throw new ORPCError("NOT_FOUND", { message: "Could not load the full appointment record." });
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
      // Locks: the file row so `file.delete` waits, the appointment row so a concurrent cancel is seen.
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

      if (!appointment || !readyFile) {
        throw new ORPCError("NOT_FOUND", {
          message: "That appointment or file is no longer available.",
        });
      }

      const [attachment] = await tx
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

      if (!attachment) {
        throw new ORPCError("CONFLICT", { message: "That scan is already attached." });
      }

      return attachment;
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

    if (!attachment)
      throw new ORPCError("NOT_FOUND", {
        message: "That prescription scan is no longer attached.",
      });
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
