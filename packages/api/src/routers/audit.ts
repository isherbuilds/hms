import { db } from "@better-stack/db";
import { auditLog } from "@better-stack/db/schema/audit";
import { user } from "@better-stack/db/schema/auth";
import { and, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";

import { orgInput, publicProcedure, requirePermission } from "../lib/procedures/factory";

/**
 * Org-scoped audit trail, visible to `audit: ["read"]` holders (admins and
 * owners). Keyset pagination on the identity id: no OFFSET scan, no COUNT(*)
 * over a table that only ever grows.
 */
export const auditRouter = {
  list: publicProcedure
    .input(
      orgInput.extend({
        cursor: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .use(requirePermission({ audit: ["read"] }))
    .handler(async ({ context, input }) => {
      const orgFilter = eq(auditLog.orgId, context.scope.orgId);

      // LEFT JOIN, not a foreign key: entries deliberately outlive the accounts
      // and orgs they name, so an actor who has since been deleted still shows
      // up as a row — just without a name.
      const rows = await db
        .select({
          entry: auditLog,
          actorName: user.name,
          actorEmail: user.email,
        })
        .from(auditLog)
        .leftJoin(user, eq(auditLog.actorId, user.id))
        .where(input.cursor ? and(orgFilter, lt(auditLog.id, input.cursor)) : orgFilter)
        .orderBy(desc(auditLog.id))
        .limit(input.limit);

      const items = rows.map(({ entry, actorName, actorEmail }) => ({
        ...entry,
        actorName,
        actorEmail,
      }));

      return {
        items,
        nextCursor: items.length === input.limit ? items[items.length - 1]!.id : null,
      };
    }),
};
