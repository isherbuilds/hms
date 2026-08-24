import { beforeAll, expect, test } from "bun:test";

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
