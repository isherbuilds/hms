import { beforeAll, expect, spyOn, test } from "bun:test";

import { app } from "../../apps/server/src/index";
import { auth } from "@hms/auth";
import { db } from "@hms/db";
import { member } from "@hms/db/schema/auth";
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

test("RPC rejects an oversized body before resolving authentication", async () => {
  const getSession = spyOn(auth.api, "getSession");

  try {
    const response = await app.request("http://localhost/rpc/dashboard/today", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ json: { orgSlug: "x".repeat(1_100_000) } }),
    });

    expect(response.status).toBe(413);
    expect(getSession).toHaveBeenCalledTimes(0);
  } finally {
    getSession.mockRestore();
  }
});

test("procedure calls sharing one request share one membership join", async () => {
  const owner = await createTestUser("shared-request");
  const organization = await createOrganization(owner, "shared-request");

  // Session resolution also queries through `db`, and the shared-context run
  // resolves it once instead of twice. Pin it to the real session so the only
  // difference left between the two runs is the membership join.
  const session = await auth.api.getSession({ headers: owner.headers });
  const getSession = spyOn(auth.api, "getSession").mockResolvedValue(session);
  const select = spyOn(db, "select");

  try {
    // `settings.get` reads and never writes, so both runs issue the same
    // handler queries and the difference is attributable to the guard alone.
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

    // A delta, never an absolute count: unrelated handler queries appear in
    // both runs and cancel out.
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

  // A new client means a new context: nothing the previous request proved may
  // survive into this one.
  await expectORPCCode(
    clientFor(owner).settings.get({ orgSlug: organization.slug }),
    "FORBIDDEN",
    "a call after the member row is deleted",
  );
});
