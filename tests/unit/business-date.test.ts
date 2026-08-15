import { expect, test } from "bun:test";

import { businessDate, businessDateAnchor, businessDayWindow } from "@hms/api/lib/business-date";
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

test("returns Kolkata midnight instants for a complete business date", () => {
  const window = businessDayWindow("2026-08-08", "Asia/Kolkata");

  expect(window.start.toISOString()).toBe("2026-08-07T18:30:00.000Z");
  expect(window.end.toISOString()).toBe("2026-08-08T18:30:00.000Z");
  expect(businessDate(window.start, "Asia/Kolkata")).toBe("2026-08-08");
  expect(businessDate(new Date(window.end.getTime() - 1), "Asia/Kolkata")).toBe("2026-08-08");
});

test("uses a 23-hour window when New York enters daylight saving time", () => {
  const window = businessDayWindow("2026-03-08", "America/New_York");

  expect(window.start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
  expect(window.end.toISOString()).toBe("2026-03-09T04:00:00.000Z");
  expect(window.end.getTime() - window.start.getTime()).toBe(82_800_000);
  expect(businessDate(window.start, "America/New_York")).toBe("2026-03-08");
  expect(businessDate(new Date(window.end.getTime() - 1), "America/New_York")).toBe("2026-03-08");
});

test("uses a 25-hour window when New York leaves daylight saving time", () => {
  const window = businessDayWindow("2026-11-01", "America/New_York");

  expect(window.start.toISOString()).toBe("2026-11-01T04:00:00.000Z");
  expect(window.end.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  expect(window.end.getTime() - window.start.getTime()).toBe(90_000_000);
  expect(businessDate(window.start, "America/New_York")).toBe("2026-11-01");
  expect(businessDate(new Date(window.end.getTime() - 1), "America/New_York")).toBe("2026-11-01");
});

test("starts at the first instant of the date when daylight saving skips midnight", () => {
  const window = businessDayWindow("2026-03-08", "America/Havana");

  expect(window.start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
  expect(businessDate(window.start, "America/Havana")).toBe("2026-03-08");
  expect(businessDate(new Date(window.start.getTime() - 1), "America/Havana")).toBe("2026-03-07");
});

test("rejects an invalid time zone in every business-date helper", () => {
  const instant = new Date("2026-08-08T00:00:00Z");

  expect(() => businessDate(instant, "Asia/Nowhere")).toThrow();
  expect(() => businessDayWindow("2026-08-08", "Asia/Nowhere")).toThrow();
  expect(() => businessDateAnchor(instant, "Asia/Nowhere")).toThrow();
});
