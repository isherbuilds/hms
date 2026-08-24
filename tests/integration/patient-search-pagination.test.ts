import { beforeAll, expect, test } from "bun:test";

import { db } from "@hms/db";
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

test("pagination keeps rows that share the cursor's millisecond", async () => {
  const owner = await createTestUser("patient-search-microsecond");
  const organization = await createOrganization(owner, "patient-search-micros");
  const api = clientFor(owner);

  // defaultNow() stores microseconds, but a JS Date cursor only carries
  // milliseconds. Rows inside the boundary millisecond used to vanish.
  const rows = [1, 2, 3].map((microseconds) => ({
    id: Bun.randomUUIDv7(),
    orgId: organization.id,
    mrn: `MICRO-${microseconds}`,
    name: `Micro Boundary ${microseconds}`,
    phone: `77700${microseconds}`,
    sex: "other" as const,
    ageYears: 30,
    address: "",
    createdAt: sql`${`2026-08-24T05:00:00.500${microseconds.toString().padStart(3, "0")}Z`}::timestamptz`,
  }));
  await db.insert(patients).values(rows);

  const seen: string[] = [];
  let cursor: { createdAt: string; id: string } | null = null;
  do {
    const page = await api.patient.search({
      orgSlug: organization.slug,
      query: "Micro Boundary",
      limit: 1,
      ...(cursor ? { cursor } : {}),
    });
    seen.push(...page.items.map((patient) => patient.mrn));
    cursor = page.nextCursor;
  } while (cursor);

  // Descending createdAt: higher microseconds first, no drops, no repeats.
  expect(seen).toEqual(["MICRO-3", "MICRO-2", "MICRO-1"]);
});
