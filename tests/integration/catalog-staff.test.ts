import { beforeAll, expect, test } from "bun:test";

import { createOrganization, createTestUser, joinOrganization } from "../support/auth";
import { clientFor, expectORPCCode } from "../support/client";
import { resetTestDatabase } from "../support/database";
import { uniqueSuffix } from "../support/unique";

beforeAll(async () => {
  await resetTestDatabase();
});

function catalogItemInput(orgSlug: string, name = "Consultation") {
  return {
    orgSlug,
    name,
    category: "consultation" as const,
    unitPrice: 150_00n,
    taxRatePercent: "0",
    customRate: false,
  };
}

test("catalog CRUD, filters, and deactivation are organization-scoped", async () => {
  const owner = await createTestUser("catalog-crud-owner");
  const one = await createOrganization(owner, "catalog-crud-one");
  const two = await createOrganization(owner, "catalog-crud-two");
  const api = clientFor(owner);
  const created = await api.catalog.create(catalogItemInput(one.slug));
  expect(created).toMatchObject({
    orgId: one.id,
    name: "Consultation",
    category: "consultation",
    unitPrice: 150_00n,
    active: true,
  });
  expect((await api.catalog.list({ orgSlug: one.slug })).items.map((item) => item.id)).toContain(
    created.id,
  );

  const updated = await api.catalog.update({
    orgSlug: one.slug,
    itemId: created.id,
    name: created.name,
    category: created.category,
    unitPrice: 200_00n,
    customRate: true,
    taxRatePercent: created.taxRatePercent,
    taxCode: created.taxCode,
  });

  expect(updated.unitPrice).toBe(200_00n);
  expect(updated.taxRatePercent).toBe(created.taxRatePercent);

  const activeOnly = await api.catalog.setActive({
    orgSlug: one.slug,
    itemId: created.id,
    active: false,
  });

  expect(activeOnly.active).toBe(false);

  const afterActiveChange = (await api.catalog.list({ orgSlug: one.slug })).items.find(
    (item) => item.id === created.id,
  );

  expect(afterActiveChange).toMatchObject({
    active: false,
    unitPrice: updated.unitPrice,
    customRate: true,
  });

  const elsewhere = await api.catalog.create(catalogItemInput(two.slug));
  expect(elsewhere.orgId).toBe(two.id);

  const procedure = await api.catalog.create({
    ...catalogItemInput(one.slug, "Procedure"),
    category: "procedure",
  });

  const active = await api.catalog.list({ orgSlug: one.slug, activeOnly: true });
  expect(active.items.map((item) => item.id)).not.toContain(created.id);
  const procedures = await api.catalog.list({ orgSlug: one.slug, category: "procedure" });
  expect(procedures.items.map((item) => item.id)).toEqual([procedure.id]);
});

test("plain members can read catalog and staff but cannot mutate either domain", async () => {
  const owner = await createTestUser("catalog-staff-gate-owner");
  const organization = await createOrganization(owner, "catalog-staff-gate");
  const member = await createTestUser("catalog-staff-gate-member");
  await joinOrganization(member, organization.id);
  const ownerClient = clientFor(owner);
  const memberClient = clientFor(member);

  const item = await ownerClient.catalog.create(catalogItemInput(organization.slug));

  expect((await memberClient.catalog.list({ orgSlug: organization.slug })).items).toContainEqual(
    item,
  );
  expect(await memberClient.staff.listPractitioners({ orgSlug: organization.slug })).toEqual([]);

  await expectORPCCode(
    memberClient.catalog.create(catalogItemInput(organization.slug)),
    "FORBIDDEN",
  );
  await expectORPCCode(
    memberClient.catalog.update({
      orgSlug: organization.slug,
      itemId: item.id,
      name: item.name,
      category: item.category,
      unitPrice: item.unitPrice,
      customRate: false,
      taxRatePercent: item.taxRatePercent,
      taxCode: item.taxCode,
    }),
    "FORBIDDEN",
  );
  await expectORPCCode(
    memberClient.staff.createDepartment({ orgSlug: organization.slug, name: "Denied" }),
    "FORBIDDEN",
  );
  await expectORPCCode(
    memberClient.staff.createPractitioner({
      orgSlug: organization.slug,
      name: "Denied",
      departmentId: Bun.randomUUIDv7(),
    }),
    "FORBIDDEN",
  );
});

test("service search returns six active OPD services by name, consultations only on opt-in", async () => {
  const owner = await createTestUser("catalog-service-search-owner");
  const organization = await createOrganization(owner, "catalog-service-search");
  const otherOwner = await createTestUser("catalog-service-search-other-owner");
  const otherOrganization = await createOrganization(otherOwner, "catalog-service-search-other");
  const api = clientFor(owner);
  const query = `Desk ${uniqueSuffix()}`;

  const consultations = await Promise.all(
    Array.from({ length: 6 }, (_, index) =>
      api.catalog.create(catalogItemInput(organization.slug, `${query} A${index} consultation`)),
    ),
  );

  const procedure = await api.catalog.create({
    ...catalogItemInput(organization.slug, `${query} Z procedure`),
    category: "procedure",
  });

  await Promise.all([
    ...Array.from({ length: 7 }, (_, index) =>
      api.catalog.create({
        ...catalogItemInput(organization.slug, `${query} B${index} lab`),
        category: "lab" as const,
      }),
    ),
    clientFor(otherOwner).catalog.create(
      catalogItemInput(otherOrganization.slug, `${query} A0 consultation`),
    ),
  ]);

  const services = await api.catalog.searchServices({
    orgSlug: organization.slug,
    query,
    includeConsultation: false,
  });

  expect(services.map((item) => item.id)).toEqual([procedure.id]);

  const withConsultations = await api.catalog.searchServices({
    orgSlug: organization.slug,
    query,
    includeConsultation: true,
  });

  expect(withConsultations.map((item) => item.id)).toEqual(consultations.map((item) => item.id));
});

test("departments and practitioners support linked CRUD within an organization", async () => {
  const owner = await createTestUser("staff-crud-owner");
  const organization = await createOrganization(owner, "staff-crud");
  const member = await createTestUser("staff-crud-member");
  await joinOrganization(member, organization.id);
  const api = clientFor(owner);

  const department = await api.staff.createDepartment({
    orgSlug: organization.slug,
    name: "General Medicine",
  });

  expect(
    (await api.staff.listDepartments({ orgSlug: organization.slug })).map((row) => row.id),
  ).toContain(department.id);

  const renamed = await api.staff.updateDepartment({
    orgSlug: organization.slug,
    departmentId: department.id,
    name: "Internal Medicine",
  });

  expect(renamed.name).toBe("Internal Medicine");
  await expectORPCCode(
    api.staff.createDepartment({ orgSlug: organization.slug, name: "Internal Medicine" }),
    "CONFLICT",
  );

  const fee = await api.catalog.create(catalogItemInput(organization.slug, "Consult Fee"));

  const practitioner = await api.staff.createPractitioner({
    orgSlug: organization.slug,
    name: "Dr. Ada",
    departmentId: department.id,
    registrationNumber: "REG-001",
    memberUserId: member.user.id,
    consultFeeItemId: fee.id,
  });

  expect(practitioner).toMatchObject({
    orgId: organization.id,
    name: "dr. ada",
    departmentId: department.id,
    registrationNumber: "REG-001",
    memberUserId: member.user.id,
    consultFeeItemId: fee.id,
  });
  expect(
    (await api.staff.listPractitioners({ orgSlug: organization.slug })).map((row) => row.id),
  ).toContain(practitioner.id);
  expect(
    (
      await api.staff.listPractitioners({
        orgSlug: organization.slug,
        query: "Ada",
      })
    ).map((row) => row.id),
  ).toEqual([practitioner.id]);

  const cleared = await api.staff.updatePractitioner({
    orgSlug: organization.slug,
    practitionerId: practitioner.id,
    name: practitioner.name,
    departmentId: department.id,
    registrationNumber: null,
    memberUserId: null,
    consultFeeItemId: null,
  });

  expect(cleared).toMatchObject({
    registrationNumber: null,
    memberUserId: null,
    consultFeeItemId: null,
  });
});

test("practitioner references and updates hide foreign organization ids", async () => {
  const alphaOwner = await createTestUser("staff-reference-alpha");
  const alpha = await createOrganization(alphaOwner, "staff-reference-alpha");
  const betaOwner = await createTestUser("staff-reference-beta");
  const beta = await createOrganization(betaOwner, "staff-reference-beta");
  const alphaClient = clientFor(alphaOwner);
  const betaClient = clientFor(betaOwner);

  const alphaDepartment = await alphaClient.staff.createDepartment({
    orgSlug: alpha.slug,
    name: "Alpha Department",
  });

  const betaDepartment = await betaClient.staff.createDepartment({
    orgSlug: beta.slug,
    name: "Beta Department",
  });

  const alphaItem = await alphaClient.catalog.create(catalogItemInput(alpha.slug));
  const betaItem = await betaClient.catalog.create(catalogItemInput(beta.slug));

  const alphaPractitioner = await alphaClient.staff.createPractitioner({
    orgSlug: alpha.slug,
    name: "Alpha Practitioner",
    departmentId: alphaDepartment.id,
  });

  const betaPractitioner = await betaClient.staff.createPractitioner({
    orgSlug: beta.slug,
    name: "Beta Practitioner",
    departmentId: betaDepartment.id,
  });

  await expectORPCCode(
    alphaClient.staff.createPractitioner({
      orgSlug: alpha.slug,
      name: "Foreign Department",
      departmentId: betaDepartment.id,
    }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    alphaClient.staff.createPractitioner({
      orgSlug: alpha.slug,
      name: "Foreign Fee",
      departmentId: alphaDepartment.id,
      consultFeeItemId: betaItem.id,
    }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    alphaClient.staff.createPractitioner({
      orgSlug: alpha.slug,
      name: "Foreign Member",
      departmentId: alphaDepartment.id,
      memberUserId: betaOwner.user.id,
    }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    alphaClient.catalog.update({
      orgSlug: alpha.slug,
      itemId: betaItem.id,
      name: alphaItem.name,
      category: alphaItem.category,
      unitPrice: alphaItem.unitPrice,
      customRate: false,
      taxRatePercent: alphaItem.taxRatePercent,
      taxCode: alphaItem.taxCode,
    }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    alphaClient.staff.updateDepartment({
      orgSlug: alpha.slug,
      departmentId: betaDepartment.id,
      name: "Foreign rename",
    }),
    "NOT_FOUND",
  );
  await expectORPCCode(
    alphaClient.staff.updatePractitioner({
      orgSlug: alpha.slug,
      practitionerId: betaPractitioner.id,
      name: alphaPractitioner.name,
      departmentId: alphaDepartment.id,
      registrationNumber: null,
      memberUserId: null,
      consultFeeItemId: null,
    }),
    "NOT_FOUND",
  );
});
