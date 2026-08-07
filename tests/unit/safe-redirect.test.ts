import { expect, test } from "bun:test";

import { safeRedirect } from "../../apps/web/src/utils/safe-redirect";

test("safeRedirect keeps same-app paths and rejects foreign origins", () => {
  expect(safeRedirect(" /org/acme/files?name=report..pdf#details ")).toBe(
    "/org/acme/files?name=report..pdf#details",
  );
  expect(safeRedirect("https://evil.example", "/fallback")).toBe("/fallback");
  expect(safeRedirect("//evil.example", "/fallback")).toBe("/fallback");
  expect(safeRedirect("/\\evil.example", "/fallback")).toBe("/fallback");
});
