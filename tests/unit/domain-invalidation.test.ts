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
  await invalidateOpdAppointmentState(client, "org-a", "appointment-1", "create");

  const emitted = serialize(keys);
  expect(emitted.length).toBeGreaterThan(0);
  for (const key of emitted) expect(key).toContain('"orgSlug":"org-a"');
  expect(emitted.some((key) => key.includes('"appointmentId":"appointment-1"'))).toBe(true);
  expect(emitted.some((key) => key.includes('"collections"'))).toBe(true);
});

test("a reschedule leaves financial caches alone", async () => {
  const { client, keys } = recordingInvalidator();
  await invalidateOpdAppointmentState(client, "org-a", "appointment-1", "reschedule");

  const emitted = serialize(keys);
  expect(emitted.length).toBeGreaterThan(0);
  expect(emitted.some((key) => key.includes('"collections"'))).toBe(false);
  expect(emitted.some((key) => key.includes('"worklist"'))).toBe(false);
  expect(emitted.some((key) => key.includes('"listPendingCharges"'))).toBe(false);
});

test("charge-changing appointment transitions invalidate pending charges", async () => {
  for (const transition of ["billing", "checkIn", "cancel", "noShow"] as const) {
    const { client, keys } = recordingInvalidator();
    await invalidateOpdAppointmentState(client, "org-a", "appointment-1", transition);

    const pendingCharges = serialize(keys).filter((key) => key.includes('"listPendingCharges"'));
    expect(pendingCharges).toHaveLength(1);
    expect(pendingCharges[0]).toContain('"orgSlug":"org-a"');
    expect(pendingCharges[0]).toContain('"appointmentId":"appointment-1"');
  }
});

test("check-in refreshes collections when booked charges become billable", async () => {
  const { client, keys } = recordingInvalidator();
  await invalidateOpdAppointmentState(client, "org-a", "appointment-1", "checkIn");

  expect(serialize(keys).filter((key) => key.includes('"collections"'))).toHaveLength(1);
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
