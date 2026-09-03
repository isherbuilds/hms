import { expect, test } from "bun:test";

import { OPERATIONAL_REFETCH } from "../../apps/web/src/lib/operational-query";
import { errorReason } from "../../apps/web/src/lib/orpc-error";

test("operational queries poll frequently while remaining focus-aware", () => {
  expect(OPERATIONAL_REFETCH.refetchInterval).toBeGreaterThanOrEqual(9_000);
  expect(OPERATIONAL_REFETCH.refetchInterval).toBeLessThanOrEqual(11_000);
  expect(OPERATIONAL_REFETCH.staleTime).toBeLessThan(60_000);
  expect(OPERATIONAL_REFETCH.refetchOnWindowFocus).toBe(true);
  // A shared placeholder would bridge results across appointmentId/orgSlug
  // changes, exposing the prior record under the new route.
  expect(OPERATIONAL_REFETCH).not.toHaveProperty("placeholderData");
});

test("a conflict reason survives the transport's cause wrapper", () => {
  expect(errorReason({ cause: { data: { reason: "stale_record" } } })).toBe("stale_record");
  expect(errorReason({ code: "BAD_REQUEST" })).toBeUndefined();
});
