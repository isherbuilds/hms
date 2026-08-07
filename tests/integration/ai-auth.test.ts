import { beforeAll, expect, test } from "bun:test";

import { app } from "../../apps/server/src/index";
import {
  createOrganization,
  createTestUser,
  joinOrganization,
  removeFromOrganization,
} from "../support/auth";
import { resetTestDatabase } from "../support/database";

beforeAll(async () => {
  await resetTestDatabase();
});

async function requestAi(orgSlug: string | undefined, cookie?: string): Promise<Response> {
  return await app.request("http://localhost/ai", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ ...(orgSlug === undefined ? {} : { orgSlug }), messages: [] }),
  });
}

test("AI rejects unauthenticated, unclaimed, foreign, and removed members before model execution", async () => {
  const owner = await createTestUser("ai-owner");
  const organization = await createOrganization(owner, "ai-auth");

  expect((await requestAi(organization.slug)).status).toBe(401);

  // /ai hand-rolls the guard the oRPC procedures get from `orgInput`, so the
  // missing claim is asserted here too: a body with no org must never reach
  // authorizeOrg, let alone the model.
  expect((await requestAi(undefined, owner.cookie)).status).toBe(400);

  const visitor = await createTestUser("ai-visitor");
  expect((await requestAi(organization.slug, visitor.cookie)).status).toBe(403);

  const removed = await createTestUser("ai-removed");
  await joinOrganization(removed, organization.id);
  await removeFromOrganization(owner, removed.user.email, organization.id);
  expect((await requestAi(organization.slug, removed.cookie)).status).toBe(403);
});

// Without this, a guard demanding a permission no role holds would still make
// every assertion above pass.
test("AI lets a member through the guard", async () => {
  const owner = await createTestUser("ai-allowed");
  const organization = await createOrganization(owner, "ai-allowed");

  const status = (await requestAi(organization.slug, owner.cookie)).status;
  expect([401, 403]).not.toContain(status);
});
