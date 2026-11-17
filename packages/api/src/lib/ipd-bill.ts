import type { db } from "@hms/db";
import type { DbTransaction } from "@hms/db/counter";
import { catalogItems } from "@hms/db/schema/catalog-items";
import { charges } from "@hms/db/schema/charges";
import {
  admissionBedStays,
  admissions,
  bedCategories,
  bedTariffLines,
  bedTariffs,
} from "@hms/db/schema/ipd";
import { stockBatches } from "@hms/db/schema/stock-batches";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";

import { bedDays, type BedDay, type BedDayStay } from "./bed-days";
import { conflict, impossible } from "./conflict";
import {
  type ChargeInput,
  computeInvoiceLines,
  InvoiceDiscountExceededError,
} from "./invoice-math";

type Executor = typeof db | DbTransaction;

export const LAST_DAY_CHOICES = ["full", "half", "none"] as const;

type LastDay = (typeof LAST_DAY_CHOICES)[number];

/** What a stay's bill reads from its Admission. */
export const billAdmissionSelection = {
  id: admissions.id,
  status: admissions.status,
  admittedAt: admissions.admittedAt,
  dischargedAt: admissions.dischargedAt,
  checkoutMinutes: admissions.checkoutMinutes,
  timeZone: admissions.timeZone,
  bedDaysBilled: admissions.bedDaysBilled,
};

type BillAdmission = {
  [K in keyof typeof billAdmissionSelection]: (typeof admissions.$inferSelect)[K];
};

type BillStay = BedDayStay & { categoryName: string };

type TariffLine = {
  catalogItemId: string;
  serviceName: string;
  dailyPrice: bigint;
  taxRatePercent: string;
  taxCode: string | null;
  revenueCategory: (typeof catalogItems.$inferSelect)["category"];
};

/** A bed-day line as the bill shows it and the Charge it becomes. */
type BedDayLine = {
  catalogItemId: string;
  description: string;
  qty: number;
  unitPrice: bigint;
  taxRatePercent: string;
  taxCode: string | null;
  revenueCategory: TariffLine["revenueCategory"];
};

/**
 * Each stay segment with the bed type and tariff it started under. The bed type is the
 * tariff's, so a bed later moved to another type never re-prices a past stay.
 */
async function readStays(executor: Executor, orgId: string, admissionIds: string[]) {
  const rows = await executor
    .select({
      admissionId: admissionBedStays.admissionId,
      startedAt: admissionBedStays.startedAt,
      endedAt: admissionBedStays.endedAt,
      tariffId: admissionBedStays.tariffId,
      categoryId: bedTariffs.categoryId,
      categoryName: bedCategories.name,
    })
    .from(admissionBedStays)
    .innerJoin(
      bedTariffs,
      and(
        eq(bedTariffs.orgId, admissionBedStays.orgId),
        eq(bedTariffs.id, admissionBedStays.tariffId),
      ),
    )
    .innerJoin(
      bedCategories,
      and(eq(bedCategories.orgId, bedTariffs.orgId), eq(bedCategories.id, bedTariffs.categoryId)),
    )
    .where(
      and(eq(admissionBedStays.orgId, orgId), inArray(admissionBedStays.admissionId, admissionIds)),
    )
    .orderBy(asc(admissionBedStays.startedAt), asc(admissionBedStays.id));

  return Map.groupBy(rows, (row) => row.admissionId);
}

/** Price is the tariff's; tax and revenue category are the Service's as the bill is read. */
async function readTariffLines(executor: Executor, orgId: string, tariffIds: string[]) {
  const rows =
    tariffIds.length === 0
      ? []
      : await executor
          .select({
            tariffId: bedTariffLines.tariffId,
            catalogItemId: bedTariffLines.catalogItemId,
            serviceName: catalogItems.name,
            dailyPrice: bedTariffLines.dailyPrice,
            taxRatePercent: catalogItems.taxRatePercent,
            taxCode: catalogItems.taxCode,
            revenueCategory: catalogItems.category,
          })
          .from(bedTariffLines)
          .innerJoin(
            catalogItems,
            and(
              eq(catalogItems.orgId, bedTariffLines.orgId),
              eq(catalogItems.id, bedTariffLines.catalogItemId),
            ),
          )
          .where(and(eq(bedTariffLines.orgId, orgId), inArray(bedTariffLines.tariffId, tariffIds)))
          .orderBy(asc(bedTariffLines.tariffId), asc(bedTariffLines.position));

  return Map.groupBy(rows, (row) => row.tariffId);
}

// Ordered by (createdAt, id): the leftover subtotal paisa must land on the same line
// in the preview and the Invoice, since on an exclusive line it attracts tax.
async function readPendingCharges(executor: Executor, orgId: string, admissionIds: string[]) {
  const rows = await executor
    .select({
      admissionId: charges.admissionId,
      chargeId: charges.id,
      admissionKind: charges.admissionKind,
      description: charges.description,
      qty: charges.qty,
      unitPrice: charges.unitPrice,
      priceUnits: charges.priceUnits,
      taxRatePercent: charges.taxRatePercent,
      taxCode: charges.taxCode,
      priceBasis: charges.priceBasis,
      batchId: stockBatches.id,
      batchNumber: stockBatches.batchNumber,
      expiryDate: stockBatches.expiryDate,
    })
    .from(charges)
    .leftJoin(
      stockBatches,
      and(eq(stockBatches.orgId, orgId), eq(stockBatches.id, charges.stockBatchId)),
    )
    .where(
      and(
        eq(charges.orgId, orgId),
        inArray(charges.admissionId, admissionIds),
        eq(charges.status, "pending"),
      ),
    )
    .orderBy(asc(charges.createdAt), asc(charges.id));

  return Map.groupBy(rows, (row) => row.admissionId);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2026-11-05` prints as `5 Nov 2026`. */
function printedDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);

  return `${day} ${MONTHS[month! - 1]} ${year}`;
}

/**
 * The stay's bed days through `through` and the lines its unbilled ones bill (D066).
 * Unbilled days are cut into runs at one tariff; each run gives one line per tariff
 * line. A half last day is billed as its own lines; an uncharged one gives none but
 * still counts as billed. A line priced 0 is left out.
 */
function bedDayBill(
  admission: BillAdmission,
  stays: BillStay[],
  tariffLines: Map<string, TariffLine[]>,
  lastDay: LastDay,
  now: Date,
) {
  const through = admission.dischargedAt ?? now;

  // A cancelled stay occupied nothing.
  const days =
    admission.status === "cancelled"
      ? []
      : bedDays(
          stays,
          admission.admittedAt,
          admission.checkoutMinutes,
          admission.timeZone,
          through,
        );

  const categoryName = new Map(stays.map((stay) => [stay.categoryId, stay.categoryName]));

  const unbilled = days.slice(admission.bedDaysBilled).map((day) => ({
    day: day.day,
    date: day.date,
    categoryId: day.categoryId,
    // SAFETY: every day's bed type comes from one of these stays.
    categoryName: categoryName.get(day.categoryId)!,
  }));

  if (lastDay !== "full" && unbilled.length === 0) {
    throw new ORPCError("BAD_REQUEST", {
      message: "There is no unbilled bed day to change.",
    });
  }

  // Days at the full daily price, and a half last day billed on its own lines.
  const fullDays = days.slice(admission.bedDaysBilled, lastDay === "full" ? undefined : -1);

  const halfDay = lastDay === "half" ? days.at(-1) : undefined;
  const lines: BedDayLine[] = [];

  const push = (day: BedDay, qty: number, price: (line: TariffLine) => bigint, when: string) => {
    const ofTariff = tariffLines.get(day.tariffId);

    if (!ofTariff) throw impossible(`tariff ${day.tariffId} has no lines`);

    for (const line of ofTariff) {
      const unitPrice = price(line);

      if (unitPrice === 0n) continue;

      lines.push({
        catalogItemId: line.catalogItemId,
        description: `${line.serviceName} · ${categoryName.get(day.categoryId)} · ${when}`,
        qty,
        unitPrice,
        taxRatePercent: line.taxRatePercent,
        taxCode: line.taxCode,
        revenueCategory: line.revenueCategory,
      });
    }
  };

  // Consecutive days at one tariff share a line.
  for (let start = 0; start < fullDays.length;) {
    const first = fullDays[start]!;
    let end = start;

    while (end + 1 < fullDays.length && fullDays[end + 1]!.tariffId === first.tariffId) end++;

    const when =
      start === end
        ? printedDate(first.date)
        : `${printedDate(first.date)} to ${printedDate(fullDays[end]!.date)}`;

    push(first, end - start + 1, (line) => line.dailyPrice, when);
    start = end + 1;
  }

  if (halfDay) {
    // Half the daily price, rounded half up to the paisa.
    push(
      halfDay,
      1,
      (line) => (line.dailyPrice + 1n) / 2n,
      `${printedDate(halfDay.date)} · half day`,
    );
  }

  return {
    through,
    days: days.length,
    unbilled,
    // The day a half or uncharged choice applied to.
    adjusted: lastDay === "full" ? null : days.at(-1)!,
    lines,
  };
}

async function readBedDayInputs(executor: Executor, orgId: string, admissionIds: string[]) {
  const stays = await readStays(executor, orgId, admissionIds);
  const tariffIds = new Set([...stays.values()].flat().map((stay) => stay.tariffId));
  const tariffLines = await readTariffLines(executor, orgId, [...tariffIds]);

  return { stays, tariffLines };
}

/** The bed-day lines a bill on this Admission would write now. */
export async function readBedDayBill(
  executor: Executor,
  orgId: string,
  admission: BillAdmission,
  lastDay: LastDay,
  now: Date,
) {
  const { stays, tariffLines } = await readBedDayInputs(executor, orgId, [admission.id]);

  return bedDayBill(admission, stays.get(admission.id) ?? [], tariffLines, lastDay, now);
}

/**
 * Pending Charges first, then the bed-day lines: the order the Invoice writes them, so
 * the discount spreads over the lines as it will on the Invoice.
 */
export function billLines<Row extends ChargeInput<string | null>>(
  pending: Row[],
  bedLines: BedDayLine[],
  discountAmount: bigint,
) {
  const rows = [
    ...pending,
    ...bedLines.map((line) => ({
      chargeId: null,
      admissionKind: "bed_day" as const,
      description: line.description,
      qty: line.qty,
      unitPrice: line.unitPrice,
      priceUnits: 1,
      taxRatePercent: line.taxRatePercent,
      taxCode: line.taxCode,
      priceBasis: "exclusive" as const,
      batchId: null,
      batchNumber: null,
      expiryDate: null,
    })),
  ];

  let computed: ReturnType<typeof computeInvoiceLines<string | null>>;

  try {
    computed = computeInvoiceLines<string | null>(rows, discountAmount, { roundToRupee: false });
  } catch (error) {
    if (!(error instanceof InvoiceDiscountExceededError)) throw error;
    throw new ORPCError("BAD_REQUEST", { message: "The discount cannot exceed the bill." });
  }

  return { rows, computed };
}

/** The stay's bill as `ipd.previewInvoice` shows it. */
export async function readPendingBill(
  executor: Executor,
  orgId: string,
  admission: BillAdmission,
  lastDay: LastDay,
  discountAmount: bigint,
  now: Date,
) {
  const [pending, bedDay] = await Promise.all([
    readPendingCharges(executor, orgId, [admission.id]),
    readBedDayBill(executor, orgId, admission, lastDay, now),
  ]);

  const { rows, computed } = billLines(
    pending.get(admission.id) ?? [],
    bedDay.lines,
    discountAmount,
  );

  return {
    through: bedDay.through,
    bedDays: { billed: admission.bedDaysBilled, unbilled: bedDay.unbilled },
    pending: {
      // computeInvoiceLines keeps the input order, so each line pairs with its row.
      lines: computed.lines.map((line, index) => {
        const row = rows[index]!;

        return {
          ...line,
          admissionKind: row.admissionKind,
          batch:
            row.batchId === null || row.batchNumber === null
              ? null
              : { batchId: row.batchId, batchNumber: row.batchNumber, expiryDate: row.expiryDate },
        };
      }),
      subtotal: computed.subtotal,
      taxTotal: computed.taxTotal,
      addedTaxTotal: computed.addedTaxTotal,
      roundOff: computed.roundOff,
      grandTotal: computed.grandTotal,
    },
  };
}

/** What a stay owes before its next bill, and the pending Charges and bed days behind it. */
type RunningBill = { amount: bigint; pendingCharges: number; unbilledDays: number };

/**
 * Each Admission's running bill: the pending Charges plus the unbilled bed days through
 * now with a full last day, tax included. Four queries for any number of Admissions;
 * nothing is stored.
 */
export async function readRunningBills(
  executor: Executor,
  orgId: string,
  admissionIds: string[],
  now: Date,
): Promise<Map<string, RunningBill>> {
  if (admissionIds.length === 0) return new Map();

  const [rows, pending, { stays, tariffLines }] = await Promise.all([
    executor
      .select(billAdmissionSelection)
      .from(admissions)
      .where(and(eq(admissions.orgId, orgId), inArray(admissions.id, admissionIds))),
    readPendingCharges(executor, orgId, admissionIds),
    readBedDayInputs(executor, orgId, admissionIds),
  ]);

  return new Map(
    rows.map((admission) => {
      const bedDay = bedDayBill(admission, stays.get(admission.id) ?? [], tariffLines, "full", now);
      const pendingRows = pending.get(admission.id) ?? [];
      const { computed } = billLines(pendingRows, bedDay.lines, 0n);

      return [
        admission.id,
        {
          amount: computed.grandTotal,
          pendingCharges: pendingRows.length,
          unbilledDays: bedDay.unbilled.length,
        },
      ];
    }),
  );
}

/**
 * Refuses a backdated transfer that would re-type or re-price a day already billed; the
 * correction for a billed day is a Credit Note (D066). `move` is the bed stay the transfer
 * opens, closing the current one. A departure is never checked: billed days stay as billed.
 */
export async function requireBilledDaysKept(
  tx: DbTransaction,
  orgId: string,
  admission: Omit<BillAdmission, "status" | "dischargedAt">,
  through: Date,
  move: { startedAt: Date; categoryId: string; tariffId: string },
) {
  if (admission.bedDaysBilled === 0) return;

  const segments = (await readStays(tx, orgId, [admission.id])).get(admission.id) ?? [];

  // Compares billed days as derived now, before and after: may refuse a move back; moves no money.
  const billedDays = (of: BedDayStay[]) =>
    bedDays(of, admission.admittedAt, admission.checkoutMinutes, admission.timeZone, through).slice(
      0,
      admission.bedDaysBilled,
    );

  const was = billedDays(segments);

  const will = billedDays([
    ...segments.map((segment) =>
      segment.endedAt === null ? { ...segment, endedAt: move.startedAt } : segment,
    ),
    { ...move, endedAt: null },
  ]);

  const changed = will.some((day, index) => {
    const billed = was[index];

    return (
      billed !== undefined &&
      (billed.categoryId !== day.categoryId || billed.tariffId !== day.tariffId)
    );
  });

  if (changed) {
    throw conflict(
      "billed_day",
      "That would change a bed day already billed. Correct the bill with a Credit Note instead.",
    );
  }
}
