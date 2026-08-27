import { beforeAll, expect, test } from "bun:test";

import { createOrganization, createTestUser } from "../support/auth";
import { clientFor, expectORPCCode } from "../support/client";
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
    dateOfBirth: "1990-01-01",
    dobEstimated: false,
    address: "",
  };
}

test("phone lookup ignores formatting and preserves stored display text", async () => {
  const owner = await createTestUser("patient-phone-format");
  const organization = await createOrganization(owner, "patient-phone-format");
  const api = clientFor(owner);
  const storedPhone = "98765-43210";
  const patient = await api.patient.register(
    registration(organization.slug, "Formatted Phone", storedPhone),
  );

  for (const phone of ["9876543210", "98765 43210", "(98765) 43210"]) {
    const result = await api.patient.search({ orgSlug: organization.slug, phone });
    expect(result.items.map((item) => item.id)).toContain(patient.id);
    expect(result.items.find((item) => item.id === patient.id)?.phone).toBe(storedPhone);
  }

  const generic = await api.patient.search({
    orgSlug: organization.slug,
    query: "98765 43210",
  });
  expect(generic.items.map((item) => item.id)).toContain(patient.id);

  const loaded = await api.patient.get({ orgSlug: organization.slug, patientId: patient.id });
  expect(loaded.phone).toBe(storedPhone);
});

test("short normalized values reject explicit lookup and skip generic phone matching", async () => {
  const owner = await createTestUser("patient-phone-short");
  const organization = await createOrganization(owner, "patient-phone-short");
  const api = clientFor(owner);
  await api.patient.register(registration(organization.slug, "Boundary Patient", "12-3456"));

  await expectORPCCode(
    api.patient.search({ orgSlug: organization.slug, phone: "--12--" }),
    "BAD_REQUEST",
  );

  const shortDigits = await api.patient.search({ orgSlug: organization.slug, query: "12" });
  expect(shortDigits.items).toHaveLength(0);

  const emptyNormalized = await api.patient.search({ orgSlug: organization.slug, query: "--" });
  expect(emptyNormalized.items).toHaveLength(0);
});
