import { db } from "@better-stack/db";
import { member } from "@better-stack/db/schema/auth";
import { file } from "@better-stack/db/schema/file";
import { sql } from "drizzle-orm";

import { orgInput, orgProcedure } from "../lib/procedures/factory";

export const dashboardRouter = {
  summary: orgProcedure(
    {
      member: ["read"],
      storage: ["read"],
    },
    orgInput,
  ).handler(async ({ context }) => {
    const { orgId } = context.scope;
    const result = await db.execute<{ files: number; people: number }>(sql`
        select
          (select count(*)::integer from ${file}
            where ${file.orgId} = ${orgId} and ${file.status} = 'ready') as "files",
          (select count(*)::integer from ${member}
            where ${member.organizationId} = ${orgId}) as "people"
      `);
    const summary = result.rows[0];

    if (!summary) {
      throw new Error("Dashboard summary query returned no row");
    }
    return summary;
  }),
};
