import { createDb } from "@better-stack/db";
import * as schema from "@better-stack/db/schema/auth";
import { env } from "@better-stack/env/server";
import { createUserWithPassword } from "@better-stack/auth/manual-user";
import { runMigrations } from "@better-stack/db/migrate";
import { eq } from "drizzle-orm";

/**
 * Operator CLI: provisions the account identified by FOUNDING_EMAIL — the one
 * that may create the very first organization while none exist.
 *
 *   bun run create-founder <name> <password>
 *
 * FOUNDING_EMAIL must be set (it is validated at boot like every other server
 * env var). The script is idempotent: if the account already exists it prints
 * so and exits 0.
 */
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

const db = createDb();
const existing = await db
  .select({ id: schema.user.id })
  .from(schema.user)
  .where(eq(schema.user.email, env.FOUNDING_EMAIL));
if (existing[0]) {
  console.info(
    `Founding account ${env.FOUNDING_EMAIL} (${existing[0].id}) already exists; nothing to do.`,
  );
  process.exit(0);
}

const { id } = await createUserWithPassword({
  email: env.FOUNDING_EMAIL,
  name,
  password,
});
console.info(`Created founding account ${env.FOUNDING_EMAIL} (${id}). Sign-in is enabled.`);
process.exit(0);
