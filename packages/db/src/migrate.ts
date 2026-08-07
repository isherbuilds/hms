import { env } from "@better-stack/env/server";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import pg from "pg";

// Production invokes this module from the container start command. Tests and
// the development seed also run it from source, so the package can own the
// migration location without depending on any caller's directory layout.
const MIGRATIONS_FOLDER = fileURLToPath(new URL("./migrations", import.meta.url));

// Arbitrary but fixed: every caller must pick the same lock to serialise on.
const MIGRATION_LOCK_ID = 8_524_113_907_001;

export async function runMigrations(): Promise<void> {
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    // Replicas boot concurrently and drizzle's migrator takes no lock of its
    // own, so two of them can run the same DDL at once. An advisory lock
    // serialises them: the loser waits, then finds the journal already applied
    // and does nothing.
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
