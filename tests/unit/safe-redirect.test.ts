import { expect, test } from "bun:test";

import { safeRedirect } from "../../apps/web/src/lib/safe-redirect";

test("safeRedirect keeps same-app paths and rejects foreign origins", () => {
  expect(safeRedirect(" /org/acme/files?name=report..pdf#details ")).toBe(
    "/org/acme/files?name=report..pdf#details",
  );
  expect(safeRedirect("https://evil.example", "/fallback")).toBe("/fallback");
  expect(safeRedirect("//evil.example", "/fallback")).toBe("/fallback");
  expect(safeRedirect("/\\evil.example", "/fallback")).toBe("/fallback");
});

test("safeRedirect only honours real post-login destinations", () => {
  expect(safeRedirect("/onboarding?invitation=abc", "/fallback")).toBe(
    "/onboarding?invitation=abc",
  );
  // /login targets would bounce forever, nesting one encoding layer per hop.
  expect(safeRedirect("/login", "/fallback")).toBe("/fallback");
  expect(safeRedirect("/login?redirect=%2Flogin%3Fredirect%3D%252Forg%252Facme", "/fallback")).toBe(
    "/fallback",
  );
  // An encoded "?" hides the chain inside the pathname itself.
  expect(
    safeRedirect("/login%3Fredirect%3D%252Flogin%253Fredirect%253D%25252Forg", "/fallback"),
  ).toBe("/fallback");
  expect(safeRedirect("/random-page", "/fallback")).toBe("/fallback");
});
