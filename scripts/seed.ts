import { auth } from "@better-stack/auth";
import { createUserWithPassword } from "@better-stack/auth/manual-user";
import { db } from "@better-stack/db";
import { runMigrations } from "@better-stack/db/migrate";
import { member, user } from "@better-stack/db/schema/auth";
import {
  SETTINGS_DEFAULTS,
  organizationSettings,
} from "@better-stack/db/schema/organization-settings";
import { env } from "@better-stack/env/server";
import { count, eq } from "drizzle-orm";
import pg from "pg";

/**
 * Development seed. Creates two organizations and one account that belongs to
 * both so switching orgs can be exercised from a single login.
 *
 * Sign-up is disabled, so every account is created directly with
 * `createUserWithPassword`, exactly as an operator would.
 *
 * Run with `bun run db:seed`, or `bun run db:seed -- --reset` to drop the
 * schema first. Refuses to touch a production database.
 */

const PASSWORD = "password123";

type Person = {
  email: string;
  name: string;
  id: string;
  headers: Headers;
};

/**
 * `NODE_ENV` defaults to `development`, so it cannot be the only thing standing
 * between `--reset` and a real database. Gate the drop on the database name the
 * same way `tests/support/database.ts` does, and fail loud on anything else.
 */
const RESETTABLE_DATABASE = /^(postgres|.*_dev|.*_test)$/;

function assertResettableDatabase(): void {
  const name = new URL(env.DATABASE_URL).pathname.slice(1);
  if (!RESETTABLE_DATABASE.test(name)) {
    throw new Error(
      `Refusing to drop the schema of database "${name}". ` +
        "--reset only runs against a database named postgres, *_dev or *_test.",
    );
  }
}

async function resetSchema(): Promise<void> {
  assertResettableDatabase();
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      "drop schema public cascade; create schema public; drop schema if exists drizzle cascade;",
    );
  } finally {
    await client.end();
  }
  await runMigrations();
}

async function createUser(email: string, name: string): Promise<Person> {
  const { id } = await createUserWithPassword({ email, name, password: PASSWORD });
  const { headers } = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    returnHeaders: true,
  });
  const cookie = headers.get("set-cookie")?.split(";")[0];
  if (!cookie) {
    throw new Error(`Sign-in for ${email} returned no session cookie`);
  }
  return { email, name, id, headers: new Headers({ cookie }) };
}

async function addMember(
  organizationId: string,
  person: Person,
  role: "member" | "admin",
): Promise<void> {
  await auth.api.addMember({
    body: { userId: person.id, organizationId, role },
  });
}

/**
 * Creates an organization through Better Auth's system path (a `userId` with
 * no session), which bypasses `allowUserToCreateOrganization`. Sign-up is
 * disabled and only FOUNDING_EMAIL may create orgs, so this is how the seed
 * provisions its two organizations — the creator still becomes owner via the
 * plugin's default `creatorRole`.
 */
async function createOrg(owner: Person, name: string, slug: string): Promise<string> {
  const org = await auth.api.createOrganization({
    body: { name, slug, userId: owner.id },
  });
  if (!org) {
    throw new Error(`Could not create organization "${name}"`);
  }
  return org.id;
}

/** Mercy arrives configured so print prefixes and tax id show up on day one. */
async function addSettings(orgId: string): Promise<void> {
  await db.insert(organizationSettings).values({
    orgId,
    ...SETTINGS_DEFAULTS,
    legalName: "Mercy General Hospital Pvt. Ltd.",
    address: "12 Hospital Road, Pune, Maharashtra 411001",
    taxId: "27AAACM1234A1Z5",
  });
}

async function main(): Promise<void> {
  if (env.NODE_ENV === "production") {
    throw new Error("Refusing to seed a production database.");
  }

  const reset = process.argv.includes("--reset");
  if (reset) {
    console.info("Dropping and re-migrating the schema…");
    await resetSchema();
  }

  const [existing] = await db.select({ value: count() }).from(user);
  if (existing && existing.value > 0) {
    console.info(
      `Database already has ${existing.value} user(s); leaving it alone.\n` +
        "Re-run with `bun run db:seed -- --reset` to wipe and reseed.",
    );
    return;
  }

  const owner = await createUser("owner@example.com", "Ada Lovelace");
  const mercy = await createOrg(owner, "Mercy General Hospital", "mercy-general");
  await createOrg(owner, "Ridgeview Academy", "ridgeview-academy");

  const admin = await createUser("admin@example.com", "Grace Hopper");
  const staff = await createUser("staff@example.com", "Alan Turing");
  await addMember(mercy, admin, "admin");
  await addMember(mercy, staff, "member");

  // Left unaccepted, so the Members page shows an invited row on arrival.
  await auth.api.createInvitation({
    body: { email: "invited@example.com", role: "member", organizationId: mercy },
    headers: owner.headers,
  });

  await addSettings(mercy);

  const [mercyCount] = await db
    .select({ value: count() })
    .from(member)
    .where(eq(member.organizationId, mercy));

  console.info(
    [
      "",
      "Seeded.",
      "",
      `  Password for every account below: ${PASSWORD}`,
      "",
      "  owner@example.com   owner   Mercy General Hospital + Ridgeview Academy",
      "  admin@example.com   admin   Mercy General Hospital",
      "  staff@example.com   member  Mercy General Hospital",
      "",
      `  Mercy General Hospital  ${mercyCount?.value ?? 0} members, 1 pending invitation`,
      "  Ridgeview Academy       1 member",
      "",
      "  Sign in as owner@example.com to switch between both orgs.",
      "  admin@example.com can read the audit log;",
      "  staff@example.com cannot — that denial is itself audited.",
      "",
      "  New accounts are created by an operator:",
      "  bun run create-user <email> <name> <password>",
      "",
      `  ${env.CORS_ORIGIN}/login`,
      "",
    ].join("\n"),
  );
}

await main();
process.exit(0);
