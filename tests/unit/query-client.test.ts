import { expect, test } from "bun:test";

import { createQueryClient } from "../../apps/web/src/lib/query-client";

const reactQueryPath = Bun.resolveSync(
  "@tanstack/react-query",
  new URL("../../apps/web", import.meta.url).pathname,
);

const { environmentManager } = await import(reactQueryPath);

test("auth failures are not retried", async () => {
  const wasServer = environmentManager.isServer();

  try {
    environmentManager.setIsServer(() => false);
    let attempts = 0;

    await expect(
      createQueryClient().query({
        queryKey: ["auth-retry"],
        retryDelay: 0,
        queryFn: () => {
          attempts += 1;
          throw Object.assign(new Error("forbidden"), { status: 403 });
        },
      }),
    ).rejects.toThrow("forbidden");
    expect(attempts).toBe(1);
  } finally {
    environmentManager.setIsServer(() => wasServer);
  }
});

test("query keys carrying bigint hash instead of throwing", () => {
  const hash = createQueryClient().getDefaultOptions().queries?.queryKeyHashFn;
  const key = (amount: bigint | string) => ["opd", { input: { discountAmount: amount } }];

  expect(hash?.(key(12_34n))).toBe(hash?.(key(12_34n)));
  expect(hash?.(key(12_34n))).not.toBe(hash?.(key("1234")));
});
