import { expect, test } from "bun:test";

import { reportToday } from "../../apps/web/src/lib/report-presentation";

test("report dates follow the Asia/Kolkata accounting day", () => {
  expect(reportToday(new Date("2026-08-08T18:29:59.000Z"))).toBe("2026-08-08");
  expect(reportToday(new Date("2026-08-08T18:30:00.000Z"))).toBe("2026-08-09");
});
