import type { EditablePatient } from "@/components/patient-form";
import { createContext, useContext } from "react";

// One live record observer in the layout keeps the header and child routes in sync after edits.
export const PatientRecordContext = createContext<EditablePatient | null>(null);

export function usePatientRecord() {
  const record = useContext(PatientRecordContext);

  if (!record) throw new Error("usePatientRecord requires the patient layout");

  return record;
}
