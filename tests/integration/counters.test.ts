import { beforeAll, expect, test } from "bun:test";

import { db } from "@hms/db";
import { nextCounter } from "@hms/db/counter";

import { createOrganization, createTestUser } from "../support/auth";
import { resetTestDatabase } from "../support/database";

beforeAll(async () => {
  await resetTestDatabase();
});

test("parallel increments yield a gapless, unique sequence", async () => {
  const owner = await createTestUser("counter");
  const organization = await createOrganization(owner, "counter");

  // Concurrency is the point: every transaction races the same row, and the
  // upsert's row lock must serialize them into exactly 1..N with no repeats.
  const values = await Promise.all(
    Array.from({ length: 25 }, () =>
      db.transaction((tx) => nextCounter(tx, organization.id, "mrn")),
    ),
  );

  expect([...values].sort((a, b) => a - b)).toEqual(
    Array.from({ length: 25 }, (_, index) => index + 1),
  );
});

test("series are independent per key and per organization", async () => {
  const owner = await createTestUser("counter-keys");
  const one = await createOrganization(owner, "counter-one");
  const two = await createOrganization(owner, "counter-two");

  await db.transaction(async (tx) => {
    expect(await nextCounter(tx, one.id, "invoice:2026-27")).toBe(1);
    expect(await nextCounter(tx, one.id, "invoice:2026-27")).toBe(2);
    // A different key in the same org starts its own series.
    expect(await nextCounter(tx, one.id, "receipt:2026-27")).toBe(1);
  });

  // The same key in another org starts its own series.
  const other = await db.transaction((tx) => nextCounter(tx, two.id, "invoice:2026-27"));
  expect(other).toBe(1);
});

test("a rolled-back transaction returns its number to the series", async () => {
  const owner = await createTestUser("counter-rollback");
  const organization = await createOrganization(owner, "counter-rollback");

  await db.transaction((tx) => nextCounter(tx, organization.id, "mrn"));

  await expect(
    db.transaction(async (tx) => {
      await nextCounter(tx, organization.id, "mrn");
      throw new Error("abort after increment");
    }),
  ).rejects.toThrow("abort after increment");

  // The aborted increment left no gap: the next committed number is 2.
  const next = await db.transaction((tx) => nextCounter(tx, organization.id, "mrn"));
  expect(next).toBe(2);
});
