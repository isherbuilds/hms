import { db } from "@hms/db";
import * as schema from "@hms/db/schema/auth";
import { env } from "@hms/env/server";
import { createUserWithPassword } from "@hms/auth/manual-user";
import { runMigrations } from "@hms/db/migrate";
import { eq } from "drizzle-orm";

// bun run create-founder <name> <password>
// Provisions the FOUNDING_EMAIL account — the only one that may create an
// organization. Idempotent: prints and exits 0 if the account already exists.
const [, , name, password] = process.argv;

if (!name || !password) {
  console.error("Usage: bun run create-founder <name> <password>");
  process.exit(1);
}

if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

await runMigrations();

// Better Auth stores emails lowercased; match the way it will on sign-in.
const email = env.FOUNDING_EMAIL.toLowerCase();

const existing = await db
  .select({ id: schema.user.id })
  .from(schema.user)
  .where(eq(schema.user.email, email));

if (existing[0]) {
  console.info(
    `Founding account ${env.FOUNDING_EMAIL} (${existing[0].id}) already exists; nothing to do.`,
  );
  process.exit(0);
}

const { id } = await createUserWithPassword({ email, name, password });

console.info(`Created founding account ${email} (${id}). Sign-in is enabled.`);

process.exit(0);
