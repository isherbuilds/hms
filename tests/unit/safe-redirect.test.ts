import { expect, test } from "bun:test";

import { safeRedirect } from "../../apps/web/src/lib/safe-redirect";

test("safeRedirect keeps same-app paths and rejects foreign origins and login loops", () => {
  expect(safeRedirect(" /acme/files?name=report..pdf#details ")).toBe(
    "/acme/files?name=report..pdf#details",
  );
  expect(safeRedirect("/join?invitation=abc", "/fallback")).toBe("/join?invitation=abc");
  expect(safeRedirect("https://evil.example", "/fallback")).toBe("/fallback");
  expect(safeRedirect("//evil.example", "/fallback")).toBe("/fallback");
  expect(safeRedirect("/\\evil.example", "/fallback")).toBe("/fallback");
  expect(safeRedirect("/login", "/fallback")).toBe("/fallback");
  expect(safeRedirect("/login/reset", "/fallback")).toBe("/fallback");
  expect(safeRedirect("/LOGIN?redirect=%2Facme", "/fallback")).toBe("/fallback");
  // An encoded "?" hides the chain inside the pathname itself.
  expect(
    safeRedirect("/login%3Fredirect%3D%252Flogin%253Fredirect%253D%25252Forg", "/fallback"),
  ).toBe("/fallback");
});
