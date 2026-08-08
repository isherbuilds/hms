/**
 * A patient row carries either a recorded `ageYears` (what the desk captures
 * when nobody knows the date) or a `dateOfBirth`, never reliably both. Every
 * screen that shows an age has to resolve that pair the same way, so the
 * arithmetic lives here and each call site owns only its own wording.
 */
export function patientAgeYears(
  dateOfBirth: string | null,
  ageYears: number | null,
): number | null {
  if (ageYears !== null) return ageYears;
  if (!dateOfBirth) return null;

  const today = new Date();
  // Parsed at local midnight: a bare `new Date("2001-04-09")` is UTC, which
  // rolls the birthday back a day for anyone west of Greenwich.
  const birthDate = new Date(`${dateOfBirth}T00:00:00`);
  let age = today.getFullYear() - birthDate.getFullYear();
  if (
    today.getMonth() < birthDate.getMonth() ||
    (today.getMonth() === birthDate.getMonth() && today.getDate() < birthDate.getDate())
  ) {
    age -= 1;
  }
  return age;
}
