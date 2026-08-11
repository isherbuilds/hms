import { appRouter, type AppRouterClient } from "@hms/api/routers/index";
import { auth } from "@hms/auth";
import { createRouterClient } from "@orpc/server";
import { expect } from "bun:test";

import type { TestUser } from "./auth";

export function clientFor(identity: TestUser): AppRouterClient {
  const headers = new Headers({ cookie: identity.cookie });
  return createRouterClient(appRouter, {
    context: async () => ({
      headers,
      session: await auth.api.getSession({ headers }),
    }),
  });
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

/**
 * Better Auth throws `APIError`, which carries the same kind of machine-readable
 * status oRPC does. Assert that rather than the message, so rewording a string
 * in `packages/auth` never breaks a test.
 */
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

/** Polls a probe until it returns a value — for fire-and-forget writes. */
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
