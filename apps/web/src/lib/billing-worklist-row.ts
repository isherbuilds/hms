// One shape for both halves: charges waiting for an invoice and invoices waiting
// for money are the same question, so the desk works one ordered list.
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/org-datetime";
import { practitionerDisplayName } from "@/lib/practitioner-name";

type WorklistState = "to-bill" | "fresh" | "late" | "stale";

export type WorklistRow = {
  key: string;
  /** Null while the charges are still uninvoiced: nothing is collectable yet. */
  invoiceId: string | null;
  appointmentId: string;
  patientId: string;
  reference: string;
  patientName: string;
  patientMrn: string;
  patientPhone: string | null;
  currency: string;
  total: bigint;
  owed: bigint;
  at: Date;
  detail: string;
  state: WorklistState;
};

const DAY_MS = 86_400_000;

const LATE_DAYS = 7;

const STALE_DAYS = 30;

function stateForAge(at: Date, now: number): WorklistState {
  const days = (now - at.getTime()) / DAY_MS;

  if (days >= STALE_DAYS) return "stale";

  if (days >= LATE_DAYS) return "late";

  return "fresh";
}

type UnbilledInput = {
  appointmentId: string;
  patientId: string;
  tokenNumber: number | null;
  patientName: string;
  patientMrn: string;
  patientPhone: string | null;
  practitionerName: string;
  chargeCount: number;
  pendingValue: bigint;
  oldestChargeAt: Date | string;
};

type InvoiceInput = {
  id: string;
  invoiceNumber: string;
  appointmentId: string;
  patientId: string;
  patientName: string;
  patientMrn: string;
  patientPhone: string | null;
  grandTotal: bigint;
  paid: bigint;
  outstanding: bigint;
  createdAt: Date | string;
};

export function toWorklistRows(
  unbilled: readonly UnbilledInput[],
  invoices: readonly InvoiceInput[],
  currency: string,
): WorklistRow[] {
  const now = Date.now();

  // Charges outrank invoices whatever their age: the patient is in the building and
  // stops being collectable the moment they leave.
  return [
    ...unbilled.map((row) => ({
      key: `c-${row.appointmentId}`,
      invoiceId: null,
      appointmentId: row.appointmentId,
      patientId: row.patientId,
      reference: row.tokenNumber === null ? "No token" : `Token ${row.tokenNumber}`,
      currency,
      patientName: row.patientName,
      patientMrn: row.patientMrn,
      patientPhone: row.patientPhone,
      total: row.pendingValue,
      owed: row.pendingValue,
      at: new Date(row.oldestChargeAt),
      detail: `${row.chargeCount} charge${row.chargeCount === 1 ? "" : "s"} · ${practitionerDisplayName(row.practitionerName)}`,
      state: "to-bill" as const,
    })),
    ...invoices.map((row) => ({
      key: `i-${row.id}`,
      invoiceId: row.id,
      appointmentId: row.appointmentId,
      patientId: row.patientId,
      reference: row.invoiceNumber,
      currency,
      patientName: row.patientName,
      patientMrn: row.patientMrn,
      patientPhone: row.patientPhone,
      total: row.grandTotal,
      owed: row.outstanding,
      at: new Date(row.createdAt),
      detail: row.paid > 0n ? `${formatMoney(row.paid, currency)} received` : "Nothing received",
      state: stateForAge(new Date(row.createdAt), now),
    })),
  ];
}

/** "3h 11m" for money opened today, a date once it is older than that. */
export function waitedLabel(at: Date, timeZone: string): string {
  const minutes = Math.round((Date.now() - at.getTime()) / 60_000);

  if (minutes < 60) return `${minutes}m`;

  if (minutes < 1440) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;

    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }

  return formatDate(at, timeZone);
}
