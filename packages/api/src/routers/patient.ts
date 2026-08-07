import { db } from "@better-stack/db";
import { nextCounter } from "@better-stack/db/counter";
import { patients } from "@better-stack/db/schema/patients";
import { ORPCError } from "@orpc/server";
import { and, desc, eq, ilike, lt, or } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { isUniqueViolation } from "../lib/db-errors";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { readOrgSettings } from "../lib/settings-cache";

const patientFields = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(4).max(20),
  sex: z.enum(["male", "female", "other", "unknown"]),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  ageYears: z.number().int().min(0).max(150).nullish(),
  address: z.string().trim().max(500).default(""),
  email: z.email().nullish(),
  bloodGroup: z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]).nullish(),
  allergies: z.string().nullish(),
  medicalHistory: z.string().nullish(),
  uid: z.string().trim().min(1).max(100).nullish(),
});

const registerInput = orgInput
  .extend(patientFields.shape)
  .refine(({ dateOfBirth, ageYears }) => dateOfBirth != null || ageYears != null, {
    message: "Date of birth or age is required",
    path: ["dateOfBirth"],
  });

const updateInput = orgInput
  .extend({ patientId: z.string(), ...patientFields.shape })
  .refine(({ dateOfBirth, ageYears }) => dateOfBirth != null || ageYears != null, {
    message: "Date of birth or age is required",
    path: ["dateOfBirth"],
  });

export const patientRouter = {
  register: orgProcedure({ patient: ["create"] }, registerInput).handler(
    async ({ context, input }) => {
      const { scope } = context;
      const { orgSlug: _claim, ...fields } = input;
      const id = crypto.randomUUID();
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
              dateOfBirth: fields.dateOfBirth ?? null,
              ageYears: fields.ageYears ?? null,
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
      phone: z.string().trim().min(4).max(20).optional(),
      cursor: z.object({ createdAt: z.coerce.date(), id: z.string() }).optional(),
      limit: z.number().int().min(1).max(100).default(20),
    }),
  ).handler(async ({ context, input }) => {
    const scoped = and(
      eq(patients.orgId, context.scope.orgId),
      input.phone ? eq(patients.phone, input.phone) : undefined,
      input.query
        ? or(
            ilike(patients.name, `%${input.query}%`),
            ilike(patients.mrn, `%${input.query}%`),
            ilike(patients.phone, `%${input.query}%`),
          )
        : undefined,
    );

    const items = await db
      .select()
      .from(patients)
      .where(
        input.cursor
          ? and(
              scoped,
              or(
                lt(patients.createdAt, input.cursor.createdAt),
                and(
                  eq(patients.createdAt, input.cursor.createdAt),
                  lt(patients.id, input.cursor.id),
                ),
              ),
            )
          : scoped,
      )
      .orderBy(desc(patients.createdAt), desc(patients.id))
      .limit(input.limit);

    const last = items[items.length - 1];
    return {
      items,
      nextCursor:
        items.length === input.limit && last ? { createdAt: last.createdAt, id: last.id } : null,
    };
  }),

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
      return patient;
    },
  ),

  update: orgProcedure({ patient: ["update"] }, updateInput).handler(async ({ context, input }) => {
    const { scope } = context;
    const { orgSlug: _claim, patientId, ...fields } = input;
    let patient: typeof patients.$inferSelect | undefined;
    try {
      [patient] = await db
        .update(patients)
        .set({
          ...fields,
          dateOfBirth: fields.dateOfBirth ?? null,
          ageYears: fields.ageYears ?? null,
          email: fields.email ?? null,
          bloodGroup: fields.bloodGroup ?? null,
          allergies: fields.allergies ?? null,
          medicalHistory: fields.medicalHistory ?? null,
          uid: fields.uid ?? null,
          updatedAt: new Date(),
        })
        .where(and(eq(patients.orgId, scope.orgId), eq(patients.id, patientId)))
        .returning();

      if (!patient) {
        throw new ORPCError("NOT_FOUND");
      }
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ORPCError("CONFLICT");
      }
      throw error;
    }

    audit({
      action: "patient.update",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `patient:${patientId}`,
    });

    return patient;
  }),
};
