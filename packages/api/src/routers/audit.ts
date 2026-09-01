import { db } from "@hms/db";
import { auditLog } from "@hms/db/schema/audit";
import { user } from "@hms/db/schema/auth";
import { and, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";

import { orgInput, orgProcedure } from "../lib/procedures/factory";

export const auditRouter = {
  list: orgProcedure(
    { audit: ["read"] },
    orgInput.extend({
      cursor: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }),
  ).handler(async ({ context, input }) => {
    const orgFilter = eq(auditLog.orgId, context.scope.orgId);

    // LEFT JOIN, not a foreign key: entries outlive the accounts they name, so a
    // deleted actor still shows up as a row.
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
