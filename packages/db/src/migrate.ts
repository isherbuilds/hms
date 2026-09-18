import { env } from "@hms/env/server";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import pg from "pg";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("./migrations", import.meta.url));

// Arbitrary but fixed: every caller must pick the same lock to serialise on.
const MIGRATION_LOCK_ID = 8_524_113_907_001;

export async function runMigrations(): Promise<void> {
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();

  try {
    // Drizzle's migrator takes no lock of its own, so concurrently booting replicas
    // would run the same DDL at once.
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);

    try {
      await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
    } finally {
      await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
    }
  } finally {
    await client.end();
  }
}
