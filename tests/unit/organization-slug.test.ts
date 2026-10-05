import { expect, test } from "bun:test";

import { organizationSlugIssue } from "@hms/auth/organization-slug";

test("organization slugs cannot take a public or system root route", () => {
  expect(organizationSlugIssue("mercy-general")).toBeNull();
  expect(organizationSlugIssue("DOCS")).not.toBeNull();
});
