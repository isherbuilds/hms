import { expect, test } from "bun:test";

import {
  ageYearsToEstimatedDateOfBirth,
  patientAgeYears,
} from "../../apps/web/src/lib/patient-age";

test("an entered age becomes a date of birth that reads back as the same age", () => {
  expect(ageYearsToEstimatedDateOfBirth(34, "2026-08-27")).toBe("1992-08-27");
  expect(patientAgeYears("1992-08-28", "2026-08-27")).toBe(33);
});
