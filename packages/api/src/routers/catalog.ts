import { db } from "@hms/db";
import {
  CATALOG_CATEGORIES,
  catalogItems,
  OPD_BILLABLE_CATEGORIES,
} from "@hms/db/schema/catalog-items";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, ilike, inArray, ne, or } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { conflict } from "../lib/conflict";
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
  // Consultations require an explicit opt-in from immediate intake or billing;
  // scheduled intake cannot surface them.
  searchServices: orgProcedure(
    { catalog: ["read"] },
    orgInput.extend({
      query: z.string().trim().max(100).optional(),
      includeConsultation: z.boolean(),
    }),
  ).handler(async ({ context, input }) => {
    const pattern = input.query ? `%${input.query}%` : undefined;
    return db
      .select({
        id: catalogItems.id,
        code: catalogItems.code,
        name: catalogItems.name,
        category: catalogItems.category,
        unitPrice: catalogItems.unitPrice,
        taxRatePercent: catalogItems.taxRatePercent,
      })
      .from(catalogItems)
      .where(
        and(
          eq(catalogItems.orgId, context.scope.orgId),
          eq(catalogItems.active, true),
          // `findActiveServiceItems` refuses the rest anyway; showing it would be an
          // invitation to fail.
          inArray(catalogItems.category, [...OPD_BILLABLE_CATEGORIES]),
          input.includeConsultation ? undefined : ne(catalogItems.category, "consultation"),
          pattern
            ? or(
                ilike(catalogItems.code, pattern),
                ilike(catalogItems.name, pattern),
                ilike(catalogItems.category, pattern),
              )
            : undefined,
        ),
      )
      .orderBy(asc(catalogItems.name), asc(catalogItems.id))
      .limit(6);
  }),

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
      const id = Bun.randomUUIDv7();

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
          // Origin entry of the price timeline; catalog.update meta carries every change after.
          meta: {
            unitPrice: item.unitPrice,
            taxRatePercent: item.taxRatePercent,
            active: item.active,
          },
        });

        return item;
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict("duplicate", "A catalog item with this code already exists.");
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
        throw new ORPCError("NOT_FOUND", { message: "That catalog item no longer exists." });
      }

      audit({
        action: "catalog.update",
        actorId: scope.userId,
        orgId: scope.orgId,
        target: `catalogItem:${itemId}`,
        // Written values make the audit trail double as the price-change history, so
        // successive entries reconstruct the timeline without a dedicated table.
        meta: {
          unitPrice: item.unitPrice,
          taxRatePercent: item.taxRatePercent,
          active: item.active,
        },
      });

      return item;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict("duplicate", "A catalog item with this code already exists.");
      }
      throw error;
    }
  }),
};
