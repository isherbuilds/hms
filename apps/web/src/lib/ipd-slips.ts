import { practitionerDisplayName } from "@hms/api/lib/labels";

import { formatDateTime } from "@/lib/org-datetime";
import type { orpc } from "@/lib/orpc";

// The admission and discharge slips as plain facts, so what prints is testable
// without a browser. A fact the stay does not have is left out, never printed blank.

type AdmissionView = Awaited<ReturnType<typeof orpc.ipd.get.call>>["admission"];

export type DischargeType = NonNullable<AdmissionView["dischargeType"]>;

export const DISCHARGE_TYPES = [
  "normal",
  "against_advice",
  "absconded",
  "referred",
  "death",
] as const satisfies readonly DischargeType[];

export const DISCHARGE_TYPE_LABELS = {
  normal: "Normal discharge",
  against_advice: "Left against medical advice",
  absconded: "Absconded",
  referred: "Referred to another hospital",
  death: "Death",
} satisfies Record<DischargeType, string>;

export type SlipKind = "admission" | "discharge";

/** The slip as a PDF, opened in a new tab like every other printed document. */
export function slipPdfUrl(orgSlug: string, admissionId: string, kind: SlipKind): string {
  return `/api/${encodeURIComponent(orgSlug)}/ipd/admissions/${encodeURIComponent(admissionId)}/slip?${new URLSearchParams({ kind })}`;
}

export type SlipInput = {
  admission: Pick<
    AdmissionView,
    | "admissionNumber"
    | "admittedAt"
    | "dischargedAt"
    | "dischargeType"
    | "attendantName"
    | "attendantPhone"
    | "medicoLegal"
    | "medicoLegalRef"
    | "diagnosis"
  >;
  patient: { name: string; mrn: string };
  practitionerName: string;
  bedLabel: string;
  wardName: string;
  timeZone: string;
};

export type Slip = {
  title: string;
  facts: { label: string; value: string }[];
  signatures: string[];
};

// Paper the ward completes before the Patient goes; the summary stays a paper record.
const DISCHARGE_CLEARANCES = ["Discharge summary handed over", "Ward nurse", "Pharmacy", "Billing"];

/** Who the Patient is and where they lie: the facts every paper of a stay names. */
export function stayIdentity({
  admission,
  patient,
  practitionerName,
  bedLabel,
  wardName,
  timeZone,
}: SlipInput) {
  return [
    { label: "Patient", value: patient.name },
    { label: "MRN", value: patient.mrn },
    { label: "Consultant", value: practitionerDisplayName(practitionerName) },
    { label: "Bed", value: `${wardName} · ${bedLabel}` },
    { label: "Admitted", value: formatDateTime(admission.admittedAt, timeZone) },
  ];
}

function stayFacts(input: SlipInput) {
  const { admission } = input;

  const attendant = [admission.attendantName, admission.attendantPhone]
    .filter((part) => part !== null)
    .join(" · ");

  return [
    { label: "IPD No.", value: admission.admissionNumber },
    ...stayIdentity(input),
    { label: "Attendant", value: attendant },
    { label: "Diagnosis", value: admission.diagnosis ?? "" },
    {
      label: "Medico-legal",
      value: admission.medicoLegal ? (admission.medicoLegalRef ?? "Yes") : "",
    },
  ];
}

function present(facts: { label: string; value: string }[]) {
  return facts.filter((fact) => fact.value.trim() !== "");
}

export function admissionSlip(input: SlipInput): Slip {
  return { title: "Admission slip", facts: present(stayFacts(input)), signatures: [] };
}

export function dischargeSlip(input: SlipInput): Slip {
  const { dischargedAt, dischargeType } = input.admission;

  return {
    title: "Discharge slip",
    facts: present([
      ...stayFacts(input),
      {
        label: "Left",
        value: dischargedAt ? formatDateTime(dischargedAt, input.timeZone) : "",
      },
      {
        label: "How the Patient left",
        value: dischargeType ? DISCHARGE_TYPE_LABELS[dischargeType] : "",
      },
    ]),
    signatures: DISCHARGE_CLEARANCES,
  };
}
