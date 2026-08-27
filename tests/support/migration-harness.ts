import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface MigrationJournal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../packages/db/src/migrations",
);

function databaseIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export async function withIsolatedMigrationDatabase<T>(
  run: (
    client: pg.Client,
    migrateThrough: (realJournalEntrySuffix: string) => Promise<void>,
  ) => Promise<T>,
): Promise<T> {
  const sourceUrl = new URL(process.env.DATABASE_URL!);
  const databaseName = `hms_migration_${process.pid}_${crypto.randomUUID().replaceAll("-", "")}`;
  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = "/postgres";
  const isolatedUrl = new URL(sourceUrl);
  isolatedUrl.pathname = `/${databaseName}`;

  const stagedFolders: string[] = [];
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  let client: pg.Client | undefined;

  await admin.connect();
  try {
    await admin.query(`create database ${databaseIdentifier(databaseName)}`);
    client = new pg.Client({ connectionString: isolatedUrl.toString() });
    await client.connect();

    const migrateThrough = async (realJournalEntrySuffix: string): Promise<void> => {
      const journalPath = join(migrationsFolder, "meta/_journal.json");
      const journal = JSON.parse(await readFile(journalPath, "utf8")) as MigrationJournal;
      const matches = journal.entries.filter((entry) => entry.tag.endsWith(realJournalEntrySuffix));
      if (matches.length !== 1) {
        throw new Error(
          `Expected one migration journal entry ending in "${realJournalEntrySuffix}", found ${matches.length}.`,
        );
      }

      const cutoff = journal.entries.indexOf(matches[0]!);
      const entries = journal.entries.slice(0, cutoff + 1);
      const stagedFolder = await mkdtemp(join(tmpdir(), "hms-migrations-"));
      stagedFolders.push(stagedFolder);
      await mkdir(join(stagedFolder, "meta"));

      for (const entry of entries) {
        const filename = `${entry.tag}.sql`;
        await symlink(join(migrationsFolder, filename), join(stagedFolder, filename));
      }
      await writeFile(
        join(stagedFolder, "meta/_journal.json"),
        `${JSON.stringify({ ...journal, entries }, null, 2)}\n`,
      );

      await migrate(drizzle(client!), { migrationsFolder: stagedFolder });
    };

    return await run(client, migrateThrough);
  } finally {
    try {
      if (client) {
        await client.end();
      }
    } finally {
      try {
        await admin.query(
          `drop database if exists ${databaseIdentifier(databaseName)} with (force)`,
        );
      } finally {
        try {
          await admin.end();
        } finally {
          await Promise.all(
            stagedFolders.map((folder) => rm(folder, { recursive: true, force: true })),
          );
        }
      }
    }
  }
}
