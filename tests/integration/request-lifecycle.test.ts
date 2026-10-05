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

test("the server resolves authentication only where needed, at most once, and after the body limit", async () => {
  const getSession = spyOn(auth.api, "getSession");

  try {
    const healthResponse = await app.request("http://localhost/");
    expect(healthResponse.status).toBe(200);

    for (const path of ["rpc", "api-reference"]) {
      const response = await app.request(`http://localhost/${path}/dashboard/collections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: { orgSlug: "x".repeat(1_100_000) } }),
      });

      expect(response.status).toBe(413);
    }

    expect(getSession).toHaveBeenCalledTimes(0);

    const rpcResponse = await app.request("http://localhost/rpc/dashboard/collections", {
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

test("counters are gapless under concurrency, independent per key and organization, and reuse rolled-back numbers", async () => {
  const owner = await createTestUser("counter");
  const one = await createOrganization(owner, "counter-one");
  const two = await createOrganization(owner, "counter-two");

  // Concurrency is the point: the upsert's row lock must serialize these into 1..N.
  const values = await Promise.all(
    Array.from({ length: 25 }, () => db.transaction((tx) => nextCounter(tx, one.id, "mrn"))),
  );

  expect([...values].sort((a, b) => a - b)).toEqual(
    Array.from({ length: 25 }, (_, index) => index + 1),
  );

  await expect(
    db.transaction(async (tx) => {
      await nextCounter(tx, one.id, "mrn");
      throw new Error("abort after increment");
    }),
  ).rejects.toThrow("abort after increment");
  expect(await db.transaction((tx) => nextCounter(tx, one.id, "mrn"))).toBe(26);

  await db.transaction(async (tx) => {
    expect(await nextCounter(tx, one.id, "invoice:2026-27")).toBe(1);
    expect(await nextCounter(tx, one.id, "invoice:2026-27")).toBe(2);
    expect(await nextCounter(tx, one.id, "receipt:2026-27")).toBe(1);
  });
  expect(await db.transaction((tx) => nextCounter(tx, two.id, "invoice:2026-27"))).toBe(1);
});

test("the settings cache serves defaults, refreshes on update, and stays stale after direct writes until TTL or invalidation", async () => {
  const owner = await createTestUser("settings-cache");
  const organization = await createOrganization(owner, "settings-cache");
  const api = clientFor(owner);

  const fresh = await readOrgSettings(organization.id);
  expect(fresh.invoicePrefix).toBe("INV");
  expect(fresh.fiscalYearStartMonth).toBe(4);

  const defaults = await api.settings.get({ orgSlug: organization.slug });
  await api.settings.update({
    orgSlug: organization.slug,
    ...defaults,
    invoicePrefix: "LIV",
  });
  expect((await readOrgSettings(organization.id)).invoicePrefix).toBe("LIV");

  await db
    .update(organizationSettings)
    .set({ invoicePrefix: "NEW", timeZone: "Pacific/Auckland" })
    .where(eq(organizationSettings.orgId, organization.id));

  expect((await readOrgSettings(organization.id)).invoicePrefix).toBe("LIV");
  expect((await api.member.me({ orgSlug: organization.slug })).timeZone).toBe("Pacific/Auckland");
  expect(
    (await readOrgSettings(organization.id, Date.now() + SETTINGS_CACHE_TTL_MS + 1_000))
      .invoicePrefix,
  ).toBe("NEW");

  await db
    .update(organizationSettings)
    .set({ invoicePrefix: "POST" })
    .where(eq(organizationSettings.orgId, organization.id));
  invalidateOrgSettings(organization.id);

  expect((await readOrgSettings(organization.id)).invoicePrefix).toBe("POST");
});
