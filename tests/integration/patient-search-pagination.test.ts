import { beforeAll, expect, test } from "bun:test";

import { db } from "@hms/db";
import { file } from "@hms/db/schema/file";
import { patients } from "@hms/db/schema/patients";
import { sql } from "drizzle-orm";

import { createOrganization, createTestUser } from "../support/auth";
import { clientFor } from "../support/client";
import { resetTestDatabase } from "../support/database";

beforeAll(async () => {
  await resetTestDatabase();
});

function registration(orgSlug: string, name: string, phone: string) {
  return {
    orgSlug,
    name,
    phone,
    sex: "other" as const,
    ageYears: 30,
    address: "",
  };
}

test("patient search only returns a cursor when another matching row exists", async () => {
  const owner = await createTestUser("patient-search-boundary");
  const exactOrganization = await createOrganization(owner, "patient-search-exact");
  const overflowOrganization = await createOrganization(owner, "patient-search-overflow");
  const api = clientFor(owner);
  const limit = 5;

  for (let index = 0; index < limit; index++) {
    await api.patient.register(
      registration(exactOrganization.slug, `Exact Boundary ${index}`, `55510${index}`),
    );
  }

  for (let index = 0; index < limit + 1; index++) {
    await api.patient.register(
      registration(overflowOrganization.slug, `Overflow Boundary ${index}`, `55520${index}`),
    );
  }

  const exactPage = await api.patient.search({
    orgSlug: exactOrganization.slug,
    query: "Exact Boundary",
    limit,
  });
  expect(exactPage.items).toHaveLength(limit);
  expect(exactPage.items.every((patient) => patient.orgId === exactOrganization.id)).toBe(true);
  expect(exactPage.nextCursor).toBeNull();

  const firstOverflowPage = await api.patient.search({
    orgSlug: overflowOrganization.slug,
    query: "Overflow Boundary",
    limit,
  });
  expect(firstOverflowPage.items).toHaveLength(limit);
  expect(
    firstOverflowPage.items.every((patient) => patient.orgId === overflowOrganization.id),
  ).toBe(true);
  expect(firstOverflowPage.nextCursor).not.toBeNull();

  const nextCursor = firstOverflowPage.nextCursor;
  if (!nextCursor) {
    throw new Error("Expected another page for limit + 1 matching patients");
  }

  const secondOverflowPage = await api.patient.search({
    orgSlug: overflowOrganization.slug,
    query: "Overflow Boundary",
    limit,
    cursor: nextCursor,
  });
  expect(secondOverflowPage.items).toHaveLength(1);
  expect(secondOverflowPage.items[0]?.orgId).toBe(overflowOrganization.id);
  expect(secondOverflowPage.nextCursor).toBeNull();
});

test("pagination keeps rows that share a creation millisecond", async () => {
  const owner = await createTestUser("patient-search-microsecond");
  const organization = await createOrganization(owner, "patient-search-micros");
  const api = clientFor(owner);

  // `defaultNow()` stores microseconds. The id-only keyset never compares
  // timestamps, so same-millisecond rows can neither vanish nor repeat —
  // the failure mode of a JS Date cursor, which only carries milliseconds.
  const ids = [1, 2, 3].map(() => Bun.randomUUIDv7());
  const rows = ids.map((id, index) => ({
    id,
    orgId: organization.id,
    mrn: `MICRO-${index}`,
    name: `Micro Boundary ${index}`,
    phone: `77700${index}`,
    sex: "other" as const,
    ageYears: 30,
    address: "",
    createdAt: sql`${`2026-08-24T05:00:00.500${String(index + 1).padStart(3, "0")}Z`}::timestamptz`,
  }));
  await db.insert(patients).values(rows);

  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const page = await api.patient.search({
      orgSlug: organization.slug,
      query: "Micro Boundary",
      limit: 1,
      ...(cursor ? { cursor } : {}),
    });
    seen.push(...page.items.map((patient) => patient.id));
    cursor = page.nextCursor;
  } while (cursor);

  // Newest-first by id, no drops, no repeats.
  expect(seen).toEqual([...ids].sort().reverse());
});

test("file list only returns a cursor when another row exists and keeps same-millisecond rows", async () => {
  const owner = await createTestUser("file-list-boundary");
  const organization = await createOrganization(owner, "file-list-boundary");
  const api = clientFor(owner);

  // Uploads burst inside one millisecond; `created_at` is `defaultNow()`
  // (microseconds), so the cursor must not round-trip through a JS Date.
  await db.insert(file).values(
    [1, 2, 3].map((microseconds) => ({
      id: `${organization.id}/boundary-${microseconds}`,
      orgId: organization.id,
      name: `scan-${microseconds}.pdf`,
      size: 1000,
      status: "ready",
      createdAt: sql`${`2026-08-24T06:00:00.250${microseconds.toString().padStart(3, "0")}Z`}::timestamptz`,
    })),
  );

  const seen: string[] = [];
  let cursor: { createdAt: string; id: string } | null = null;
  do {
    const page = await api.file.list({
      orgSlug: organization.slug,
      limit: 1,
      ...(cursor ? { cursor } : {}),
    });
    seen.push(...page.items.map((item) => item.name));
    cursor = page.nextCursor;
  } while (cursor);

  // Descending createdAt with microsecond precision: no drops, no repeats.
  expect(seen).toEqual(["scan-3.pdf", "scan-2.pdf", "scan-1.pdf"]);

  // Exactly `limit` matching rows must not fabricate a phantom next page.
  const exact = await api.file.list({ orgSlug: organization.slug, limit: 3 });
  expect(exact.items).toHaveLength(3);
  expect(exact.nextCursor).toBeNull();
});
