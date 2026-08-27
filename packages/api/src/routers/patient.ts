import { db } from "@hms/db";
import { nextCounter } from "@hms/db/counter";
import { attachments } from "@hms/db/schema/attachments";
import { departments } from "@hms/db/schema/departments";
import { invoices } from "@hms/db/schema/invoices";
import { opdAppointments } from "@hms/db/schema/opd-appointments";
import { patients } from "@hms/db/schema/patients";
import { practitioners } from "@hms/db/schema/practitioners";
import { ORPCError } from "@orpc/server";
import { and, asc, count, desc, eq, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { isUniqueViolation, uniqueViolationConstraint } from "../lib/db-errors";
import { invoiceBalancesFor } from "../lib/invoice-balance";
import { fromPaise, toPaise } from "../lib/invoice-math";
import { normalizePhone } from "../lib/phone";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { readOrgSettings } from "../lib/settings-cache";
const patientFields = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(4).max(20),
  sex: z.enum(["male", "female", "other", "unknown"]),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dobEstimated: z.boolean(),
  address: z.string().trim().max(500).default(""),
  email: z.email().nullish(),
  bloodGroup: z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]).nullish(),
  allergies: z.string().nullish(),
  medicalHistory: z.string().nullish(),
  uid: z.string().trim().min(1).max(100).nullish(),
});

const registerInput = orgInput.extend(patientFields.shape);

const updateInput = orgInput.extend({
  patientId: z.string(),
  updatedAt: z.iso.datetime({ precision: 3 }),
  ...patientFields.shape,
});

/**
 * A patient id from another tenant must read as absent, not as a patient with
 * no visits and no invoices. Both child reads below filter by `orgId` anyway;
 * this is what turns a foreign id into `NOT_FOUND` rather than an empty list.
 */
async function assertPatientInScope(orgId: string, patientId: string): Promise<void> {
  const [patient] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.orgId, orgId), eq(patients.id, patientId)))
    .limit(1);

  if (!patient) {
    throw new ORPCError("NOT_FOUND");
  }
}

export const patientRouter = {
  register: orgProcedure({ patient: ["create"] }, registerInput).handler(
    async ({ context, input }) => {
      const { scope } = context;
      const { orgSlug: _claim, ...fields } = input;
      const id = Bun.randomUUIDv7();
      // Prefix is read through the settings cache; bounded staleness is acceptable for numbering and keeps the counter lock window minimal.
      const settings = await readOrgSettings(scope.orgId);

      let patient: typeof patients.$inferSelect;
      try {
        patient = await db.transaction(async (tx) => {
          const seq = await nextCounter(tx, scope.orgId, "mrn");
          const mrn = `${settings.mrnPrefix}${String(seq).padStart(6, "0")}`;

          const [row] = await tx
            .insert(patients)
            .values({
              ...fields,
              id,
              orgId: scope.orgId,
              mrn,
              dateOfBirth: fields.dateOfBirth,
              dobEstimated: fields.dobEstimated,
              email: fields.email ?? null,
              bloodGroup: fields.bloodGroup ?? null,
              allergies: fields.allergies ?? null,
              medicalHistory: fields.medicalHistory ?? null,
              uid: fields.uid ?? null,
              createdBy: scope.userId,
            })
            .returning();

          if (!row) {
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: "Failed to register patient",
            });
          }
          return row;
        });
      } catch (error) {
        if (uniqueViolationConstraint(error) === "patients_org_uid_idx") {
          throw new ORPCError("CONFLICT", {
            message: "A patient with this UID already exists.",
            data: { code: "UID_TAKEN" },
          });
        }
        if (isUniqueViolation(error)) {
          throw new ORPCError("CONFLICT");
        }
        throw error;
      }

      audit({
        action: "patient.register",
        actorId: scope.userId,
        orgId: scope.orgId,
        target: `patient:${id}`,
      });

      return patient;
    },
  ),

  search: orgProcedure(
    { patient: ["read"] },
    orgInput.extend({
      query: z.string().trim().optional(),
      phone: z
        .string()
        .trim()
        .max(20)
        .refine((value) => normalizePhone(value).length >= 4, {
          message: "Phone must contain at least 4 digits",
        })
        .optional(),
      // Keyset on the UUIDv7 id alone (like audit.list): ids are minted at
      // registration so they order chronologically, `unique(org_id, id)`
      // backs the scan, and a timestamp cursor's millisecond truncation
      // (JS Date vs timestamptz microseconds) is unrepresentable.
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(20),
    }),
  ).handler(async ({ context, input }) => {
    const normalizedPhone = input.phone ? normalizePhone(input.phone) : undefined;
    const normalizedQuery = input.query ? normalizePhone(input.query) : "";
    const phoneDigits = sql<string>`regexp_replace(${patients.phone}, '\\D', '', 'g')`;
    const scoped = and(
      eq(patients.orgId, context.scope.orgId),
      input.cursor ? lt(patients.id, input.cursor) : undefined,
      normalizedPhone ? eq(phoneDigits, normalizedPhone) : undefined,
      input.query
        ? or(
            ilike(patients.name, `%${input.query}%`),
            ilike(patients.mrn, `%${input.query}%`),
            normalizedQuery.length >= 4 ? ilike(phoneDigits, `%${normalizedQuery}%`) : undefined,
          )
        : undefined,
    );

    // Search is a directory boundary, not a lightweight version of `get`.
    // Return only the fields its registry and patient pickers render; clinical
    // history, contact extras and attribution stay behind the record endpoint.
    const items = await db
      .select({
        id: patients.id,
        mrn: patients.mrn,
        name: patients.name,
        phone: patients.phone,
        sex: patients.sex,
        dateOfBirth: patients.dateOfBirth,
        dobEstimated: patients.dobEstimated,
        createdAt: patients.createdAt,
      })
      .from(patients)
      .where(scoped)
      .orderBy(desc(patients.id))
      .limit(input.limit + 1);

    const hasNextPage = items.length > input.limit;
    if (hasNextPage) {
      items.pop();
    }
    const last = items[items.length - 1];
    return {
      items,
      nextCursor: hasNextPage && last ? last.id : null,
    };
  }),

  /**
   * This patient's visits, newest first. The record page lists them and expands
   * one in place, so a row carries only what tells visits apart — the visit
   * itself stays behind `opd.get`.
   *
   * Gated on `opd:read` rather than `patient:read`: a clerk who may correct a
   * phone number is not thereby entitled to who the patient has been seeing.
   */
  visits: orgProcedure(
    { opd: ["read"] },
    orgInput.extend({
      patientId: z.string(),
      // Keyset on (business_date, id) because a visit is ordered by the day it
      // happened, not by the day the row was created — a booking made today for
      // next week must not sort above last week's attendance.
      cursor: z.object({ businessDate: z.string(), id: z.string() }).optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    await assertPatientInScope(scope.orgId, input.patientId);

    const rows = await db
      .select({
        id: opdAppointments.id,
        businessDate: opdAppointments.businessDate,
        status: opdAppointments.status,
        tokenNumber: opdAppointments.tokenNumber,
        scheduledFor: opdAppointments.scheduledFor,
        arrivedAt: opdAppointments.arrivedAt,
        createdAt: opdAppointments.createdAt,
        practitionerName: practitioners.name,
        departmentName: departments.name,
      })
      .from(opdAppointments)
      .innerJoin(
        practitioners,
        and(
          eq(practitioners.orgId, scope.orgId),
          eq(practitioners.id, opdAppointments.practitionerId),
        ),
      )
      .innerJoin(
        departments,
        and(eq(departments.orgId, scope.orgId), eq(departments.id, opdAppointments.departmentId)),
      )
      .where(
        and(
          eq(opdAppointments.orgId, scope.orgId),
          eq(opdAppointments.patientId, input.patientId),
          input.cursor
            ? sql`(${opdAppointments.businessDate}, ${opdAppointments.id}) < (${input.cursor.businessDate}::date, ${input.cursor.id})`
            : undefined,
        ),
      )
      .orderBy(desc(opdAppointments.businessDate), desc(opdAppointments.id))
      .limit(input.limit + 1);

    const hasNextPage = rows.length > input.limit;
    if (hasNextPage) {
      rows.pop();
    }

    const visitIds = rows.map((row) => row.id);
    const [prescriptionCounts, visitInvoices] = visitIds.length
      ? await Promise.all([
          db
            .select({ targetId: attachments.targetId, total: count() })
            .from(attachments)
            .where(
              and(
                eq(attachments.orgId, scope.orgId),
                eq(attachments.targetType, "prescription"),
                inArray(attachments.targetId, visitIds),
              ),
            )
            .groupBy(attachments.targetId),
          db
            .select({
              id: invoices.id,
              opdAppointmentId: invoices.opdAppointmentId,
              invoiceNumber: invoices.invoiceNumber,
              grandTotal: invoices.grandTotal,
              createdAt: invoices.createdAt,
            })
            .from(invoices)
            .where(
              and(eq(invoices.orgId, scope.orgId), inArray(invoices.opdAppointmentId, visitIds)),
            )
            .orderBy(asc(invoices.createdAt)),
        ])
      : [[], []];

    const balances = await invoiceBalancesFor(db, scope.orgId, visitInvoices);
    const countByVisit = new Map(prescriptionCounts.map((row) => [row.targetId, row.total]));
    const invoicesByVisit = new Map<string, typeof visitInvoices>();
    for (const invoice of visitInvoices) {
      const list = invoicesByVisit.get(invoice.opdAppointmentId) ?? [];
      list.push(invoice);
      invoicesByVisit.set(invoice.opdAppointmentId, list);
    }

    const items = rows.map((row) => {
      const rowInvoices = (invoicesByVisit.get(row.id) ?? []).map((invoice) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        grandTotal: invoice.grandTotal,
        outstanding: balances.get(invoice.id)?.outstanding ?? "0.00",
      }));
      return {
        ...row,
        prescriptionCount: countByVisit.get(row.id) ?? 0,
        invoices: rowInvoices,
        outstanding: fromPaise(
          rowInvoices.reduce((sum, invoice) => sum + toPaise(invoice.outstanding), 0),
        ),
      };
    });

    const last = rows[rows.length - 1];
    return {
      items,
      nextCursor: hasNextPage && last ? { businessDate: last.businessDate, id: last.id } : null,
    };
  }),

  /**
   * What this patient owes across every invoice, and the invoices behind it.
   * Billing is invoiced per appointment, so nothing until now could answer
   * "does this person owe anything" without reading each visit in turn.
   */
  account: orgProcedure({ billing: ["read"] }, orgInput.extend({ patientId: z.string() })).handler(
    async ({ context, input }) => {
      const { scope } = context;
      await assertPatientInScope(scope.orgId, input.patientId);

      const rows = await db
        .select({
          id: invoices.id,
          opdAppointmentId: invoices.opdAppointmentId,
          invoiceNumber: invoices.invoiceNumber,
          grandTotal: invoices.grandTotal,
          currency: invoices.currency,
          createdAt: invoices.createdAt,
        })
        .from(invoices)
        .where(and(eq(invoices.orgId, scope.orgId), eq(invoices.patientId, input.patientId)))
        .orderBy(desc(invoices.createdAt), desc(invoices.id));

      const balances = await invoiceBalancesFor(db, scope.orgId, rows);
      const items = rows.map((invoice) => ({
        ...invoice,
        ...(balances.get(invoice.id) ?? {
          grandTotal: invoice.grandTotal,
          creditTotal: "0.00",
          paymentsTotal: "0.00",
          refundsTotal: "0.00",
          outstanding: "0.00",
        }),
      }));

      const openInvoices = items.filter((invoice) => toPaise(invoice.outstanding) !== 0);

      return {
        invoices: items,
        openCount: openInvoices.length,
        outstanding: fromPaise(
          openInvoices.reduce((sum, invoice) => sum + toPaise(invoice.outstanding), 0),
        ),
      };
    },
  ),

  get: orgProcedure({ patient: ["read"] }, orgInput.extend({ patientId: z.string() })).handler(
    async ({ context, input }) => {
      const [patient] = await db
        .select()
        .from(patients)
        .where(and(eq(patients.orgId, context.scope.orgId), eq(patients.id, input.patientId)))
        .limit(1);

      if (!patient) {
        throw new ORPCError("NOT_FOUND");
      }
      return { ...patient, updatedAt: patient.updatedAt.toISOString() };
    },
  ),

  update: orgProcedure({ patient: ["update"] }, updateInput).handler(async ({ context, input }) => {
    const { scope } = context;
    const { orgSlug: _claim, patientId, updatedAt, ...fields } = input;
    let patient: typeof patients.$inferSelect | undefined;
    try {
      [patient] = await db
        .update(patients)
        .set({
          ...fields,
          dateOfBirth: fields.dateOfBirth,
          dobEstimated: fields.dobEstimated,
          email: fields.email ?? null,
          bloodGroup: fields.bloodGroup ?? null,
          allergies: fields.allergies ?? null,
          medicalHistory: fields.medicalHistory ?? null,
          uid: fields.uid ?? null,
          updatedAt: sql`greatest(statement_timestamp(), ${patients.updatedAt} + interval '1 millisecond')::timestamptz(3)`,
        })
        .where(
          and(
            eq(patients.orgId, scope.orgId),
            eq(patients.id, patientId),
            eq(patients.updatedAt, new Date(updatedAt)),
          ),
        )
        .returning();
    } catch (error) {
      if (uniqueViolationConstraint(error) === "patients_org_uid_idx") {
        throw new ORPCError("CONFLICT", {
          message: "A patient with this UID already exists.",
          data: { code: "UID_TAKEN" },
        });
      }
      if (isUniqueViolation(error)) {
        throw new ORPCError("CONFLICT");
      }
      throw error;
    }

    if (!patient) {
      const [existing] = await db
        .select({ id: patients.id })
        .from(patients)
        .where(and(eq(patients.orgId, scope.orgId), eq(patients.id, patientId)))
        .limit(1);

      if (existing) {
        throw new ORPCError("CONFLICT", {
          message: "This patient changed after you opened it.",
          data: { code: "STALE_RECORD" },
        });
      }
      throw new ORPCError("NOT_FOUND");
    }

    audit({
      action: "patient.update",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `patient:${patientId}`,
    });

    return { ...patient, updatedAt: patient.updatedAt.toISOString() };
  }),
};
