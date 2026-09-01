import { createRequestContext } from "@hms/api/lib/context";
import { appRouter, type AppRouterClient } from "@hms/api/routers/index";
import { createRouterClient } from "@orpc/server";
import { expect } from "bun:test";

import type { TestUser } from "./auth";

// One context per call, like one HTTP request per call. Use for anything that
// must be re-proven per request, such as revocation.
export function clientFor(identity: TestUser): AppRouterClient {
  const headers = new Headers({ cookie: identity.cookie });
  return createRouterClient(appRouter, {
    context: () => createRequestContext(headers),
  });
}

// One context for every call, like a server-rendered page fanning out. The
// permission check still runs per call.
export function requestScopedClientFor(identity: TestUser): AppRouterClient {
  const headers = new Headers({ cookie: identity.cookie });
  const context = createRequestContext(headers);
  return createRouterClient(appRouter, { context: () => context });
}

async function rejection(promise: Promise<unknown>, what: string): Promise<unknown> {
  let error: unknown;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  expect(error, `expected ${what} to reject`).toBeDefined();
  return error;
}

export async function expectORPCCode(
  promise: Promise<unknown>,
  code: string,
  label = "the call",
): Promise<void> {
  const error = await rejection(promise, `${label} with ${code}`);
  expect((error as { code?: string }).code, `${label} should be ${code}`).toBe(code);
}

export async function expectAuthStatus(
  promise: Promise<unknown>,
  status: string,
  bodyCode?: string,
): Promise<void> {
  const error = await rejection(promise, `the Better Auth call with ${status}`);
  expect((error as { status?: string }).status).toBe(status);
  if (bodyCode !== undefined) {
    expect((error as { body?: { code?: string } }).body?.code).toBe(bodyCode);
  }
}

export async function eventually<T>(probe: () => Promise<T | undefined>): Promise<T> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const result = await probe();
    if (result !== undefined) {
      return result;
    }
    await Bun.sleep(20);
  }
  throw new Error("condition not reached within 1s");
}
