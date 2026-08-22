import { createRequestContext } from "@hms/api/lib/context";
import { appRouter, type AppRouterClient } from "@hms/api/routers/index";
import { createRouterClient } from "@orpc/server";
import { expect } from "bun:test";

import type { TestUser } from "./auth";

/**
 * One context per call, exactly like one HTTP request per call: each call
 * resolves its own session and gets its own membership map, so nothing an
 * earlier call proved carries over. Use this to test anything that must be
 * re-proven per request, such as revocation.
 */
export function clientFor(identity: TestUser): AppRouterClient {
  const headers = new Headers({ cookie: identity.cookie });
  return createRouterClient(appRouter, {
    context: () => createRequestContext(headers),
  });
}

/**
 * One context for every call, modelling the server-rendered page that fans out
 * into several procedure calls inside a single request. The shared context is
 * what lets those calls reuse one membership join; the permission check still
 * runs per call.
 */
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
