import { expect, test } from "bun:test";

import { createQueryClient } from "../../apps/web/src/lib/query-client";

// Procedure inputs sit inside query keys; money inputs are bigint.
test("query keys carrying bigint hash instead of throwing", () => {
  const hash = createQueryClient().getDefaultOptions().queries?.queryKeyHashFn;
  expect(hash?.(["opd", { input: { discountAmount: 12_34n } }])).toContain('"1234n"');
});
