import { db } from "@hms/db";
import {
  CATALOG_CATEGORIES,
  catalogItems,
  OPD_BILLABLE_CATEGORIES,
} from "@hms/db/schema/catalog-items";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { conflict } from "../lib/conflict";
import { uniqueViolationConstraint } from "../lib/db-errors";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { formatDecimal } from "../core/money";
import { likePattern, money, pageLimit, searchQuery, shortName } from "../lib/schemas";

const catalogFields = z.object({
  name: shortName,
  code: z.string().trim().min(1).max(20),
  category: z.enum(CATALOG_CATEGORIES),
  unitPrice: money,
  customRate: z.boolean(),
  taxRatePercent: z
    .string()
    .regex(/^\d{1,2}(\.\d{1,2})?$/)
    .default("0"),
  taxCode: z.string().trim().max(20).nullish(),
});

export const catalogRouter = {
  searchServices: orgProcedure(
    { catalog: ["read"] },
    orgInput.extend({
      query: z.string().trim().max(100).optional(),
      includeConsultation: z.boolean(),
    }),
  ).handler(async ({ context, input }) => {
    const pattern = input.query ? likePattern(input.query) : undefined;

    const rows = await db
      .select({
        id: catalogItems.id,
        code: catalogItems.code,
        name: catalogItems.name,
        category: catalogItems.category,
        unitPrice: catalogItems.unitPrice,
        customRate: catalogItems.customRate,
        taxRatePercent: catalogItems.taxRatePercent,
      })
      .from(catalogItems)
      .where(
        and(
          eq(catalogItems.orgId, context.scope.orgId),
          eq(catalogItems.active, true),
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

    return rows;
  }),

  list: orgProcedure(
    { catalog: ["read"] },
    orgInput.extend({
      query: searchQuery,
      category: z.enum(CATALOG_CATEGORIES).optional(),
      activeOnly: z.boolean().default(false),
      cursor: z.object({ name: z.string(), id: z.string() }).optional(),
      limit: pageLimit,
    }),
  ).handler(async ({ context, input }) => {
    const pattern = input.query ? likePattern(input.query) : undefined;

    const items = await db
      .select()
      .from(catalogItems)
      .where(
        and(
          eq(catalogItems.orgId, context.scope.orgId),
          input.category ? eq(catalogItems.category, input.category) : undefined,
          input.activeOnly ? eq(catalogItems.active, true) : undefined,
          pattern
            ? or(ilike(catalogItems.code, pattern), ilike(catalogItems.name, pattern))
            : undefined,
          input.cursor
            ? sql`(${catalogItems.name}, ${catalogItems.id}) > (${input.cursor.name}, ${input.cursor.id})`
            : undefined,
        ),
      )
      .orderBy(asc(catalogItems.name), asc(catalogItems.id))
      .limit(input.limit + 1);

    const hasNextPage = items.length > input.limit;

    if (hasNextPage) {
      items.pop();
    }

    const last = items.at(-1);

    return {
      items,
      nextCursor: hasNextPage && last ? { name: last.name, id: last.id } : null,
    };
  }),

  create: orgProcedure(
    { catalog: ["create"] },
    orgInput.extend({ ...catalogFields.shape, customRate: z.boolean().default(false) }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { orgSlug: _claim, ...fields } = input;
    const id = Bun.randomUUIDv7();

    // A pharmacy catalog row is written only through `pharmacy.createProduct`.
    if (fields.category === "pharmacy") {
      throw new ORPCError("BAD_REQUEST", {
        message: "Pharmacy products are managed from Pharmacy → Items.",
      });
    }

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
        meta: {
          unitPrice: formatDecimal(item.unitPrice),
          taxRatePercent: item.taxRatePercent,
          active: item.active,
        },
      });

      return item;
    } catch (error) {
      if (uniqueViolationConstraint(error) !== undefined) {
        throw conflict("duplicate", "A catalog item with this code already exists.");
      }

      throw error;
    }
  }),

  update: orgProcedure(
    { catalog: ["update"] },
    orgInput.extend({ itemId: z.string(), ...catalogFields.shape }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { orgSlug: _claim, itemId, ...fields } = input;

    if (fields.category === "pharmacy") {
      throw new ORPCError("BAD_REQUEST", {
        message: "Pharmacy products are managed from Pharmacy → Items.",
      });
    }

    const [stored] = await db
      .select({ category: catalogItems.category })
      .from(catalogItems)
      .where(and(eq(catalogItems.orgId, scope.orgId), eq(catalogItems.id, itemId)))
      .limit(1);

    if (stored?.category === "pharmacy") {
      throw new ORPCError("BAD_REQUEST", {
        message: "Pharmacy products are managed from Pharmacy → Items.",
      });
    }

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
        meta: {
          unitPrice: formatDecimal(item.unitPrice),
          taxRatePercent: item.taxRatePercent,
          active: item.active,
        },
      });

      return item;
    } catch (error) {
      if (uniqueViolationConstraint(error) !== undefined) {
        throw conflict("duplicate", "A catalog item with this code already exists.");
      }

      throw error;
    }
  }),

  setActive: orgProcedure(
    { catalog: ["update"] },
    orgInput.extend({ itemId: z.string(), active: z.boolean() }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    const [stored] = await db
      .select({ category: catalogItems.category })
      .from(catalogItems)
      .where(and(eq(catalogItems.orgId, scope.orgId), eq(catalogItems.id, input.itemId)))
      .limit(1);

    if (stored?.category === "pharmacy") {
      throw new ORPCError("BAD_REQUEST", {
        message: "Pharmacy products are managed from Pharmacy → Items.",
      });
    }

    const [item] = await db
      .update(catalogItems)
      .set({ active: input.active, updatedAt: new Date() })
      .where(and(eq(catalogItems.orgId, scope.orgId), eq(catalogItems.id, input.itemId)))
      .returning({ id: catalogItems.id, active: catalogItems.active });

    if (!item) {
      throw new ORPCError("NOT_FOUND", { message: "That catalog item no longer exists." });
    }

    audit({
      action: "catalog.active.set",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `catalogItem:${item.id}`,
      meta: { active: item.active },
    });

    return item;
  }),
};
