import { beforeAll, expect, test } from "bun:test";

import { db } from "@hms/db";
import { patients } from "@hms/db/schema/patients";
import { and, eq } from "drizzle-orm";

import { createOrganization, createTestUser } from "../support/auth";
import { clientFor } from "../support/client";
import { resetTestDatabase } from "../support/database";

beforeAll(async () => {
  await resetTestDatabase();
});

test("patient registration persists one birth model and exposes no legacy age", async () => {
  const owner = await createTestUser("patient-age-model");
  const organization = await createOrganization(owner, "patient-age-model");
  const api = clientFor(owner);

  const registered = await api.patient.register({
    orgSlug: organization.slug,
    name: "Estimated Birth Patient",
    phone: "555-1200",
    sex: "female",
    dateOfBirth: "1992-08-27",
    dobEstimated: true,
    address: "",
  });

  expect(registered).toMatchObject({
    dateOfBirth: "1992-08-27",
    dobEstimated: true,
  });
  expect("ageYears" in registered).toBe(false);

  const [stored] = await db
    .select({
      dateOfBirth: patients.dateOfBirth,
      dobEstimated: patients.dobEstimated,
    })
    .from(patients)
    .where(and(eq(patients.orgId, organization.id), eq(patients.id, registered.id)))
    .limit(1);
  expect(stored).toEqual({ dateOfBirth: "1992-08-27", dobEstimated: true });

  const loaded = await api.patient.get({
    orgSlug: organization.slug,
    patientId: registered.id,
  });
  expect(loaded).toMatchObject({ dateOfBirth: "1992-08-27", dobEstimated: true });
  expect("ageYears" in loaded).toBe(false);
});
