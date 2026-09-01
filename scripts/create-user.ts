import { createUserWithPassword } from "@hms/auth/manual-user";
import { runMigrations } from "@hms/db/migrate";

// bun run create-user <email> <name> <password>
// Creates one account directly, bypassing the disabled public sign-up endpoint.
// Then invite it into an organization from the Members page.
const [, , email, name, password] = process.argv;

if (!email || !name || !password) {
  console.error("Usage: bun run create-user <email> <name> <password>");
  process.exit(1);
}
if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

await runMigrations();
const { id } = await createUserWithPassword({ email, name, password });
console.info(`Created account ${email} (${id}). Sign-in is enabled.`);
process.exit(0);
