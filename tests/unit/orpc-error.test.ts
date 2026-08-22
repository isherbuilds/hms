import { expect, test } from "bun:test";

import { hasErrorCode, routeErrorMessage } from "../../apps/web/src/lib/orpc-error";

test("nested oRPC codes remain machine-readable for route decisions", () => {
  expect(hasErrorCode({ cause: { code: "UNAUTHORIZED" } }, "UNAUTHORIZED")).toBe(true);
  expect(hasErrorCode({ code: "FORBIDDEN" }, "FORBIDDEN")).toBe(true);
  expect(hasErrorCode(new Error("database unavailable"), "INTERNAL_SERVER_ERROR")).toBe(false);
});

test("production route errors never expose internal exception messages", () => {
  const internal = new Error('relation "member" does not exist');

  expect(routeErrorMessage(internal, false)).toBe("An unexpected error interrupted the request.");
  expect(routeErrorMessage(internal, true)).toBe(internal.message);
  expect(routeErrorMessage("not an error", true)).toBe(
    "An unexpected error interrupted the request.",
  );
});
