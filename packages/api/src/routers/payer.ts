import { db } from "@hms/db";
import { payers } from "@hms/db/schema/payers";
import { ORPCError } from "@orpc/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { conflict } from "../lib/conflict";
import { uniqueViolationConstraint } from "../lib/db-errors";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { payerType, shortName } from "../lib/schemas";

const payerFields = {
  id: payers.id,
  name: payers.name,
  type: payers.type,
  active: payers.active,
};

export const payerRouter = {
  list: orgProcedure({ payer: ["read"] }, orgInput).handler(async ({ context }) =>
    db
      .select(payerFields)
      .from(payers)
      .where(eq(payers.orgId, context.scope.orgId))
      .orderBy(asc(payers.name)),
  ),

  create: orgProcedure(
    { payer: ["create"] },
    orgInput.extend({ name: shortName, type: payerType }),
  ).handler(async ({ context, input }) => {
    try {
      const [payer] = await db
        .insert(payers)
        .values({
          id: Bun.randomUUIDv7(),
          orgId: context.scope.orgId,
          name: input.name,
          type: input.type,
        })
        .returning(payerFields);

      if (!payer) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to create payer" });
      }
      return payer;
    } catch (error) {
      if (uniqueViolationConstraint(error) === "payers_org_name_idx") {
        throw conflict("duplicate", "A payer with this name already exists.");
      }
      throw error;
    }
  }),

  update: orgProcedure(
    { payer: ["update"] },
    orgInput.extend({ payerId: z.string(), name: shortName, type: payerType, active: z.boolean() }),
  ).handler(async ({ context, input }) => {
    try {
      const [payer] = await db
        .update(payers)
        .set({ name: input.name, type: input.type, active: input.active })
        .where(and(eq(payers.orgId, context.scope.orgId), eq(payers.id, input.payerId)))
        .returning(payerFields);

      if (!payer) {
        throw new ORPCError("NOT_FOUND", { message: "That payer no longer exists." });
      }
      return payer;
    } catch (error) {
      if (uniqueViolationConstraint(error) === "payers_org_name_idx") {
        throw conflict("duplicate", "A payer with this name already exists.");
      }
      throw error;
    }
  }),
};
