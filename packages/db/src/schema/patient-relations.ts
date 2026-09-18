// Shared with the client through API schemas; keep this module dependency-free.
export const GUARDIAN_RELATIONS = ["S/o", "D/o", "W/o", "H/o", "C/o"] as const;

export type GuardianRelation = (typeof GUARDIAN_RELATIONS)[number];

export const EMERGENCY_CONTACT_RELATIONS = [
  "parent",
  "spouse",
  "child",
  "sibling",
  "relative",
  "friend",
  "other",
] as const;

export type EmergencyContactRelation = (typeof EMERGENCY_CONTACT_RELATIONS)[number];

/** Keep the relation outside name casing, including for incomplete stored rows. */
export function guardianLabel(patient: {
  guardianRelation: string | null;
  guardianName: string | null;
}) {
  return patient.guardianRelation && patient.guardianName
    ? { relation: patient.guardianRelation, name: patient.guardianName }
    : null;
}
