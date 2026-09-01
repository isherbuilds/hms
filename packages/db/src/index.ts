import { env } from "@hms/env/server";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema";

// Connections, not CPU, are the scarce resource. Migrations open their own client
// and are deliberately not bound by this pool.
export const db = drizzle({
  connection: {
    connectionString: env.DATABASE_URL,
    statement_timeout: 15_000,
  },
  schema,
});
