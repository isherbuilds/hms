import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import pg from "pg";

import "../packages/env/src/load.ts";

const TIMEOUT_MS = 3_000;
const COMPOSE_FILE = "packages/db/docker-compose.dev.yaml";
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../packages/db/src/migrations", import.meta.url));

type Check = { ok: boolean; label: string; detail: string };

function result(ok: boolean, label: string, detail: string): Check {
  return { ok, label, detail };
}

function errorCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) return "unavailable";
  return String(error.code);
}

async function dockerChecks(): Promise<Check[]> {
  let process: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    process = Bun.spawn(["docker", "compose", "-f", COMPOSE_FILE, "ps", "--format", "json"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch {
    return [result(false, "Docker", "command unavailable; install or start Docker")];
  }

  const timer = setTimeout(() => process.kill(), TIMEOUT_MS);
  const [exitCode, stdout] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
  ]);
  clearTimeout(timer);
  if (exitCode !== 0) {
    return [result(false, "Docker", "Compose unavailable; start Docker and run bun run db:up")];
  }

  const services = stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(
      (line) =>
        JSON.parse(line) as { Health: string; Ports: string; Service: string; State: string },
    );

  return ["postgres", "seaweedfs"].map((name) => {
    const service = services.find(({ Service }) => Service === name);
    if (!service) {
      return result(false, `Docker ${name}`, `not running; run bun run db:up`);
    }
    const ready = service.State === "running" && service.Health === "healthy";
    return result(
      ready,
      `Docker ${name}`,
      `${service.State}${service.Health ? `/${service.Health}` : ""} at ${service.Ports || "no published port"}`,
    );
  });
}

function configuredOrigin(name: string): URL | null {
  const value = process.env[name];
  if (!value) return null;
  try {
    return new URL(new URL(value).origin);
  } catch {
    return null;
  }
}

async function urlCheck(label: string, url: URL | null): Promise<Check> {
  if (!url) return result(false, label, "URL is missing or invalid in packages/env/.env");
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    return result(response.ok, label, `${url.href} responded ${response.status}`);
  } catch {
    return result(false, label, `${url.href} did not respond; run bun run dev`);
  }
}

async function databaseChecks(): Promise<Check[]> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return [
      result(false, "Database", "DATABASE_URL is missing in packages/env/.env"),
      result(false, "Migrations", "unverified because DATABASE_URL is missing"),
    ];
  }

  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: TIMEOUT_MS,
    query_timeout: TIMEOUT_MS,
  });
  try {
    await client.connect();
    await client.query("select 1");
  } catch (error) {
    await client.end().catch(() => undefined);
    return [
      result(
        false,
        "Database",
        `connection failed (${errorCode(error)}); check DATABASE_URL and Docker`,
      ),
      result(false, "Migrations", "unverified because the database is unavailable"),
    ];
  }

  let migration: Check;
  try {
    const local = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
    const applied = await client.query<{ created_at: string; hash: string }>(
      "select hash, created_at from drizzle.__drizzle_migrations order by id",
    );
    const current =
      local.length === applied.rows.length &&
      local.every(
        ({ folderMillis, hash }, index) =>
          applied.rows[index]?.created_at === String(folderMillis) &&
          applied.rows[index]?.hash === hash,
      );
    migration = result(
      current,
      "Migrations",
      current
        ? `${local.length}/${local.length} local migrations applied`
        : `unverified: database records do not exactly match ${local.length} local migrations`,
    );
  } catch (error) {
    migration = result(
      false,
      "Migrations",
      `unverified: migration history could not be read (${errorCode(error)})`,
    );
  } finally {
    await client.end();
  }

  return [result(true, "Database", "connected and answered select 1"), migration];
}

const checks = (
  await Promise.all([
    dockerChecks(),
    databaseChecks(),
    Promise.all([
      urlCheck("Web", configuredOrigin("CORS_ORIGIN")),
      urlCheck("API readiness", configuredOrigin("BETTER_AUTH_URL")),
      urlCheck("Docs", new URL("https://docs.hms.localhost")),
    ]),
  ])
).flat();

for (const check of checks) {
  console.info(`${check.ok ? "[ok]" : "[fail]"} ${check.label}: ${check.detail}`);
}

process.exit(checks.every(({ ok }) => ok) ? 0 : 1);
