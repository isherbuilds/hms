import { beforeAll, expect, spyOn, test } from "bun:test";

import { app } from "../../apps/server/src/index";
import {
  SETTINGS_CACHE_TTL_MS,
  invalidateOrgSettings,
  readOrgSettings,
} from "@hms/api/lib/settings-cache";
import { auth } from "@hms/auth";
import { db } from "@hms/db";
import { nextCounter } from "@hms/db/counter";
import { member } from "@hms/db/schema/auth";
import { organizationSettings } from "@hms/db/schema/organization-settings";
import { and, eq } from "drizzle-orm";

import { createOrganization, createTestUser } from "../support/auth";
import { clientFor, expectORPCCode, requestScopedClientFor } from "../support/client";
import { resetTestDatabase } from "../support/database";

beforeAll(async () => {
  await resetTestDatabase();
});

test("the server resolves authentication only where needed and at most once", async () => {
  const getSession = spyOn(auth.api, "getSession");

  try {
    const healthResponse = await app.request("http://localhost/");
    expect(healthResponse.status).toBe(200);
    expect(getSession).toHaveBeenCalledTimes(0);

    const rpcResponse = await app.request("http://localhost/rpc/dashboard/today", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ json: { orgSlug: "missing" } }),
    });

    expect(rpcResponse.status).toBe(401);
    expect(getSession).toHaveBeenCalledTimes(1);
  } finally {
    getSession.mockRestore();
  }
});

test("procedure endpoints reject an oversized body before resolving authentication", async () => {
  const getSession = spyOn(auth.api, "getSession");

  try {
    for (const path of ["rpc", "api-reference"]) {
      const response = await app.request(`http://localhost/${path}/dashboard/today`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: { orgSlug: "x".repeat(1_100_000) } }),
      });

      expect(response.status).toBe(413);
    }

    expect(getSession).toHaveBeenCalledTimes(0);
  } finally {
    getSession.mockRestore();
  }
});

test("procedure calls sharing one request share one membership join", async () => {
  const owner = await createTestUser("shared-request");
  const organization = await createOrganization(owner, "shared-request");

  const session = await auth.api.getSession({ headers: owner.headers });
  const getSession = spyOn(auth.api, "getSession").mockResolvedValue(session);
  const select = spyOn(db, "select");

  try {
    const perRequest = clientFor(owner);
    select.mockClear();
    await perRequest.settings.get({ orgSlug: organization.slug });
    await perRequest.settings.get({ orgSlug: organization.slug });
    const perRequestQueries = select.mock.calls.length;

    const oneRequest = requestScopedClientFor(owner);
    select.mockClear();
    await oneRequest.settings.get({ orgSlug: organization.slug });
    await oneRequest.settings.get({ orgSlug: organization.slug });
    const oneRequestQueries = select.mock.calls.length;

    // A delta, never an absolute count: unrelated handler queries cancel out.
    expect(oneRequestQueries).toBe(perRequestQueries - 1);
  } finally {
    select.mockRestore();
    getSession.mockRestore();
  }
});

test("membership is re-proven per request, so revocation takes effect immediately", async () => {
  const owner = await createTestUser("revoked");
  const organization = await createOrganization(owner, "revoked");

  const before = requestScopedClientFor(owner);
  await before.settings.get({ orgSlug: organization.slug });

  await db
    .delete(member)
    .where(and(eq(member.userId, owner.user.id), eq(member.organizationId, organization.id)));

  await expectORPCCode(
    clientFor(owner).settings.get({ orgSlug: organization.slug }),
    "FORBIDDEN",
    "a call after the member row is deleted",
  );
});

test("parallel increments yield a gapless, unique sequence", async () => {
  const owner = await createTestUser("counter");
  const organization = await createOrganization(owner, "counter");

  // Concurrency is the point: the upsert's row lock must serialize these into 1..N.
  const values = await Promise.all(
    Array.from({ length: 25 }, () =>
      db.transaction((tx) => nextCounter(tx, organization.id, "mrn")),
    ),
  );

  expect([...values].sort((a, b) => a - b)).toEqual(
    Array.from({ length: 25 }, (_, index) => index + 1),
  );
});

test("series are independent per key and per organization", async () => {
  const owner = await createTestUser("counter-keys");
  const one = await createOrganization(owner, "counter-one");
  const two = await createOrganization(owner, "counter-two");

  await db.transaction(async (tx) => {
    expect(await nextCounter(tx, one.id, "invoice:2026-27")).toBe(1);
    expect(await nextCounter(tx, one.id, "invoice:2026-27")).toBe(2);
    expect(await nextCounter(tx, one.id, "receipt:2026-27")).toBe(1);
  });

  const other = await db.transaction((tx) => nextCounter(tx, two.id, "invoice:2026-27"));
  expect(other).toBe(1);
});

test("a rolled-back transaction returns its number to the series", async () => {
  const owner = await createTestUser("counter-rollback");
  const organization = await createOrganization(owner, "counter-rollback");

  await db.transaction((tx) => nextCounter(tx, organization.id, "mrn"));

  await expect(
    db.transaction(async (tx) => {
      await nextCounter(tx, organization.id, "mrn");
      throw new Error("abort after increment");
    }),
  ).rejects.toThrow("abort after increment");

  const next = await db.transaction((tx) => nextCounter(tx, organization.id, "mrn"));
  expect(next).toBe(2);
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
    .set({ invoicePrefix: "NEW", timeZone: "Pacific/Auckland" })
    .where(eq(organizationSettings.orgId, organization.id));

  expect((await readOrgSettings(organization.id)).invoicePrefix).toBe("OLD");
  expect((await api.member.me({ orgSlug: organization.slug })).timeZone).toBe("Pacific/Auckland");
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
