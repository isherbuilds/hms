import { expect, test } from "bun:test";

import { organizationSlugIssue } from "@hms/auth/organization-slug";

test("organization slugs require at least four URL-safe characters", () => {
  expect(organizationSlugIssue("abc")).not.toBeNull();
  expect(organizationSlugIssue("abcd")).toBeNull();
  expect(organizationSlugIssue("1234")).toBeNull();
  expect(organizationSlugIssue("mercy-general")).toBeNull();
  expect(organizationSlugIssue("Mercy General")).not.toBeNull();
});

test("public and system root routes are reserved case-insensitively", () => {
  for (const slug of [
    "create",
    "DOCS",
    "blog",
    "pricing",
    "security",
    "developers",
    "support",
    "org",
    "workspace",
    "patients",
    "records",
    "reports",
    "files",
    "emergency",
    "faq",
  ]) {
    expect(organizationSlugIssue(slug)).not.toBeNull();
  }
});
