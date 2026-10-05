import { expect, test } from "bun:test";

import { OPERATIONAL_REFETCH } from "../../apps/web/src/lib/operational-query";

// A shared placeholder would bridge results across appointmentId/orgSlug
// changes, exposing the prior record under the new route.
test("operational queries never carry a placeholder across routes", () => {
  expect(OPERATIONAL_REFETCH).not.toHaveProperty("placeholderData");
});
