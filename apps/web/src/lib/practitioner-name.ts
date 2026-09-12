// Practitioners are stored by bare name; screens and exports add the title.
// Names saved before this rule may already carry it, so it is never doubled.
export function practitionerDisplayName(name: string) {
  return /^dr\b\.?/i.test(name) ? name : `Dr. ${name}`;
}
