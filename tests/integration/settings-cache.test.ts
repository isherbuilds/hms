import { beforeAll, expect, test } from "bun:test";

import {
  SETTINGS_CACHE_TTL_MS,
  invalidateOrgSettings,
  readOrgSettings,
} from "@better-stack/api/lib/settings-cache";
import { db } from "@better-stack/db";
import { organizationSettings } from "@better-stack/db/schema/organization-settings";
import { eq } from "drizzle-orm";

import { createOrganization, createTestUser } from "../support/auth";
import { clientFor } from "../support/client";
import { resetTestDatabase } from "../support/database";

beforeAll(async () => {
  await resetTestDatabase();
});

test("fresh organizations read the settings defaults", async () => {
  const owner = await createTestUser("settings-cache-defaults");
  const organization = await createOrganization(owner, "settings-cache-defaults");

  const settings = await readOrgSettings(organization.id);

  expect(settings.invoicePrefix).toBe("INV");
  expect(settings.fiscalYearStartMonth).toBe(4);
});

test("settings.update invalidates the cached value", async () => {
  const owner = await createTestUser("settings-cache-write-through");
  const organization = await createOrganization(owner, "settings-cache-write-through");
  const api = clientFor(owner);

  expect((await readOrgSettings(organization.id)).invoicePrefix).toBe("INV");

  const defaults = await api.settings.get({ orgSlug: organization.slug });
  await api.settings.update({
    orgSlug: organization.slug,
    ...defaults,
    invoicePrefix: "LIVE",
  });

  expect((await readOrgSettings(organization.id)).invoicePrefix).toBe("LIVE");
});

test("direct writes remain stale until the cache TTL expires", async () => {
  const owner = await createTestUser("settings-cache-expiry");
  const organization = await createOrganization(owner, "settings-cache-expiry");
  const api = clientFor(owner);
  const defaults = await api.settings.get({ orgSlug: organization.slug });

  await api.settings.update({
    orgSlug: organization.slug,
    ...defaults,
    invoicePrefix: "OLD",
  });
  expect((await readOrgSettings(organization.id)).invoicePrefix).toBe("OLD");

  await db
    .update(organizationSettings)
    .set({ invoicePrefix: "NEW" })
    .where(eq(organizationSettings.orgId, organization.id));

  expect((await readOrgSettings(organization.id)).invoicePrefix).toBe("OLD");
  expect(
    (await readOrgSettings(organization.id, Date.now() + SETTINGS_CACHE_TTL_MS + 1_000))
      .invoicePrefix,
  ).toBe("NEW");
});

test("explicit invalidation makes a direct write visible on the next read", async () => {
  const owner = await createTestUser("settings-cache-invalidate");
  const organization = await createOrganization(owner, "settings-cache-invalidate");
  const api = clientFor(owner);
  const defaults = await api.settings.get({ orgSlug: organization.slug });

  await api.settings.update({
    orgSlug: organization.slug,
    ...defaults,
    invoicePrefix: "BEFORE",
  });
  expect((await readOrgSettings(organization.id)).invoicePrefix).toBe("BEFORE");

  await db
    .update(organizationSettings)
    .set({ invoicePrefix: "AFTER" })
    .where(eq(organizationSettings.orgId, organization.id));
  invalidateOrgSettings(organization.id);

  expect((await readOrgSettings(organization.id)).invoicePrefix).toBe("AFTER");
});
