import { db } from "@hms/db";
import { nextCounter } from "@hms/db/counter";
import { attachments } from "@hms/db/schema/attachments";
import { departments } from "@hms/db/schema/departments";
import { invoices } from "@hms/db/schema/invoices";
import { opdAppointments } from "@hms/db/schema/opd-appointments";
import { patients } from "@hms/db/schema/patients";
import { patientPayers } from "@hms/db/schema/patient-payers";
import { payers } from "@hms/db/schema/payers";
import { practitioners } from "@hms/db/schema/practitioners";
import { ORPCError } from "@orpc/server";
import { and, count, desc, eq, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { conflict } from "../lib/conflict";
import { uniqueViolationConstraint } from "../lib/db-errors";
import { invoiceBalancesFor } from "../lib/invoice-balance";
import { fromPaise, toSignedPaise } from "../lib/invoice-math";
import { normalizePhone } from "../lib/phone";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import {
  dateOnly,
  emergencyContactRelation,
  guardianRelation,
  likePattern,
  personName,
  phone,
  searchQuery,
} from "../lib/schemas";
import { readOrgSettings } from "../lib/settings-cache";

const sponsorInput = z
  .object({
    payerId: z.string(),
    policyNumber: z.string().trim().max(100).optional(),
    employeeNumber: z.string().trim().max(100).optional(),
  })
  .nullable()
  .optional();

const patientFields = z.object({
  name: personName,
  phone,
  sex: z.enum(["male", "female", "other", "unknown"]),
  dateOfBirth: dateOnly,
  dobEstimated: z.boolean(),
  address: z.string().trim().max(500).default(""),
  email: z.email().nullish(),
  bloodGroup: z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]).nullish(),
  allergies: z.string().nullish(),
  medicalHistory: z.string().nullish(),
  uid: z.string().trim().min(1).max(100).nullish(),
  // Nested so the shape carries the rule: null, or every required part present.
  guardian: z
    .object({ relation: guardianRelation, name: personName, phone: phone.nullish() })
    .nullable()
    .default(null),
  emergencyContact: z
    .object({
      name: personName,
      phone,
      relation: emergencyContactRelation.nullable().default(null),
    })
    .nullable()
    .default(null),
  sponsor: sponsorInput,
});

// Stored flat; the input is nested.
function contactColumns(
  guardian: z.infer<typeof patientFields>["guardian"],
  emergencyContact: z.infer<typeof patientFields>["emergencyContact"],
) {
  return {
    guardianRelation: guardian?.relation ?? null,
    guardianName: guardian?.name ?? null,
    guardianPhone: guardian?.phone ?? null,
    emergencyContactName: emergencyContact?.name ?? null,
    emergencyContactPhone: emergencyContact?.phone ?? null,
    emergencyContactRelation: emergencyContact?.relation ?? null,
  };
}

const registerInput = orgInput.extend(patientFields.shape);

const updateInput = orgInput.extend({
  patientId: z.string(),
  updatedAt: z.iso.datetime({ precision: 3 }),
  ...patientFields.shape,
});

// A foreign patient id must read as absent, not as a patient with no visits — this
// is what turns it into NOT_FOUND rather than an empty list.
async function assertPatientInScope(orgId: string, patientId: string): Promise<void> {
  const [patient] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.orgId, orgId), eq(patients.id, patientId)))
    .limit(1);

  if (!patient) {
    throw new ORPCError("NOT_FOUND", { message: "That patient no longer exists." });
  }
}

// A deactivated payer keeps its history but takes no new links; foreign ids are
// indistinguishable from inactive ones on purpose.
async function assertActivePayer(orgId: string, payerId: string): Promise<void> {
  const [payer] = await db
    .select({ id: payers.id })
    .from(payers)
    .where(and(eq(payers.orgId, orgId), eq(payers.id, payerId), eq(payers.active, true)))
    .limit(1);
  if (!payer) {
    throw new ORPCError("NOT_FOUND", { message: "That sponsor is not available." });
  }
}

export const patientRouter = {
  register: orgProcedure({ patient: ["create"] }, registerInput).handler(
    async ({ context, input }) => {
      const { scope } = context;
      const { orgSlug: _claim, sponsor, guardian, emergencyContact, ...fields } = input;
      const id = Bun.randomUUIDv7();
      const [settings] = await Promise.all([
        // Bounded staleness is acceptable for numbering and keeps the counter lock window minimal.
        readOrgSettings(scope.orgId),
        sponsor ? assertActivePayer(scope.orgId, sponsor.payerId) : undefined,
      ]);

      let patient: typeof patients.$inferSelect;
      try {
        patient = await db.transaction(async (tx) => {
          const seq = await nextCounter(tx, scope.orgId, "mrn");
          const mrn = `${settings.mrnPrefix}${String(seq).padStart(6, "0")}`;

          const [row] = await tx
            .insert(patients)
            .values({
              ...fields,
              ...contactColumns(guardian, emergencyContact),
              id,
              orgId: scope.orgId,
              mrn,
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
          if (sponsor) {
            await tx.insert(patientPayers).values({
              id: Bun.randomUUIDv7(),
              orgId: scope.orgId,
              patientId: id,
              payerId: sponsor.payerId,
              policyNumber: sponsor.policyNumber ?? null,
              employeeNumber: sponsor.employeeNumber ?? null,
            });
          }
          return row;
        });
      } catch (error) {
        const constraint = uniqueViolationConstraint(error);
        if (constraint === "patients_org_uid_idx") {
          throw conflict("uid_taken", "A patient with this UID already exists.");
        }
        if (constraint !== undefined) {
          throw new ORPCError("CONFLICT", {
            message: "Those details match a patient who already exists.",
          });
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
      query: searchQuery,
      phone: z
        .string()
        .trim()
        .max(20)
        .refine((value) => normalizePhone(value).length >= 4, {
          message: "Phone must contain at least 4 digits",
        })
        .optional(),
      // Keyset on the UUIDv7 id alone: ids are minted at registration so they order
      // chronologically, and a timestamp cursor's millisecond truncation loses rows.
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(20),
    }),
  ).handler(async ({ context, input }) => {
    const normalizedPhone = input.phone ? normalizePhone(input.phone) : undefined;
    const normalizedQuery = input.query ? normalizePhone(input.query) : "";
    const queryPattern = input.query ? likePattern(input.query) : undefined;
    const phoneDigits = sql<string>`regexp_replace(${patients.phone}, '\\D', '', 'g')`;
    const scoped = and(
      eq(patients.orgId, context.scope.orgId),
      input.cursor ? lt(patients.id, input.cursor) : undefined,
      normalizedPhone ? eq(phoneDigits, normalizedPhone) : undefined,
      queryPattern
        ? or(
            ilike(patients.name, queryPattern),
            ilike(patients.mrn, queryPattern),
            normalizedQuery.length >= 4
              ? ilike(phoneDigits, likePattern(normalizedQuery))
              : undefined,
          )
        : undefined,
    );

    // Clinical history and extended contact fields stay behind the record endpoint.
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

  // Gated on `opd:read`, not `patient:read`: a clerk who may correct a phone number
  // is not thereby entitled to who the patient has been seeing.
  visits: orgProcedure(
    { opd: ["read"] },
    orgInput.extend({
      patientId: z.string(),
      // Keyset on (business_date, id): a visit is ordered by the day it happened, so a
      // booking made today for next week must not sort above last week's attendance.
      cursor: z.object({ businessDate: z.string(), id: z.string() }).optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const [, rows] = await Promise.all([
      assertPatientInScope(scope.orgId, input.patientId),
      db
        .select({
          id: opdAppointments.id,
          businessDate: opdAppointments.businessDate,
          status: opdAppointments.status,
          tokenNumber: opdAppointments.tokenNumber,
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
        .limit(input.limit + 1),
    ]);

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
              grandTotal: invoices.grandTotal,
            })
            .from(invoices)
            .where(
              and(eq(invoices.orgId, scope.orgId), inArray(invoices.opdAppointmentId, visitIds)),
            ),
        ])
      : [[], []];

    const balances = await invoiceBalancesFor(db, scope.orgId, visitInvoices);
    const countByVisit = new Map(prescriptionCounts.map((row) => [row.targetId, row.total]));
    const outstandingByVisit = new Map<string, number>();
    for (const invoice of visitInvoices) {
      const outstanding = balances.get(invoice.id)?.outstanding ?? "0.00";
      outstandingByVisit.set(
        invoice.opdAppointmentId,
        (outstandingByVisit.get(invoice.opdAppointmentId) ?? 0) + toSignedPaise(outstanding),
      );
    }

    const items = rows.map((row) => ({
      ...row,
      prescriptionCount: countByVisit.get(row.id) ?? 0,
      outstanding: fromPaise(outstandingByVisit.get(row.id) ?? 0),
    }));

    const last = rows[rows.length - 1];
    return {
      items,
      nextCursor: hasNextPage && last ? { businessDate: last.businessDate, id: last.id } : null,
    };
  }),

  account: orgProcedure({ billing: ["read"] }, orgInput.extend({ patientId: z.string() })).handler(
    async ({ context, input }) => {
      const { scope } = context;
      const [, rows] = await Promise.all([
        assertPatientInScope(scope.orgId, input.patientId),
        db
          .select({
            id: invoices.id,
            invoiceNumber: invoices.invoiceNumber,
            grandTotal: invoices.grandTotal,
            currency: invoices.currency,
            createdAt: invoices.createdAt,
          })
          .from(invoices)
          .where(and(eq(invoices.orgId, scope.orgId), eq(invoices.patientId, input.patientId)))
          .orderBy(desc(invoices.createdAt), desc(invoices.id)),
      ]);

      const balances = await invoiceBalancesFor(db, scope.orgId, rows);
      const items = rows.map((invoice) => {
        const balance = balances.get(invoice.id);
        return {
          ...invoice,
          paymentsTotal: balance?.paymentsTotal ?? "0.00",
          outstanding: balance?.outstanding ?? "0.00",
        };
      });

      const openInvoices = items.filter((invoice) => toSignedPaise(invoice.outstanding) !== 0);

      return {
        invoices: items,
        openCount: openInvoices.length,
        outstanding: fromPaise(
          openInvoices.reduce((sum, invoice) => sum + toSignedPaise(invoice.outstanding), 0),
        ),
      };
    },
  ),

  get: orgProcedure({ patient: ["read"] }, orgInput.extend({ patientId: z.string() })).handler(
    async ({ context, input }) => {
      // Two joined tables, so Drizzle cannot nullify `sponsor` as one object; the
      // payer columns are only null when the link row is absent.
      const [row] = await db
        .select({
          patient: patients,
          payerId: payers.id,
          payerName: payers.name,
          payerType: payers.type,
          policyNumber: patientPayers.policyNumber,
          employeeNumber: patientPayers.employeeNumber,
        })
        .from(patients)
        .leftJoin(
          patientPayers,
          and(
            eq(patientPayers.orgId, context.scope.orgId),
            eq(patientPayers.patientId, patients.id),
          ),
        )
        .leftJoin(
          payers,
          and(eq(payers.orgId, context.scope.orgId), eq(payers.id, patientPayers.payerId)),
        )
        .where(and(eq(patients.orgId, context.scope.orgId), eq(patients.id, input.patientId)))
        .limit(1);

      if (!row) {
        throw new ORPCError("NOT_FOUND", { message: "That patient no longer exists." });
      }
      return {
        ...row.patient,
        updatedAt: row.patient.updatedAt.toISOString(),
        sponsor:
          row.payerId !== null && row.payerName !== null && row.payerType !== null
            ? {
                payerId: row.payerId,
                payerName: row.payerName,
                payerType: row.payerType,
                policyNumber: row.policyNumber,
                employeeNumber: row.employeeNumber,
              }
            : null,
      };
    },
  ),

  update: orgProcedure({ patient: ["update"] }, updateInput).handler(async ({ context, input }) => {
    const { scope } = context;
    const {
      orgSlug: _claim,
      patientId,
      updatedAt,
      sponsor,
      guardian,
      emergencyContact,
      ...fields
    } = input;
    if (sponsor) await assertActivePayer(scope.orgId, sponsor.payerId);

    let patient: typeof patients.$inferSelect;
    try {
      patient = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(patients)
          .set({
            ...fields,
            ...contactColumns(guardian, emergencyContact),
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

        if (!row) {
          throw conflict("stale_record", "This patient changed after you opened it.");
        }
        if (sponsor === null) {
          await tx
            .delete(patientPayers)
            .where(
              and(eq(patientPayers.orgId, scope.orgId), eq(patientPayers.patientId, patientId)),
            );
        } else if (sponsor) {
          await tx
            .insert(patientPayers)
            .values({
              id: Bun.randomUUIDv7(),
              orgId: scope.orgId,
              patientId,
              payerId: sponsor.payerId,
              policyNumber: sponsor.policyNumber ?? null,
              employeeNumber: sponsor.employeeNumber ?? null,
            })
            .onConflictDoUpdate({
              target: [patientPayers.orgId, patientPayers.patientId],
              set: {
                payerId: sponsor.payerId,
                policyNumber: sponsor.policyNumber ?? null,
                employeeNumber: sponsor.employeeNumber ?? null,
              },
            });
        }
        return row;
      });
    } catch (error) {
      const constraint = uniqueViolationConstraint(error);
      if (constraint === "patients_org_uid_idx") {
        throw conflict("uid_taken", "A patient with this UID already exists.");
      }
      if (constraint !== undefined) {
        throw new ORPCError("CONFLICT", {
          message: "Those details match a patient who already exists.",
        });
      }
      throw error;
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
