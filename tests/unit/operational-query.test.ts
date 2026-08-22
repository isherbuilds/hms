import { expect, test } from "bun:test";

import { OPERATIONAL_REFETCH } from "../../apps/web/src/lib/operational-query";
import { isConflictError } from "../../apps/web/src/lib/orpc-error";

test("operational queries poll frequently while remaining focus-aware", () => {
  expect(OPERATIONAL_REFETCH.refetchInterval).toBeGreaterThanOrEqual(9_000);
  expect(OPERATIONAL_REFETCH.refetchInterval).toBeLessThanOrEqual(11_000);
  expect(OPERATIONAL_REFETCH.staleTime).toBeLessThan(60_000);
  expect(OPERATIONAL_REFETCH.refetchOnWindowFocus).toBe(true);
  // Same-key refetches retain their current result without placeholder data.
  // A shared placeholder would instead bridge results when appointmentId/orgSlug
  // changes, which can expose the prior record under the new route.
  expect(OPERATIONAL_REFETCH).not.toHaveProperty("placeholderData");
});

test("conflict recognition follows wrapped oRPC causes", () => {
  expect(isConflictError({ cause: { code: "CONFLICT" } })).toBe(true);
  expect(isConflictError({ code: "BAD_REQUEST" })).toBe(false);
});
