import { expect, test } from "bun:test";

import { formatBusinessDate, orgToday } from "../../apps/web/src/lib/org-datetime";

test("organization dates follow the organization's accounting day", () => {
  const zone = "Asia/Kolkata";
  expect(orgToday(zone, new Date("2026-08-08T18:29:59.000Z"))).toBe("2026-08-08");
  expect(orgToday(zone, new Date("2026-08-08T18:30:00.000Z"))).toBe("2026-08-09");
  expect(orgToday("UTC", new Date("2026-08-08T18:30:00.000Z"))).toBe("2026-08-08");
});

test("business dates render with the year and cannot shift across time zones", () => {
  expect(formatBusinessDate("2026-08-08")).toBe("8 Aug 2026");
});
