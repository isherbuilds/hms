import { env } from "@hms/env/server";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema";

/**
 * One pool per process. Connections, not CPU, are the scarce resource: a query
 * with no ceiling holds its connection until the client gives up, and ten of
 * those leave nothing for patient registration. Migrations open their own
 * client and are deliberately not bound by this.
 */
export const db = drizzle({
  connection: {
    connectionString: env.DATABASE_URL,
    statement_timeout: 15_000,
  },
  schema,
});
