import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";

import { withIsolatedMigrationDatabase } from "../support/migration-harness";

interface JournalEntry {
  when: number;
  tag: string;
}

const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../packages/db/src/migrations",
);

async function journalEntries(): Promise<JournalEntry[]> {
  const journal = JSON.parse(
    await readFile(resolve(migrationsFolder, "meta/_journal.json"), "utf8"),
  ) as { entries: JournalEntry[] };
  return journal.entries;
}

async function seedLegacyPatients(client: pg.Client): Promise<void> {
  await client.query(
    `insert into organization (id, name, slug, created_at)
     values ('migration-org', 'Migration Org', 'migration-org', now())`,
  );
  await client.query(
    `insert into patients (
       id, org_id, mrn, name, phone, sex, date_of_birth, age_years, address, updated_at
     ) values
       ('age-only', 'migration-org', '000001', 'Age Only', '5550001', 'other', null, 30, '', '2026-08-27T12:00:00.123456Z'),
       ('exact-dob', 'migration-org', '000002', 'Exact DOB', '5550002', 'female', '2000-02-29', null, '', '2026-08-27T12:00:00.987654Z')`,
  );
}

async function columnMetadata(client: pg.Client) {
  const result = await client.query<{
    column_name: string;
    is_nullable: "YES" | "NO";
    datetime_precision: number | null;
  }>(
    `select column_name, is_nullable, datetime_precision
     from information_schema.columns
     where table_schema = 'public' and table_name = 'patients'`,
  );
  return new Map(result.rows.map((row) => [row.column_name, row]));
}

async function assertPhaseACheckpoint(client: pg.Client): Promise<void> {
  const columns = await columnMetadata(client);
  expect(columns.get("date_of_birth")?.is_nullable).toBe("YES");
  expect(columns.get("dob_estimated")?.is_nullable).toBe("YES");
  expect(columns.has("age_years")).toBe(true);
  expect(columns.get("updated_at")?.datetime_precision).toBe(3);

  const patients = await client.query<{
    id: string;
    date_of_birth: string;
    dob_estimated: boolean;
    updated_at: string;
  }>(
    `select id, date_of_birth::text, dob_estimated,
            to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') as updated_at
     from patients
     order by id`,
  );
  expect(patients.rows).toEqual([
    {
      id: "age-only",
      date_of_birth: "1996-08-27",
      dob_estimated: true,
      updated_at: "2026-08-27T12:00:00.123000",
    },
    {
      id: "exact-dob",
      date_of_birth: "2000-02-29",
      dob_estimated: false,
      updated_at: "2026-08-27T12:00:00.988000",
    },
  ]);

  const entries = await journalEntries();
  const finalEntry = entries.find((entry) => entry.tag.endsWith("patient-dob-model-finalize"));
  expect(finalEntry).toBeDefined();
  const applied = await client.query<{ applied: boolean }>(
    `select exists (
       select 1 from drizzle.__drizzle_migrations where created_at = $1
     ) as applied`,
    [finalEntry!.when],
  );
  expect(applied.rows[0]?.applied).toBe(false);
}

async function migrateToPhaseA(
  client: pg.Client,
  migrateThrough: (suffix: string) => Promise<void>,
): Promise<void> {
  const entries = await journalEntries();
  const additiveIndex = entries.findIndex((entry) =>
    entry.tag.endsWith("patient-dob-estimate-add"),
  );
  expect(additiveIndex).toBeGreaterThan(0);
  await migrateThrough(entries[additiveIndex - 1]!.tag);
  await seedLegacyPatients(client);
  await migrateThrough("patient-dob-backfill");
}

test("Phase A checkpoint", async () => {
  await withIsolatedMigrationDatabase(async (client, migrateThrough) => {
    await migrateToPhaseA(client, migrateThrough);
    await assertPhaseACheckpoint(client);
  });
});

test("Phase B finalization", async () => {
  await withIsolatedMigrationDatabase(async (client, migrateThrough) => {
    await migrateToPhaseA(client, migrateThrough);
    await assertPhaseACheckpoint(client);

    await migrateThrough("patient-dob-model-finalize");

    const columns = await columnMetadata(client);
    expect(columns.get("date_of_birth")?.is_nullable).toBe("NO");
    expect(columns.get("dob_estimated")?.is_nullable).toBe("NO");
    expect(columns.has("age_years")).toBe(false);

    const constraints = await client.query<{ conname: string }>(
      `select conname
       from pg_constraint
       where conrelid = 'public.patients'::regclass`,
    );
    const constraintNames = new Set(constraints.rows.map((row) => row.conname));
    expect(constraintNames.has("patients_age_or_dob_check")).toBe(false);
    expect(constraintNames.has("patients_age_range_check")).toBe(false);
    for (const name of [
      "patients_org_id_id_unique",
      "patients_sex_check",
      "patients_blood_group_check",
    ]) {
      expect(constraintNames.has(name)).toBe(true);
    }

    const indexes = await client.query<{ indexname: string }>(
      `select indexname
       from pg_indexes
       where schemaname = 'public' and tablename = 'patients'`,
    );
    const indexNames = new Set(indexes.rows.map((row) => row.indexname));
    for (const name of [
      "patients_org_mrn_idx",
      "patients_org_uid_idx",
      "patients_org_created_idx",
    ]) {
      expect(indexNames.has(name)).toBe(true);
    }
  });
});
