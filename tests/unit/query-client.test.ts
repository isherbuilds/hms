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
