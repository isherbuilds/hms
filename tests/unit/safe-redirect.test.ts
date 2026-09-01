import { expect, test } from "bun:test";

import { safeRedirect } from "../../apps/web/src/lib/safe-redirect";

test("safeRedirect keeps same-app paths and rejects foreign origins", () => {
  expect(safeRedirect(" /acme/files?name=report..pdf#details ")).toBe(
    "/acme/files?name=report..pdf#details",
  );
  expect(safeRedirect("https://evil.example", "/fallback")).toBe("/fallback");
  expect(safeRedirect("//evil.example", "/fallback")).toBe("/fallback");
  expect(safeRedirect("/\\evil.example", "/fallback")).toBe("/fallback");
});

test("safeRedirect preserves same-app destinations without allowing login loops", () => {
  expect(safeRedirect("/join?invitation=abc", "/fallback")).toBe("/join?invitation=abc");
  expect(safeRedirect("/create", "/fallback")).toBe("/create");
  expect(safeRedirect("/acme", "/fallback")).toBe("/acme");
  expect(safeRedirect("/acme/onboarding", "/fallback")).toBe("/acme/onboarding");
  expect(safeRedirect("/login", "/fallback")).toBe("/fallback");
  expect(safeRedirect("/login/reset", "/fallback")).toBe("/fallback");
  expect(safeRedirect("/LOGIN?redirect=%2Facme", "/fallback")).toBe("/fallback");
  expect(safeRedirect("/login?redirect=%2Flogin%3Fredirect%3D%252Facme", "/fallback")).toBe(
    "/fallback",
  );
  // An encoded "?" hides the chain inside the pathname itself.
  expect(
    safeRedirect("/login%3Fredirect%3D%252Flogin%253Fredirect%253D%25252Forg", "/fallback"),
  ).toBe("/fallback");
  expect(safeRedirect("/random-page", "/fallback")).toBe("/random-page");
});
