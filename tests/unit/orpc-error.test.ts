import { expect, test } from "bun:test";

import { hasErrorCode, routeErrorMessage } from "../../apps/web/src/lib/orpc-error";

test("nested oRPC codes remain machine-readable for route decisions", () => {
  expect(hasErrorCode({ cause: { code: "UNAUTHORIZED" } }, "UNAUTHORIZED")).toBe(true);
});

test("production route errors never expose internal exception messages", () => {
  const internal = new Error('relation "member" does not exist');
  const generic = routeErrorMessage("not an error", true);

  expect(generic).not.toContain("member");
  expect(routeErrorMessage(internal, false)).toBe(generic);
  expect(routeErrorMessage(internal, true)).toBe(internal.message);
});
