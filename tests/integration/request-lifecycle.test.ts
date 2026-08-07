import { beforeAll, expect, spyOn, test } from "bun:test";

import { app } from "../../apps/server/src/index";
import { auth } from "@better-stack/auth";

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

    const rpcResponse = await app.request("http://localhost/rpc/dashboard/summary", {
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
