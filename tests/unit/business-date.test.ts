import { expect, test } from "bun:test";

import { businessDate, businessDateAnchor, localDateTime } from "@hms/api/lib/business-date";
import { fiscalYearLabel } from "@hms/api/lib/invoice-math";

test("changes the Kolkata business date at local midnight", () => {
  expect(businessDate(new Date("2026-08-08T18:29:59Z"), "Asia/Kolkata")).toBe("2026-08-08");
  expect(businessDate(new Date("2026-08-08T18:30:00Z"), "Asia/Kolkata")).toBe("2026-08-09");
});

test("anchors fiscal-year selection to the organization's business date", () => {
  const instant = new Date("2026-03-31T19:00:00Z");

  expect(fiscalYearLabel(businessDateAnchor(instant, "Asia/Kolkata"), 4)).toBe("2026-27");
  expect(fiscalYearLabel(businessDateAnchor(instant, "UTC"), 4)).toBe("2025-26");
});

test("converts a hospital wall-clock value without using the caller timezone", () => {
  expect(localDateTime("2026-08-22T10:30", "Asia/Kolkata").toISOString()).toBe(
    "2026-08-22T05:00:00.000Z",
  );
});

test("rejects an invalid time zone in every business-date helper", () => {
  const instant = new Date("2026-08-08T00:00:00Z");

  expect(() => businessDate(instant, "Asia/Nowhere")).toThrow();
  expect(() => businessDateAnchor(instant, "Asia/Nowhere")).toThrow();
});
