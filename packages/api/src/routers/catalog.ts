import { db } from "@better-stack/db";
import { CATALOG_CATEGORIES, catalogItems } from "@better-stack/db/schema/catalog-items";
import { ORPCError } from "@orpc/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { isUniqueViolation } from "../lib/db-errors";
import { orgInput, orgProcedure } from "../lib/procedures/factory";

const catalogFields = z.object({
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().min(1).max(20),
  category: z.enum(CATALOG_CATEGORIES),
  unitPrice: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/),
  taxRatePercent: z
    .string()
    .regex(/^\d{1,2}(\.\d{1,2})?$/)
    .default("0"),
  taxCode: z.string().trim().max(20).nullish(),
});

export const catalogRouter = {
  list: orgProcedure(
    { catalog: ["read"] },
    orgInput.extend({
      category: z.enum(CATALOG_CATEGORIES).optional(),
      activeOnly: z.boolean().default(false),
    }),
  ).handler(async ({ context, input }) => {
    return db
      .select()
      .from(catalogItems)
      .where(
        and(
          eq(catalogItems.orgId, context.scope.orgId),
          input.category ? eq(catalogItems.category, input.category) : undefined,
          input.activeOnly ? eq(catalogItems.active, true) : undefined,
        ),
      )
      .orderBy(asc(catalogItems.name), asc(catalogItems.id));
  }),

  create: orgProcedure({ catalog: ["create"] }, orgInput.extend(catalogFields.shape)).handler(
    async ({ context, input }) => {
      const { scope } = context;
      const { orgSlug: _claim, ...fields } = input;
      const id = crypto.randomUUID();

      try {
        const [item] = await db
          .insert(catalogItems)
          .values({
            ...fields,
            id,
            orgId: scope.orgId,
            taxCode: fields.taxCode ?? null,
          })
          .returning();

        if (!item) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Failed to create catalog item",
          });
        }

        audit({
          action: "catalog.create",
          actorId: scope.userId,
          orgId: scope.orgId,
          target: `catalogItem:${id}`,
          // Origin entry of the price timeline; catalog.update meta carries
          // every subsequent change.
          meta: {
            unitPrice: item.unitPrice,
            taxRatePercent: item.taxRatePercent,
            active: item.active,
          },
        });

        return item;
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ORPCError("CONFLICT");
        }
        throw error;
      }
    },
  ),

  update: orgProcedure(
    { catalog: ["update"] },
    orgInput.extend({
      itemId: z.string(),
      ...catalogFields.shape,
      active: z.boolean(),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { orgSlug: _claim, itemId, ...fields } = input;

    try {
      const [item] = await db
        .update(catalogItems)
        .set({
          ...fields,
          taxCode: fields.taxCode ?? null,
          updatedAt: new Date(),
        })
        .where(and(eq(catalogItems.orgId, scope.orgId), eq(catalogItems.id, itemId)))
        .returning();

      if (!item) {
        throw new ORPCError("NOT_FOUND");
      }

      audit({
        action: "catalog.update",
        actorId: scope.userId,
        orgId: scope.orgId,
        target: `catalogItem:${itemId}`,
        // Written values make the audit trail double as the price-change
        // history (see docs/research/01-catalog-flexibility.md) — the
        // reference systems keep a dedicated BillItemPriceHistory table;
        // successive catalog.update entries reconstruct the same timeline.
        meta: {
          unitPrice: item.unitPrice,
          taxRatePercent: item.taxRatePercent,
          active: item.active,
        },
      });

      return item;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ORPCError("CONFLICT");
      }
      throw error;
    }
  }),
};
