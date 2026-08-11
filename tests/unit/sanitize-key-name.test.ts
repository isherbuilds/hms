import { expect, test } from "bun:test";

import { sanitizeKeyName } from "@hms/api/routers/files";

test("a sanitized name can never nest, traverse, or break a URL", () => {
  for (const name of [
    "../../etc/passwd",
    "a/b/c.txt",
    "..",
    "....",
    "%2e%2e/secret",
    "report#1?x=1.pdf",
    "  spaced name .txt  ",
  ]) {
    const key = sanitizeKeyName(name);
    expect(key).not.toContain("/");
    expect(key).not.toContain("..");
    expect(key).not.toMatch(/[%#?]/);
    expect(key.length).toBeGreaterThan(0);
    expect(key.length).toBeLessThanOrEqual(255);
  }
});

test("an all-punctuation name still yields a usable segment", () => {
  expect(sanitizeKeyName("...")).toBe("file");
  expect(sanitizeKeyName("   ")).toBe("file");
});

test("an ordinary name survives intact", () => {
  expect(sanitizeKeyName("Q3-report_final.pdf")).toBe("Q3-report_final.pdf");
});
