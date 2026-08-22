/**
 * A patient row carries either a recorded `ageYears` (what the desk captures
 * when nobody knows the date) or a `dateOfBirth`, never reliably both. Every
 * screen that shows an age has to resolve that pair the same way, so the
 * arithmetic lives here and each call site owns only its own wording.
 */
export function patientAgeYears(
  dateOfBirth: string | null,
  ageYears: number | null,
  today: string,
): number | null {
  if (ageYears !== null) return ageYears;
  if (!dateOfBirth) return null;

  return (
    Number(today.slice(0, 4)) -
    Number(dateOfBirth.slice(0, 4)) -
    (today.slice(5) < dateOfBirth.slice(5) ? 1 : 0)
  );
}
