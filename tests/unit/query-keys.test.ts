import { expect, test } from "bun:test";

test("organization input partitions generated query keys", async () => {
  const previousSkip = process.env.SKIP_ENV_VALIDATION;
  process.env.SKIP_ENV_VALIDATION = "true";
  const { orpc } = await import("../../apps/web/src/lib/orpc");
  if (previousSkip === undefined) {
    delete process.env.SKIP_ENV_VALIDATION;
  } else {
    process.env.SKIP_ENV_VALIDATION = previousSkip;
  }

  const alpha = orpc.settings.get.queryKey({ input: { orgSlug: "alpha" } });
  const beta = orpc.settings.get.queryKey({ input: { orgSlug: "beta" } });

  expect(alpha).not.toEqual(beta);
  // A builder that dropped input entirely would still satisfy the inequality above.
  expect(JSON.stringify(alpha)).toContain("alpha");
  expect(JSON.stringify(beta)).toContain("beta");
});
