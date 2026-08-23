import { db } from "@hms/db";
import { member } from "@hms/db/schema/auth";
import { catalogItems } from "@hms/db/schema/catalog-items";
import { departments } from "@hms/db/schema/departments";
import { practitioners } from "@hms/db/schema/practitioners";
import { ORPCError } from "@orpc/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { isUniqueViolation } from "../lib/db-errors";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
const departmentName = z.string().trim().min(1).max(200);

const practitionerFields = z.object({
  name: z.string().trim().min(1).max(200),
  departmentId: z.string(),
  registrationNumber: z.string().trim().max(50).nullish(),
  memberUserId: z.string().nullish(),
  consultFeeItemId: z.string().nullish(),
  followUpFeeItemId: z.string().nullish(),
  followUpValidityDays: z.number().int().min(1).max(365).nullish(),
});

async function assertDepartmentInScope(departmentId: string, orgId: string): Promise<void> {
  const [row] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.id, departmentId), eq(departments.orgId, orgId)))
    .limit(1);

  if (!row) {
    throw new ORPCError("NOT_FOUND");
  }
}

async function assertCatalogItemInScope(catalogItemId: string, orgId: string): Promise<void> {
  const [row] = await db
    .select({ id: catalogItems.id })
    .from(catalogItems)
    .where(and(eq(catalogItems.id, catalogItemId), eq(catalogItems.orgId, orgId)))
    .limit(1);

  if (!row) {
    throw new ORPCError("NOT_FOUND");
  }
}

async function assertMemberUserInScope(memberUserId: string, orgId: string): Promise<void> {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, memberUserId), eq(member.organizationId, orgId)))
    .limit(1);

  if (!row) {
    throw new ORPCError("NOT_FOUND");
  }
}

async function assertPractitionerReferences(
  fields: {
    departmentId: string;
    memberUserId?: string | null;
    consultFeeItemId?: string | null;
    followUpFeeItemId?: string | null;
  },
  orgId: string,
): Promise<void> {
  await Promise.all([
    assertDepartmentInScope(fields.departmentId, orgId),
    fields.consultFeeItemId != null
      ? assertCatalogItemInScope(fields.consultFeeItemId, orgId)
      : Promise.resolve(),
    fields.followUpFeeItemId != null
      ? assertCatalogItemInScope(fields.followUpFeeItemId, orgId)
      : Promise.resolve(),
    fields.memberUserId != null
      ? assertMemberUserInScope(fields.memberUserId, orgId)
      : Promise.resolve(),
  ]);
}

export const staffRouter = {
  listDepartments: orgProcedure({ staff: ["read"] }, orgInput).handler(async ({ context }) => {
    return db
      .select()
      .from(departments)
      .where(eq(departments.orgId, context.scope.orgId))
      .orderBy(asc(departments.name));
  }),

  createDepartment: orgProcedure(
    { staff: ["create"] },
    orgInput.extend({
      name: departmentName,
      defaultConsultFeeItemId: z.string().nullish(),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const id = Bun.randomUUIDv7();
    if (input.defaultConsultFeeItemId != null) {
      await assertCatalogItemInScope(input.defaultConsultFeeItemId, scope.orgId);
    }

    try {
      const [department] = await db
        .insert(departments)
        .values({
          id,
          orgId: scope.orgId,
          name: input.name,
          defaultConsultFeeItemId: input.defaultConsultFeeItemId ?? null,
        })
        .returning();

      if (!department) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Failed to create department",
        });
      }

      audit({
        action: "department.create",
        actorId: scope.userId,
        orgId: scope.orgId,
        target: `department:${id}`,
      });

      return department;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ORPCError("CONFLICT");
      }
      throw error;
    }
  }),

  updateDepartment: orgProcedure(
    { staff: ["update"] },
    orgInput.extend({
      departmentId: z.string(),
      name: departmentName,
      defaultConsultFeeItemId: z.string().nullish(),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    if (input.defaultConsultFeeItemId != null) {
      await assertCatalogItemInScope(input.defaultConsultFeeItemId, scope.orgId);
    }
    let department;

    try {
      [department] = await db
        .update(departments)
        .set({
          name: input.name,
          defaultConsultFeeItemId: input.defaultConsultFeeItemId ?? null,
          updatedAt: new Date(),
        })
        .where(and(eq(departments.orgId, scope.orgId), eq(departments.id, input.departmentId)))
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ORPCError("CONFLICT");
      }
      throw error;
    }

    if (!department) {
      throw new ORPCError("NOT_FOUND");
    }

    audit({
      action: "department.update",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `department:${input.departmentId}`,
    });

    return department;
  }),

  listPractitioners: orgProcedure({ staff: ["read"] }, orgInput).handler(async ({ context }) => {
    return db
      .select()
      .from(practitioners)
      .where(eq(practitioners.orgId, context.scope.orgId))
      .orderBy(asc(practitioners.name));
  }),

  createPractitioner: orgProcedure(
    { staff: ["create"] },
    orgInput.extend(practitionerFields.shape),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { orgSlug: _claim, ...fields } = input;

    await assertPractitionerReferences(fields, scope.orgId);

    const id = Bun.randomUUIDv7();
    const [practitioner] = await db
      .insert(practitioners)
      .values({
        ...fields,
        id,
        orgId: scope.orgId,
        registrationNumber: fields.registrationNumber ?? null,
        memberUserId: fields.memberUserId ?? null,
        consultFeeItemId: fields.consultFeeItemId ?? null,
        followUpFeeItemId: fields.followUpFeeItemId ?? null,
        followUpValidityDays: fields.followUpValidityDays ?? null,
      })
      .returning();

    if (!practitioner) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Failed to create practitioner",
      });
    }

    audit({
      action: "practitioner.create",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `practitioner:${id}`,
    });

    return practitioner;
  }),

  updatePractitioner: orgProcedure(
    { staff: ["update"] },
    orgInput.extend({ practitionerId: z.string(), ...practitionerFields.shape }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { orgSlug: _claim, practitionerId, ...fields } = input;

    await assertPractitionerReferences(fields, scope.orgId);

    const [practitioner] = await db
      .update(practitioners)
      .set({
        ...fields,
        registrationNumber: fields.registrationNumber ?? null,
        memberUserId: fields.memberUserId ?? null,
        consultFeeItemId: fields.consultFeeItemId ?? null,
        followUpFeeItemId: fields.followUpFeeItemId ?? null,
        followUpValidityDays: fields.followUpValidityDays ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(practitioners.orgId, scope.orgId), eq(practitioners.id, practitionerId)))
      .returning();

    if (!practitioner) {
      throw new ORPCError("NOT_FOUND");
    }

    audit({
      action: "practitioner.update",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `practitioner:${practitionerId}`,
    });

    return practitioner;
  }),
};
