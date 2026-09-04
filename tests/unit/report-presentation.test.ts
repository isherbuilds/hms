import { expect, test } from "bun:test";

import { validateReportPeriod } from "../../apps/web/src/lib/report-presentation";

test("report period drafts reject incomplete and reversed ranges", () => {
  expect(validateReportPeriod("", "2026-08-21")).toBe("Choose both dates");
  expect(validateReportPeriod("2026-08-22", "2026-08-21")).toBe("From must be on or before To");
  expect(validateReportPeriod("2026-08-21", "2026-08-21")).toBeNull();
});

test("report period drafts enforce an optional maximum span", () => {
  expect(validateReportPeriod("2025-08-20", "2026-08-20", 366)).toBeNull();
  expect(validateReportPeriod("2025-08-19", "2026-08-20", 366)).toBe(
    "Choose a range of 366 days or less",
  );
});
