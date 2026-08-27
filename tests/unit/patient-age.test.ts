import { expect, test } from "bun:test";

import {
  ageYearsToEstimatedDateOfBirth,
  patientAgeLabel,
  patientAgeYears,
} from "../../apps/web/src/lib/patient-age";

test("age entry subtracts whole calendar years from the organization-local date", () => {
  expect(ageYearsToEstimatedDateOfBirth(34, "2026-08-27")).toBe("1992-08-27");
});

test("zero age keeps the organization-local date", () => {
  expect(ageYearsToEstimatedDateOfBirth(0, "2026-08-27")).toBe("2026-08-27");
});

test("February 29 clamps to February 28 in a non-leap birth year", () => {
  expect(ageYearsToEstimatedDateOfBirth(1, "2024-02-29")).toBe("2023-02-28");
  expect(ageYearsToEstimatedDateOfBirth(4, "2024-02-29")).toBe("2020-02-29");
});

test("calendar age and estimate labels use date strings without timezone conversion", () => {
  expect(patientAgeYears("1992-08-28", "2026-08-27")).toBe(33);
  expect(patientAgeYears("1992-08-27", "2026-08-27")).toBe(34);
  expect(patientAgeLabel("1992-08-27", false, "2026-08-27")).toBe("34");
  expect(patientAgeLabel("1992-08-27", true, "2026-08-27")).toBe("~34");
});
