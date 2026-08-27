/**
 * One row shape for both halves of the billing worklist: charges waiting for an
 * invoice, and invoices waiting for money. They are two different jobs but the
 * same question — who owes what, and how long has it waited — so merging them
 * lets the desk work one ordered list instead of choosing a board first.
 */
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/org-datetime";

type WorklistState = "to-bill" | "fresh" | "late" | "stale";

export type WorklistRow = {
  key: string;
  /** Null while the charges are still uninvoiced: nothing is collectable yet. */
  invoiceId: string | null;
  appointmentId: string;
  reference: string;
  patientName: string;
  patientMrn: string;
  patientPhone: string | null;
  /** The org currency the row's money strings are denominated in. */
  currency: string;
  total: string;
  owed: string;
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
  tokenNumber: number | null;
  patientName: string;
  patientMrn: string;
  patientPhone: string | null;
  practitionerName: string;
  chargeCount: number;
  pendingValue: string;
  oldestChargeAt: Date | string;
};

type InvoiceInput = {
  id: string;
  invoiceNumber: string;
  appointmentId: string;
  patientName: string;
  patientMrn: string;
  patientPhone: string | null;
  grandTotal: string;
  paid: string;
  outstanding: string;
  createdAt: Date | string;
};

export function toWorklistRows(
  unbilled: readonly UnbilledInput[],
  invoices: readonly InvoiceInput[],
  currency: string,
): WorklistRow[] {
  const now = Date.now();

  // Charges outrank invoices whatever their age: the patient is in the building
  // and stops being collectable the moment they leave, while an old invoice will
  // still be there tomorrow. Both halves already arrive oldest first.
  return [
    ...unbilled.map((row) => ({
      key: `c-${row.appointmentId}`,
      invoiceId: null,
      appointmentId: row.appointmentId,
      reference: row.tokenNumber === null ? "No token" : `Token ${row.tokenNumber}`,
      currency,
      patientName: row.patientName,
      patientMrn: row.patientMrn,
      patientPhone: row.patientPhone,
      total: row.pendingValue,
      owed: row.pendingValue,
      at: new Date(row.oldestChargeAt),
      detail: `${row.chargeCount} charge${row.chargeCount === 1 ? "" : "s"} · ${row.practitionerName}`,
      state: "to-bill" as const,
    })),
    ...invoices.map((row) => ({
      key: `i-${row.id}`,
      invoiceId: row.id,
      appointmentId: row.appointmentId,
      reference: row.invoiceNumber,
      currency,
      patientName: row.patientName,
      patientMrn: row.patientMrn,
      patientPhone: row.patientPhone,
      total: row.grandTotal,
      owed: row.outstanding,
      at: new Date(row.createdAt),
      detail:
        Number(row.paid) > 0 ? `${formatMoney(row.paid, currency)} received` : "Nothing received",
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
