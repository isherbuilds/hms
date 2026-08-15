import { expect, test } from "bun:test";

import { reportToday } from "../../apps/web/src/lib/report-presentation";

test("report dates follow the organization's accounting day", () => {
  const zone = "Asia/Kolkata";
  expect(reportToday(zone, new Date("2026-08-08T18:29:59.000Z"))).toBe("2026-08-08");
  expect(reportToday(zone, new Date("2026-08-08T18:30:00.000Z"))).toBe("2026-08-09");
  expect(reportToday("UTC", new Date("2026-08-08T18:30:00.000Z"))).toBe("2026-08-08");
});
