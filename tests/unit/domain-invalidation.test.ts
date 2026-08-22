import { expect, test } from "bun:test";

type QueryKey = readonly unknown[];

const previousSkip = process.env.SKIP_ENV_VALIDATION;
process.env.SKIP_ENV_VALIDATION = "true";
const { invalidateBillingState, invalidateOpdAppointmentState } =
  await import("../../apps/web/src/lib/domain-invalidation");
if (previousSkip === undefined) {
  delete process.env.SKIP_ENV_VALIDATION;
} else {
  process.env.SKIP_ENV_VALIDATION = previousSkip;
}

function recordingInvalidator() {
  const keys: QueryKey[] = [];
  return {
    keys,
    client: {
      invalidateQueries: async ({ queryKey }: { queryKey: QueryKey }) => {
        keys.push(queryKey);
      },
    },
  };
}

function serialize(keys: QueryKey[]): string[] {
  return keys.map((key) => JSON.stringify(key));
}

test("appointment invalidation scopes every key to the given org", async () => {
  const { client, keys } = recordingInvalidator();
  await invalidateOpdAppointmentState(client, "org-a", "appointment-1");

  const emitted = serialize(keys);
  expect(emitted.length).toBeGreaterThan(0);
  for (const key of emitted) expect(key).toContain('"orgSlug":"org-a"');
  expect(emitted.some((key) => key.includes('"appointmentId":"appointment-1"'))).toBe(true);
});

test("billing invalidation scopes every key to the given org", async () => {
  const { client, keys } = recordingInvalidator();
  await invalidateBillingState(client, "org-a", "appointment-1", "invoice-1");

  const emitted = serialize(keys);
  expect(emitted.length).toBeGreaterThan(0);
  for (const key of emitted) expect(key).toContain('"orgSlug":"org-a"');
  expect(emitted.some((key) => key.includes('"appointmentId":"appointment-1"'))).toBe(true);
  expect(emitted.some((key) => key.includes('"invoiceId":"invoice-1"'))).toBe(true);
});
