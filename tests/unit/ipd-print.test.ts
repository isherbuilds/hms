// Spec: docs/specs/ipd-admission-to-discharge.md — the admission and discharge slips
// print the stay's facts, and the discharge slip carries the paper clearances.
import { expect, test } from "bun:test";

import { depositShortLabel, depositShortfall } from "../../apps/web/src/lib/ipd-deposit";
import { INTERIM_BILL_TITLE } from "../../apps/web/src/lib/ipd-interim-bill";
import {
  DISCHARGE_TYPE_LABELS,
  admissionSlip,
  dischargeSlip,
} from "../../apps/web/src/lib/ipd-slips";

const stay = {
  admission: {
    admissionNumber: "2026-27/41",
    admittedAt: new Date("2026-11-14T05:30:00Z"),
    dischargedAt: null,
    dischargeType: null,
    attendantName: "Meena Kumari",
    attendantPhone: "9876500001",
    medicoLegal: true,
    medicoLegalRef: "PS Sector 17, DD 42/2026",
    diagnosis: "Fracture left femur",
  },
  patient: { name: "Ramesh Kumar", mrn: "MRN-000123" },
  practitionerName: "Dr Anita Rao",
  bedLabel: "G-4",
  wardName: "General",
  timeZone: "Asia/Kolkata",
} as const;

function fact(slip: { facts: { label: string; value: string }[] }, label: string) {
  return slip.facts.find((candidate) => candidate.label === label)?.value;
}

test("the admission slip prints the stay's facts under the IPD number", () => {
  const slip = admissionSlip(stay);

  expect(slip.title).toBe("Admission slip");
  expect(fact(slip, "IPD No.")).toBe("2026-27/41");
  expect(fact(slip, "Patient")).toContain("Ramesh Kumar");
  expect(fact(slip, "MRN")).toBe("MRN-000123");
  expect(fact(slip, "Consultant")).toBe("Dr Anita Rao");
  expect(fact(slip, "Bed")).toContain("G-4");
  expect(fact(slip, "Bed")).toContain("General");
  expect(fact(slip, "Admitted")).toContain("14 Nov 2026");
  expect(fact(slip, "Attendant")).toContain("Meena Kumari");
  expect(fact(slip, "Attendant")).toContain("9876500001");
  expect(fact(slip, "Diagnosis")).toBe("Fracture left femur");
  expect(fact(slip, "Medico-legal")).toContain("PS Sector 17, DD 42/2026");
});

test("a slip leaves out the facts the stay does not have", () => {
  const slip = admissionSlip({
    ...stay,
    admission: {
      ...stay.admission,
      attendantName: null,
      attendantPhone: null,
      medicoLegal: false,
      medicoLegalRef: null,
      diagnosis: null,
    },
  });

  expect(fact(slip, "Attendant")).toBeUndefined();
  expect(fact(slip, "Diagnosis")).toBeUndefined();
  expect(fact(slip, "Medico-legal")).toBeUndefined();
  expect(slip.facts.every((entry) => entry.value.trim() !== "")).toBe(true);
});

test("a medico-legal stay without a reference still says so", () => {
  const slip = admissionSlip({
    ...stay,
    admission: { ...stay.admission, medicoLegalRef: null },
  });

  expect(fact(slip, "Medico-legal")).toBeTruthy();
});

test("the discharge slip says when and how the Patient left, for every discharge type", () => {
  const labels = new Set<string>();

  for (const dischargeType of [
    "normal",
    "against_advice",
    "absconded",
    "referred",
    "death",
  ] as const) {
    const slip = dischargeSlip({
      ...stay,
      admission: {
        ...stay.admission,
        dischargedAt: new Date("2026-11-17T08:00:00Z"),
        dischargeType,
      },
    });

    expect(slip.title).toBe("Discharge slip");
    expect(fact(slip, "IPD No.")).toBe("2026-27/41");
    expect(fact(slip, "Left")).toContain("17 Nov 2026");
    expect(fact(slip, "How the Patient left")).toBe(DISCHARGE_TYPE_LABELS[dischargeType]);
    expect(fact(slip, "Diagnosis")).toBe("Fracture left femur");

    labels.add(DISCHARGE_TYPE_LABELS[dischargeType]);
  }

  expect(labels.size).toBe(5);
  expect([...labels].every((label) => label.trim() !== "")).toBe(true);
});

test("the discharge slip carries a signature panel for the four paper clearances", () => {
  const slip = dischargeSlip({
    ...stay,
    admission: {
      ...stay.admission,
      dischargedAt: new Date("2026-11-17T08:00:00Z"),
      dischargeType: "normal",
    },
  });

  // The four paper clearances, each signed once: summary handed over, ward nurse,
  // pharmacy and billing.
  expect(slip.signatures).toHaveLength(4);

  for (const clearance of [/summary/i, /nurse/i, /pharmacy/i, /billing/i]) {
    expect(slip.signatures.filter((line) => clearance.test(line))).toHaveLength(1);
  }
});

test("the interim bill says in its title that it is not an Invoice or Receipt", () => {
  expect(INTERIM_BILL_TITLE).toBe("Interim bill — not an Invoice or Receipt");
});

test("the board says how far the running bill is past the deposit, and nothing when it is covered", () => {
  expect(depositShortfall(5_000_00n, 3_000_00n)).toBe(2_000_00n);
  expect(depositShortfall(3_000_00n, 3_000_00n)).toBe(0n);
  expect(depositShortfall(1_000_00n, 3_000_00n)).toBe(0n);

  expect(depositShortLabel(5_000_00n, 3_000_00n, "INR")).toBe("Deposit short by ₹2,000.00");
  expect(depositShortLabel(5_000_00n, 0n, "INR")).toBe("Deposit short by ₹5,000.00");
  expect(depositShortLabel(3_000_00n, 3_000_00n, "INR")).toBeNull();
  expect(depositShortLabel(0n, 0n, "INR")).toBeNull();
});
