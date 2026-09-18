function parseDate(value: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) throw new RangeError(`Invalid calendar date: ${value}`);

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function ageYearsToEstimatedDateOfBirth(ageYears: number, orgToday: string): string {
  if (!Number.isInteger(ageYears) || ageYears < 0) {
    throw new RangeError("Age must be a non-negative whole number");
  }

  const today = parseDate(orgToday);
  const year = today.year - ageYears;
  const day = today.month === 2 && today.day === 29 && !isLeapYear(year) ? 28 : today.day;

  return `${String(year).padStart(4, "0")}-${String(today.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function patientAgeYears(dateOfBirth: string, orgToday: string): number {
  const birth = parseDate(dateOfBirth);
  const today = parseDate(orgToday);

  const birthdayPassed =
    today.month > birth.month || (today.month === birth.month && today.day >= birth.day);

  return today.year - birth.year - (birthdayPassed ? 0 : 1);
}

export function patientAgeLabel(
  dateOfBirth: string,
  dobEstimated: boolean,
  orgToday: string,
): string {
  const age = patientAgeYears(dateOfBirth, orgToday);

  return dobEstimated ? `~${age}` : String(age);
}
