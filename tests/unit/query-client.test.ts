import { expect, test } from "bun:test";

import { createQueryClient } from "../../apps/web/src/lib/query-client";

const reactQueryPath = Bun.resolveSync(
  "@tanstack/react-query",
  new URL("../../apps/web", import.meta.url).pathname,
);

const { environmentManager } = await import(reactQueryPath);

test("query retries are disabled during SSR and for auth failures", async () => {
  const wasServer = environmentManager.isServer();

  try {
    environmentManager.setIsServer(() => true);
    const serverClient = createQueryClient();
    let serverAttempts = 0;

    await expect(
      serverClient.query({
        queryKey: ["server-retry"],
        retryDelay: 0,
        queryFn: () => {
          serverAttempts += 1;
          throw new Error("server unavailable");
        },
      }),
    ).rejects.toThrow("server unavailable");
    expect(serverAttempts).toBe(1);

    environmentManager.setIsServer(() => false);
    const browserClient = createQueryClient();
    let authAttempts = 0;

    await expect(
      browserClient.query({
        queryKey: ["auth-retry"],
        retryDelay: 0,
        queryFn: () => {
          authAttempts += 1;
          throw Object.assign(new Error("forbidden"), { status: 403 });
        },
      }),
    ).rejects.toThrow("forbidden");
    expect(authAttempts).toBe(1);

    let transientAttempts = 0;

    await expect(
      browserClient.query({
        queryKey: ["transient-retry"],
        retryDelay: 0,
        queryFn: () => {
          transientAttempts += 1;
          throw new Error("temporarily unavailable");
        },
      }),
    ).rejects.toThrow("temporarily unavailable");
    expect(transientAttempts).toBe(3);
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

test("every settled write ages cached queries before its own callbacks, even when writes overlap", async () => {
  const client = createQueryClient();
  const key = ["account"];

  const run = (mutationFn: () => Promise<string>, seen: boolean[]) => {
    client.setQueryData(key, "fresh");

    const record = () => seen.push(client.getQueryState(key)?.isInvalidated ?? false);

    return client
      .getMutationCache()
      .build(client, { mutationFn, onSuccess: record, onError: record })
      .execute(undefined);
  };

  const seen: boolean[] = [];
  let release = () => {};

  const slow = run(() => new Promise<string>((resolve) => (release = () => resolve("slow"))), seen);

  await run(() => Promise.resolve("fast"), seen);
  client.setQueryData(key, "fresh");
  release();
  await slow;
  await expect(run(() => Promise.reject(new Error("refused")), seen)).rejects.toThrow("refused");

  expect(seen).toEqual([true, true, true]);
});
