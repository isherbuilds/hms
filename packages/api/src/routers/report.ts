import { db } from "@hms/db";
import { accounts } from "@hms/db/schema/accounts";
import { advanceAllocations } from "@hms/db/schema/advance-allocations";
import { advanceReceipts } from "@hms/db/schema/advance-receipts";
import { user } from "@hms/db/schema/auth";
import { charges } from "@hms/db/schema/charges";
import { pharmacySales } from "@hms/db/schema/pharmacy-sales";
import { products } from "@hms/db/schema/products";
import { stockBatches } from "@hms/db/schema/stock-batches";
import { stockMovements } from "@hms/db/schema/stock-movements";
import { departments } from "@hms/db/schema/departments";
import { creditNoteLines } from "@hms/db/schema/credit-note-lines";
import { creditNotes } from "@hms/db/schema/credit-notes";
import { invoiceLines } from "@hms/db/schema/invoice-lines";
import { invoices } from "@hms/db/schema/invoices";
import { opdAppointments } from "@hms/db/schema/opd-appointments";
import { patients } from "@hms/db/schema/patients";
import { payments } from "@hms/db/schema/payments";
import { practitioners } from "@hms/db/schema/practitioners";
import { refunds } from "@hms/db/schema/refunds";
import { journalEntries } from "@hms/db/schema/journal-entries";
import { journalLines } from "@hms/db/schema/journal-lines";
import { ORPCError } from "@orpc/server";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";

import { businessDate } from "../lib/business-date";
import { divideHalfUp } from "../core/money";
import { invoiceMovements } from "../lib/invoice-balance";
import { closeExpiredBookings } from "../lib/opd-close";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import { readOrgSettings } from "../lib/settings-cache";
import {
  buildBalanceSheet,
  buildGstReport,
  buildTrialBalance,
  type AccountAggregate,
  type GstBucket,
} from "../lib/report-math";
import { likePattern, paymentMethod, searchQuery, type PaymentMethod } from "../lib/schemas";

const reportDate = z.iso.date();

export const periodInput = orgInput.extend({ from: reportDate, to: reportDate });

export const asOfInput = orgInput.extend({ asOf: reportDate });

const invoiceRegisterInput = periodInput.extend({
  stream: z.enum(["opd", "pharmacy"]).optional(),
  query: searchQuery,
  limit: z.number().int().min(1).max(100).default(25),
  cursor: z
    .object({
      businessDate: reportDate,
      createdAt: z.iso.datetime(),
      id: z.string().min(1),
    })
    .optional(),
});

export const invoiceRegisterExportInput = invoiceRegisterInput.omit({ limit: true, cursor: true });

export const revenueSignalKind = z.enum([
  "no_charge",
  "voided_charge",
  "discount",
  "credit_note",
  "below_mrp",
  "stock_adjustment",
  "refund",
]);

type SignalKind = z.infer<typeof revenueSignalKind>;

const revenueSignalsInput = periodInput.extend({
  kind: revenueSignalKind,
  limit: z.number().int().min(1).max(100).default(25),
  cursor: z.object({ eventAt: z.iso.datetime(), id: z.string().min(1) }).optional(),
});

const expiryExposureInput = orgInput.extend({
  horizonDays: z.union([z.literal(30), z.literal(90)]).default(30),
});

export const REVENUE_BOUND = { report: "Revenue control", maxDays: 92 };

type ReportSource = { type: "opd" | "pharmacy" | "advance" | "stock"; id: string };

function invoiceSource(row: {
  opdAppointmentId: string | null;
  pharmacySaleId: string | null;
}): ReportSource | null {
  if (row.opdAppointmentId) return { type: "opd", id: row.opdAppointmentId };

  if (row.pharmacySaleId) return { type: "pharmacy", id: row.pharmacySaleId };

  return null;
}

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

type SignalRecord = {
  id: string;
  eventDate: string;
  eventAt: string;
  invoiceId: string | null;
  sourceType: ReportSource["type"] | null;
  sourceId: string | null;
  label: string;
  amount: string | null;
  reason: string | null;
  actorName: string | null;
  details: {
    creatorName?: string | null;
    quantity?: number;
    bucket?: string;
    lineSubtotal?: string;
    discountAmount?: string;
    classification?: string;
    method?: PaymentMethod;
  };
};

const SIGNAL_BASIS: Record<SignalKind, string> = {
  no_charge: "Checked-in attendance requiring review; no inferred missed value",
  voided_charge: "Current voided Charge snapshot; recorded last-update date",
  discount: "Issued Invoice discount on document Business Date",
  credit_note: "Credit Note total on correction Business Date; not all discounts",
  below_mrp:
    "Allocated Invoice discount; issued line gross excludes document round-off; authorized concession review",
  stock_adjustment: "Signed MRP exposure, not purchase cost or inventory valuation",
  refund: "Refund cash movement on Business Date; not a second revenue reduction",
};

const DAY_MS = 24 * 60 * 60 * 1_000;

const GST_BOUND = { report: "GST register", maxDays: 366 };

const COLLECTIONS_BOUND = { report: "Daily collections", maxDays: 92 };

const REGISTER_BOUND = { report: "OPD register", maxDays: 31 };

const PAYMENT_METHODS = paymentMethod.options;

export function assertValidPeriod(
  from: string,
  to: string,
  bound?: { report: string; maxDays: number },
): void {
  if (from > to) {
    throw new ORPCError("BAD_REQUEST", {
      message: "The start date must not be after the end date",
    });
  }

  if (!bound) return;

  const inclusiveDays =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1;

  if (inclusiveDays > bound.maxDays) {
    throw new ORPCError("BAD_REQUEST", {
      message: `${bound.report} covers at most ${bound.maxDays} days`,
    });
  }
}

async function accountAggregates(
  orgId: string,
  ...datePredicates: SQL<unknown>[]
): Promise<AccountAggregate[]> {
  const rows = await db
    .select({
      accountId: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      debit: sql`coalesce(sum(${journalLines.debit}), 0)::bigint`.mapWith(BigInt),
      credit: sql`coalesce(sum(${journalLines.credit}), 0)::bigint`.mapWith(BigInt),
    })
    .from(accounts)
    .innerJoin(
      journalLines,
      and(eq(journalLines.accountId, accounts.id), eq(journalLines.orgId, orgId)),
    )
    .innerJoin(
      journalEntries,
      and(eq(journalEntries.id, journalLines.entryId), eq(journalEntries.orgId, orgId)),
    )
    .where(and(eq(accounts.orgId, orgId), ...datePredicates))
    .groupBy(accounts.id, accounts.code, accounts.name, accounts.type);

  return rows;
}

function perMethod<T>(value: (method: PaymentMethod) => T): Record<PaymentMethod, T> {
  // SAFETY: the entries are keyed by every PAYMENT_METHODS member.
  return Object.fromEntries(PAYMENT_METHODS.map((method) => [method, value(method)])) as Record<
    PaymentMethod,
    T
  >;
}

type RegisterFilters = z.infer<typeof invoiceRegisterExportInput>;

type RegisterCursor = NonNullable<z.infer<typeof invoiceRegisterInput>["cursor"]>;

export function registerFilter(orgId: string, input: RegisterFilters) {
  assertValidPeriod(input.from, input.to, { report: "Invoice register", maxDays: 366 });
  const pattern = input.query ? likePattern(input.query) : undefined;

  return and(
    eq(invoices.orgId, orgId),
    gte(invoices.businessDate, input.from),
    lte(invoices.businessDate, input.to),
    input.stream ? eq(invoices.stream, input.stream) : undefined,
    pattern
      ? or(
          ilike(invoices.invoiceNumber, pattern),
          ilike(invoices.patientName, pattern),
          ilike(invoices.patientMrn, pattern),
        )
      : undefined,
  );
}

/** Register rows with their current balances; every match when no page is given. */
export function registerRows(
  orgId: string,
  filter: SQL | undefined,
  page?: { limit: number; cursor?: RegisterCursor },
) {
  const { movements, joinOn } = invoiceMovements(orgId);

  const query = db
    .select({
      id: invoices.id,
      businessDate: invoices.businessDate,
      createdAt: invoices.createdAt,
      cursorCreatedAt: sql<string>`to_char(${invoices.createdAt} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      stream: invoices.stream,
      fiscalYear: invoices.fiscalYear,
      invoiceNumber: invoices.invoiceNumber,
      patientName: invoices.patientName,
      patientMrn: invoices.patientMrn,
      subtotal: invoices.subtotal,
      discountAmount: invoices.discountAmount,
      taxTotal: invoices.taxTotal,
      roundOff: invoices.roundOff,
      grandTotal: invoices.grandTotal,
      creditTotal: sql`movements.credited`.mapWith(BigInt),
      paymentsTotal: sql`movements.paid`.mapWith(BigInt),
      allocationsTotal: sql`movements.allocated`.mapWith(BigInt),
      refundsTotal: sql`movements.refunded`.mapWith(BigInt),
      opdAppointmentId: invoices.opdAppointmentId,
      pharmacySaleId: invoices.pharmacySaleId,
    })
    .from(invoices)
    .leftJoin(movements, joinOn)
    .where(
      and(
        filter,
        page?.cursor
          ? sql`(${invoices.businessDate}, ${invoices.createdAt}, ${invoices.id}) <
              (${page.cursor.businessDate}::date, ${page.cursor.createdAt}::timestamptz, ${page.cursor.id})`
          : undefined,
      ),
    )
    .orderBy(desc(invoices.businessDate), desc(invoices.createdAt), desc(invoices.id))
    .$dynamic();

  return page ? query.limit(page.limit + 1) : query;
}

type RegisterMoney = {
  grandTotal: bigint;
  taxTotal: bigint;
  roundOff: bigint;
  creditTotal: bigint;
  paymentsTotal: bigint;
  allocationsTotal: bigint;
  refundsTotal: bigint;
};

// Issued lines sum to the grand total less tax and round-off (`computeInvoiceLines`).
// Negative outstanding means a refund is due.
function registerFigures<T extends RegisterMoney>(row: T) {
  const netBilled = row.grandTotal - row.creditTotal;

  return {
    ...row,
    taxableValue: row.grandTotal - row.taxTotal - row.roundOff,
    netBilled,
    outstanding: netBilled - row.paymentsTotal - row.allocationsTotal + row.refundsTotal,
  };
}

export function registerRow({
  opdAppointmentId,
  pharmacySaleId,
  cursorCreatedAt: _cursorCreatedAt,
  ...row
}: Awaited<ReturnType<typeof registerRows>>[number]) {
  return { ...registerFigures(row), source: invoiceSource({ opdAppointmentId, pharmacySaleId }) };
}

/** Whole-filter totals and per-series counts in one scan: the empty grouping set is the total. */
export async function registerSummary(orgId: string, filter: SQL | undefined) {
  const { movements, joinOn } = invoiceMovements(orgId);

  const result = await db.execute<{
    stream: "opd" | "pharmacy" | null;
    fiscalYear: string | null;
    count: string;
    subtotal: string;
    discountAmount: string;
    taxTotal: string;
    roundOff: string;
    grandTotal: string;
    creditTotal: string;
    paymentsTotal: string;
    allocationsTotal: string;
    refundsTotal: string;
    firstNumber: string;
    lastNumber: string;
  }>(sql`
    select ${invoices.stream} as stream, ${invoices.fiscalYear} as "fiscalYear", count(*)::text as count,
      coalesce(sum(${invoices.subtotal}),0)::text as subtotal,
      coalesce(sum(${invoices.discountAmount}),0)::text as "discountAmount",
      coalesce(sum(${invoices.taxTotal}),0)::text as "taxTotal",
      coalesce(sum(${invoices.roundOff}),0)::text as "roundOff",
      coalesce(sum(${invoices.grandTotal}),0)::text as "grandTotal",
      coalesce(sum(movements.credited),0)::text as "creditTotal",
      coalesce(sum(movements.paid),0)::text as "paymentsTotal",
      coalesce(sum(movements.allocated),0)::text as "allocationsTotal",
      coalesce(sum(movements.refunded),0)::text as "refundsTotal",
      (array_agg(${invoices.invoiceNumber} order by ${invoices.createdAt},${invoices.id}))[1] as "firstNumber",
      (array_agg(${invoices.invoiceNumber} order by ${invoices.createdAt} desc,${invoices.id} desc))[1] as "lastNumber"
    from ${invoices} left join ${movements} on ${joinOn}
    where ${filter}
    group by grouping sets ((${invoices.stream}, ${invoices.fiscalYear}), ())
    order by ${invoices.stream} nulls first, ${invoices.fiscalYear}
  `);

  const [total, ...series] = result.rows;

  if (!total || total.stream !== null) throw new Error("Invoice register total row missing");

  return {
    totals: {
      count: Number(total.count),
      subtotal: BigInt(total.subtotal),
      discountAmount: BigInt(total.discountAmount),
      ...registerFigures({
        grandTotal: BigInt(total.grandTotal),
        taxTotal: BigInt(total.taxTotal),
        roundOff: BigInt(total.roundOff),
        creditTotal: BigInt(total.creditTotal),
        paymentsTotal: BigInt(total.paymentsTotal),
        allocationsTotal: BigInt(total.allocationsTotal),
        refundsTotal: BigInt(total.refundsTotal),
      }),
    },
    series: series.map((row) => ({
      stream: row.stream,
      fiscalYear: row.fiscalYear,
      count: Number(row.count),
      firstNumber: row.firstNumber,
      lastNumber: row.lastNumber,
    })),
  };
}

/** Every record of one review kind in the period; callers order and page. */
export function signalSource(
  kind: SignalKind,
  orgId: string,
  period: { from: string; to: string },
  timeZone: string,
): SQL {
  switch (kind) {
    case "no_charge":
      return sql`
        select ${opdAppointments.id} as id, ${opdAppointments.businessDate}::text as "eventDate",
          ${opdAppointments.businessDate}::timestamp at time zone 'UTC' as "eventAt",
          null::text as "invoiceId", 'opd'::text as "sourceType", ${opdAppointments.id} as "sourceId",
          coalesce(${patients.name},${opdAppointments.callerName},'Attendance') as label,
          null::bigint as amount, null::text as reason, null::text as "actorId", null::text as "actorName",
          jsonb_build_object('classification',case when exists (
            select 1 from ${charges} where ${charges.orgId}=${orgId} and ${charges.opdAppointmentId}=${opdAppointments.id}
          ) then 'all_charges_voided' else 'never_charged' end) as details
        from ${opdAppointments} left join ${patients}
          on ${patients.id}=${opdAppointments.patientId} and ${patients.orgId}=${orgId}
        where ${opdAppointments.orgId}=${orgId} and ${opdAppointments.status}='checked_in'
          and ${opdAppointments.businessDate} between ${period.from} and ${period.to}
          and not exists (select 1 from ${charges} where ${charges.orgId}=${orgId}
            and ${charges.opdAppointmentId}=${opdAppointments.id} and ${charges.status}<>'voided')
      `;
    case "voided_charge":
      return sql`
        select ${charges.id} as id, (${charges.updatedAt} at time zone ${timeZone})::date::text as "eventDate",
          ${charges.updatedAt} as "eventAt", ${charges.invoiceId} as "invoiceId",
          case when ${charges.opdAppointmentId} is not null then 'opd' else 'pharmacy' end as "sourceType",
          coalesce(${charges.opdAppointmentId},${charges.pharmacySaleId}) as "sourceId",
          ${charges.description} as label,
          round(${charges.unitPrice}::numeric * ${charges.qty}/${charges.priceUnits})::bigint as amount,
          ${charges.voidReason} as reason, null::text as "actorId", null::text as "actorName",
          jsonb_build_object('creatorName',${user.name},'quantity',${charges.qty}) as details
        from ${charges} left join ${user} on ${user.id}=${charges.createdBy}
        where ${charges.orgId}=${orgId} and ${charges.status}='voided'
          and ${charges.updatedAt} >= (${period.from}::date::timestamp at time zone ${timeZone})
          and ${charges.updatedAt} < ((${period.to}::date+1)::timestamp at time zone ${timeZone})
      `;
    case "discount":
      return sql`
        select ${invoices.id} as id, ${invoices.businessDate}::text as "eventDate",
          ${invoices.businessDate}::timestamp at time zone 'UTC' as "eventAt",
          ${invoices.id} as "invoiceId", ${invoices.stream} as "sourceType",
          coalesce(${invoices.opdAppointmentId},${invoices.pharmacySaleId}) as "sourceId",
          ${invoices.invoiceNumber} as label, ${invoices.discountAmount} as amount,
          ${invoices.note} as reason, ${invoices.issuedBy} as "actorId", ${user.name} as "actorName",
          '{}'::jsonb as details
        from ${invoices} left join ${user} on ${user.id}=${invoices.issuedBy}
        where ${invoices.orgId}=${orgId} and ${invoices.discountAmount}>0
          and ${invoices.businessDate} between ${period.from} and ${period.to}
      `;
    case "credit_note":
      return sql`
        select ${creditNotes.id} as id, ${creditNotes.businessDate}::text as "eventDate",
          ${creditNotes.businessDate}::timestamp at time zone 'UTC' as "eventAt",
          ${invoices.id} as "invoiceId", ${invoices.stream} as "sourceType",
          coalesce(${invoices.opdAppointmentId},${invoices.pharmacySaleId}) as "sourceId",
          ${creditNotes.creditNoteNumber} || ' · ' || ${invoices.invoiceNumber} as label,
          ${creditNotes.total} as amount, ${creditNotes.reason} as reason,
          ${creditNotes.issuedBy} as "actorId", ${user.name} as "actorName", '{}'::jsonb as details
        from ${creditNotes} inner join ${invoices} on ${invoices.id}=${creditNotes.invoiceId} and ${invoices.orgId}=${orgId}
          left join ${user} on ${user.id}=${creditNotes.issuedBy}
        where ${creditNotes.orgId}=${orgId} and ${creditNotes.businessDate} between ${period.from} and ${period.to}
      `;
    case "below_mrp":
      return sql`
        select ${invoiceLines.id} as id, ${invoices.businessDate}::text as "eventDate",
          ${invoices.businessDate}::timestamp at time zone 'UTC' as "eventAt",
          ${invoices.id} as "invoiceId", 'pharmacy'::text as "sourceType", ${invoices.pharmacySaleId} as "sourceId",
          ${invoices.invoiceNumber} || ' · ' || ${invoiceLines.description} as label,
          ${invoiceLines.allocatedDiscount} as amount, ${invoices.note} as reason,
          ${invoices.issuedBy} as "actorId", ${user.name} as "actorName",
          jsonb_build_object('lineSubtotal',${invoiceLines.lineSubtotal}::text,
            'discountAmount',${invoiceLines.allocatedDiscount}::text,'quantity',${invoiceLines.qty}) as details
        from ${invoiceLines} inner join ${invoices}
          on ${invoices.id}=${invoiceLines.invoiceId} and ${invoices.orgId}=${orgId}
        inner join ${charges} on ${charges.id}=${invoiceLines.chargeId} and ${charges.orgId}=${orgId}
        inner join ${stockBatches} on ${stockBatches.id}=${charges.stockBatchId} and ${stockBatches.orgId}=${orgId}
        left join ${user} on ${user.id}=${invoices.issuedBy}
        where ${invoiceLines.orgId}=${orgId} and ${invoices.stream}='pharmacy'
          and ${invoices.businessDate} between ${period.from} and ${period.to}
          and (${invoiceLines.allocatedDiscount}>0 or
            ${invoiceLines.unitPrice}::numeric * ${stockBatches.mrpUnits} <
            ${stockBatches.mrp}::numeric * ${invoiceLines.priceUnits})
      `;
    case "stock_adjustment":
      return sql`
        select ${stockMovements.id} as id, (${stockMovements.createdAt} at time zone ${timeZone})::date::text as "eventDate",
          ${stockMovements.createdAt} as "eventAt", null::text as "invoiceId",
          'stock'::text as "sourceType", ${stockBatches.id} as "sourceId",
          ${products.name} || ' · ' || ${stockBatches.batchNumber} as label,
          round(${stockBatches.mrp}::numeric * ${stockMovements.qty}/${stockBatches.mrpUnits})::bigint as amount,
          ${stockMovements.note} as reason, ${stockMovements.createdBy} as "actorId", ${user.name} as "actorName",
          jsonb_build_object('quantity',${stockMovements.qty},'bucket',${stockMovements.bucket},
            'classification',${stockMovements.reason}) as details
        from ${stockMovements} inner join ${stockBatches}
          on ${stockBatches.id}=${stockMovements.batchId} and ${stockBatches.orgId}=${orgId}
        inner join ${products} on ${products.id}=${stockBatches.productId} and ${products.orgId}=${orgId}
        left join ${user} on ${user.id}=${stockMovements.createdBy}
        where ${stockMovements.orgId}=${orgId} and ${stockMovements.reason} in ('count_correction','breakage','writeoff')
          and ${stockMovements.createdAt} >= (${period.from}::date::timestamp at time zone ${timeZone})
          and ${stockMovements.createdAt} < ((${period.to}::date+1)::timestamp at time zone ${timeZone})
      `;
    case "refund":
      return sql`
        select ${refunds.id} as id, ${refunds.businessDate}::text as "eventDate",
          ${refunds.businessDate}::timestamp at time zone 'UTC' as "eventAt",
          ${refunds.invoiceId} as "invoiceId",
          case when ${refunds.advanceReceiptId} is not null then 'advance' else ${invoices.stream} end as "sourceType",
          coalesce(${refunds.advanceReceiptId},${invoices.opdAppointmentId},${invoices.pharmacySaleId}) as "sourceId",
          ${refunds.refundNumber} || ' · ' || coalesce(${advanceReceipts.receiptNumber},${invoices.invoiceNumber}) as label,
          ${refunds.amount} as amount, ${creditNotes.reason} as reason,
          ${refunds.refundedBy} as "actorId", ${user.name} as "actorName",
          jsonb_build_object('method',${refunds.method},'classification',
            case when ${refunds.advanceReceiptId} is null then 'invoice_refund' else 'advance_refund' end) as details
        from ${refunds} left join ${invoices} on ${invoices.id}=${refunds.invoiceId} and ${invoices.orgId}=${orgId}
        left join ${advanceReceipts} on ${advanceReceipts.id}=${refunds.advanceReceiptId} and ${advanceReceipts.orgId}=${orgId}
        left join ${creditNotes} on ${creditNotes.id}=${refunds.creditNoteId} and ${creditNotes.orgId}=${orgId}
        left join ${user} on ${user.id}=${refunds.refundedBy}
        where ${refunds.orgId}=${orgId} and ${refunds.businessDate} between ${period.from} and ${period.to}
      `;
  }
}

/** Signal rows newest first, after the cursor; every row when no limit is given. */
export async function signalRows(
  source: SQL,
  limit?: number,
  cursor?: { eventAt: string; id: string },
) {
  const result = await db.execute<SignalRecord>(sql`with signals as (${source})
    select id,"eventDate","invoiceId","sourceType","sourceId",label,amount::text as amount,
      reason,"actorName",details,
      to_char("eventAt" at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "eventAt"
    from signals
    ${cursor ? sql`where (signals."eventAt",signals.id)<(${cursor.eventAt}::timestamptz,${cursor.id})` : sql``}
    order by signals."eventAt" desc,signals.id desc
    ${limit === undefined ? sql`` : sql`limit ${limit}`}`);

  return result.rows.map((row) => ({
    id: row.id,
    eventDate: row.eventDate,
    eventAt: row.eventAt,
    invoiceId: row.invoiceId,
    source: row.sourceId && row.sourceType ? { type: row.sourceType, id: row.sourceId } : null,
    label: row.label,
    amount: row.amount === null ? null : BigInt(row.amount),
    reason: row.reason,
    actorName: row.actorName,
    creatorName: row.details.creatorName ?? null,
    quantity: row.details.quantity ?? null,
    bucket: row.details.bucket ?? null,
    lineSubtotal: row.details.lineSubtotal === undefined ? null : BigInt(row.details.lineSubtotal),
    discountAmount:
      row.details.discountAmount === undefined ? null : BigInt(row.details.discountAmount),
    classification: row.details.classification ?? null,
    method: row.details.method ?? null,
  }));
}

async function signalSummary(source: SQL, kind: SignalKind) {
  const [totals, grouped] = await Promise.all([
    db.execute<{ count: string; amount: string | null }>(sql`
      with signals as (${source}) select count(*)::text as count,sum(amount)::text as amount from signals
    `),
    kind === "discount" || kind === "credit_note"
      ? db.execute<{
          actorId: string;
          actorName: string | null;
          reason: string | null;
          count: string;
          amount: string;
        }>(sql`
          with signals as (${source}) select "actorId","actorName",reason,count(*)::text as count,sum(amount)::text as amount
          from signals group by "actorId","actorName",reason order by "actorId",reason
        `)
      : null,
  ]);

  const total = totals.rows[0];

  if (!total) throw new Error("Review signal aggregate missing");

  return {
    count: Number(total.count),
    // A visit with no Charge has no value to infer.
    amount: total.amount === null ? (kind === "no_charge" ? null : 0n) : BigInt(total.amount),
    groups: (grouped?.rows ?? []).map((row) => ({
      ...row,
      count: Number(row.count),
      amount: BigInt(row.amount),
    })),
  };
}

const opdRegisterInput = periodInput.extend({
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z
    .object({
      businessDate: reportDate,
      dayOrderAt: z.union([z.iso.datetime(), z.literal("infinity")]),
      id: z.string().min(1),
    })
    .optional(),
});

type OpdRegisterCursor = NonNullable<z.infer<typeof opdRegisterInput>["cursor"]>;

type RegisterScope = { orgId: string; userId: string };

type Period = { from: string; to: string };

// A visit with neither an arrival nor a slot sorts last in its day, as `nulls last` did.
const registerDayOrder = sql`coalesce(${opdAppointments.dayOrderAt}, 'infinity'::timestamptz)`;

/** Closes past bookings first, so every page and the export read settled statuses. */
export async function settleOpdRegister(scope: RegisterScope, period: Period) {
  assertValidPeriod(period.from, period.to, REGISTER_BOUND);
  const { timeZone } = await readOrgSettings(scope.orgId);
  const now = new Date();
  const currentDay = businessDate(now, timeZone);

  if (period.from < currentDay) {
    await closeExpiredBookings({ orgId: scope.orgId, actorId: scope.userId, currentDay, now });
  }
}

/** Register rows in day order; every match when no page is given. */
export function opdRegisterRows(
  orgId: string,
  period: Period,
  page?: { limit: number; cursor?: OpdRegisterCursor },
) {
  const billed = sql`coalesce((select sum(${invoices.grandTotal}) from ${invoices}
    where ${invoices.orgId} = ${orgId}
      and ${invoices.opdAppointmentId} = ${opdAppointments.id}), 0)::bigint`
    .mapWith(BigInt)
    .as("billed");

  // Credit applied from an advance settles a visit the same way a payment does.
  const paid = sql`(coalesce((select sum(${payments.amount}) from ${payments}
    inner join ${invoices}
      on ${invoices.id} = ${payments.invoiceId}
      and ${invoices.orgId} = ${orgId}
    where ${payments.orgId} = ${orgId}
      and ${invoices.opdAppointmentId} = ${opdAppointments.id}), 0)
    + coalesce((select sum(${advanceAllocations.amount}) from ${advanceAllocations}
    inner join ${invoices}
      on ${invoices.id} = ${advanceAllocations.invoiceId}
      and ${invoices.orgId} = ${orgId}
    where ${advanceAllocations.orgId} = ${orgId}
      and ${invoices.opdAppointmentId} = ${opdAppointments.id}), 0))::bigint`
    .mapWith(BigInt)
    .as("paid");

  const credits = sql`coalesce((select sum(${creditNotes.total}) from ${creditNotes}
    inner join ${invoices}
      on ${invoices.id} = ${creditNotes.invoiceId}
      and ${invoices.orgId} = ${orgId}
    where ${creditNotes.orgId} = ${orgId}
      and ${invoices.opdAppointmentId} = ${opdAppointments.id}), 0)::bigint`
    .mapWith(BigInt)
    .as("credits");

  const refunded = sql`coalesce((select sum(${refunds.amount}) from ${refunds}
    inner join ${invoices}
      on ${invoices.id} = ${refunds.invoiceId}
      and ${invoices.orgId} = ${orgId}
    where ${refunds.orgId} = ${orgId}
      and ${invoices.opdAppointmentId} = ${opdAppointments.id}), 0)::bigint`
    .mapWith(BigInt)
    .as("refunds");

  const query = db
    .select({
      appointmentId: opdAppointments.id,
      businessDate: opdAppointments.businessDate,
      cursorDayOrderAt:
        sql<string>`coalesce(to_char(${opdAppointments.dayOrderAt} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'infinity')`.as(
          "cursorDayOrderAt",
        ),
      tokenNumber: opdAppointments.tokenNumber,
      patientName: patients.name,
      patientMrn: patients.mrn,
      callerName: opdAppointments.callerName,
      practitionerName: practitioners.name,
      departmentName: departments.name,
      arrivalMode: opdAppointments.arrivalMode,
      status: opdAppointments.status,
      arrivedAt: opdAppointments.arrivedAt,
      billed,
      paid,
      credits,
      refunds: refunded,
    })
    .from(opdAppointments)
    .leftJoin(patients, and(eq(patients.id, opdAppointments.patientId), eq(patients.orgId, orgId)))
    .innerJoin(
      practitioners,
      and(eq(practitioners.id, opdAppointments.practitionerId), eq(practitioners.orgId, orgId)),
    )
    .innerJoin(
      departments,
      and(eq(departments.id, opdAppointments.departmentId), eq(departments.orgId, orgId)),
    )
    .where(
      and(
        eq(opdAppointments.orgId, orgId),
        gte(opdAppointments.businessDate, period.from),
        lte(opdAppointments.businessDate, period.to),
        page?.cursor
          ? sql`(${opdAppointments.businessDate}, ${registerDayOrder}, ${opdAppointments.id}) >
              (${page.cursor.businessDate}::date, ${page.cursor.dayOrderAt}::timestamptz, ${page.cursor.id})`
          : undefined,
      ),
    )
    .orderBy(asc(opdAppointments.businessDate), asc(registerDayOrder), asc(opdAppointments.id))
    .$dynamic();

  return page ? query.limit(page.limit + 1) : query;
}

export function opdRegisterRow({
  cursorDayOrderAt: _cursorDayOrderAt,
  ...row
}: Awaited<ReturnType<typeof opdRegisterRows>>[number]) {
  return { ...row, outstanding: row.billed - row.credits - row.paid + row.refunds };
}

/** Whole-period counts and money, grouped by status in one scan. */
export async function opdRegisterTotals(orgId: string, period: Period) {
  const register = opdRegisterRows(orgId, period).as("register");

  const groups = await db
    .select({
      status: register.status,
      count: sql<number>`count(*)::int`,
      billed: sql`sum(${register.billed})::bigint`.mapWith(BigInt),
      paid: sql`sum(${register.paid})::bigint`.mapWith(BigInt),
      credits: sql`sum(${register.credits})::bigint`.mapWith(BigInt),
      refunds: sql`sum(${register.refunds})::bigint`.mapWith(BigInt),
    })
    .from(register)
    .groupBy(register.status);

  const totals = {
    appointments: 0,
    byStatus: { booked: 0, checked_in: 0, cancelled: 0, no_show: 0 },
    billed: 0n,
    paid: 0n,
    credits: 0n,
    refunds: 0n,
  };

  for (const group of groups) {
    totals.appointments += group.count;
    totals.byStatus[group.status] = group.count;
    totals.billed += group.billed;
    totals.paid += group.paid;
    totals.credits += group.credits;
    totals.refunds += group.refunds;
  }

  return {
    ...totals,
    outstanding: totals.billed - totals.credits - totals.paid + totals.refunds,
  };
}

const gstInput = periodInput.extend({
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z
    .object({ date: reportDate, number: z.string().min(1), id: z.string().min(1) })
    .optional(),
});

type GstCursor = NonNullable<z.infer<typeof gstInput>["cursor"]>;

/**
 * Per-document, per-rate buckets from the stored Business Date, never `createdAt`
 * reinterpreted through the current timezone. Only the listed documents when given.
 */
async function gstBuckets(
  orgId: string,
  period: Period,
  only?: { invoiceIds: string[]; creditNoteIds: string[] },
): Promise<GstBucket[]> {
  const [invoiceBuckets, creditNoteBuckets] = await Promise.all([
    only?.invoiceIds.length === 0
      ? []
      : db
          .select({
            documentId: invoices.id,
            number: invoices.invoiceNumber,
            date: invoices.businessDate,
            patientName: invoices.patientName,
            patientMrn: invoices.patientMrn,
            taxRatePercent: invoiceLines.taxRatePercent,
            taxCode: invoiceLines.taxCode,
            taxableValue: sql`sum(${invoiceLines.taxableValue})::bigint`.mapWith(BigInt),
            taxAmount: sql`sum(${invoiceLines.taxAmount})::bigint`.mapWith(BigInt),
            gross: sql`sum(${invoiceLines.gross})::bigint`.mapWith(BigInt),
          })
          .from(invoices)
          .innerJoin(
            invoiceLines,
            and(eq(invoiceLines.invoiceId, invoices.id), eq(invoiceLines.orgId, orgId)),
          )
          .where(
            and(
              eq(invoices.orgId, orgId),
              gte(invoices.businessDate, period.from),
              lte(invoices.businessDate, period.to),
              only ? inArray(invoices.id, only.invoiceIds) : undefined,
            ),
          )
          .groupBy(
            invoices.id,
            invoices.invoiceNumber,
            invoices.businessDate,
            invoices.patientName,
            invoices.patientMrn,
            invoiceLines.taxRatePercent,
            invoiceLines.taxCode,
          ),
    only?.creditNoteIds.length === 0
      ? []
      : db
          .select({
            documentId: creditNotes.id,
            number: creditNotes.creditNoteNumber,
            date: creditNotes.businessDate,
            patientName: invoices.patientName,
            patientMrn: invoices.patientMrn,
            taxRatePercent: invoiceLines.taxRatePercent,
            taxCode: invoiceLines.taxCode,
            taxableValue: sql`sum(${creditNoteLines.taxableValue})::bigint`.mapWith(BigInt),
            taxAmount: sql`sum(${creditNoteLines.taxAmount})::bigint`.mapWith(BigInt),
            gross: sql`sum(${creditNoteLines.gross})::bigint`.mapWith(BigInt),
          })
          .from(creditNotes)
          .innerJoin(
            invoices,
            and(eq(invoices.id, creditNotes.invoiceId), eq(invoices.orgId, orgId)),
          )
          .innerJoin(
            creditNoteLines,
            and(eq(creditNoteLines.creditNoteId, creditNotes.id), eq(creditNoteLines.orgId, orgId)),
          )
          .innerJoin(
            invoiceLines,
            and(eq(invoiceLines.id, creditNoteLines.invoiceLineId), eq(invoiceLines.orgId, orgId)),
          )
          .where(
            and(
              eq(creditNotes.orgId, orgId),
              gte(creditNotes.businessDate, period.from),
              lte(creditNotes.businessDate, period.to),
              only ? inArray(creditNotes.id, only.creditNoteIds) : undefined,
            ),
          )
          .groupBy(
            creditNotes.id,
            creditNotes.creditNoteNumber,
            creditNotes.businessDate,
            invoices.patientName,
            invoices.patientMrn,
            invoiceLines.taxRatePercent,
            invoiceLines.taxCode,
          ),
  ]);

  return [
    ...invoiceBuckets.map((row) => ({ ...row, docType: "invoice" as const })),
    ...creditNoteBuckets.map((row) => ({ ...row, docType: "credit_note" as const })),
  ];
}

/** The whole period: every document and the rate, HSN/SAC and total summaries. */
export async function gstReport(orgId: string, period: Period) {
  assertValidPeriod(period.from, period.to, GST_BOUND);

  return buildGstReport({ ...period, buckets: await gstBuckets(orgId, period) });
}

/**
 * One page of documents in `buildGstReport` order (date, number, id; byte order),
 * so a document's CGST/SGST split matches the whole-period report.
 */
async function gstDocumentPage(
  orgId: string,
  period: Period,
  page: { limit: number; cursor?: GstCursor },
) {
  const listed = await db.execute<{
    docType: "invoice" | "credit_note";
    id: string;
    number: string;
    date: string;
  }>(sql`
    select "docType", id, number, "businessDate"::text as date
    from (
      select 'invoice' as "docType", ${invoices.id} as id, ${invoices.invoiceNumber} as number,
             ${invoices.businessDate} as "businessDate"
      from ${invoices}
      where ${invoices.orgId} = ${orgId}
        and ${invoices.businessDate} between ${period.from} and ${period.to}
      union all
      select 'credit_note', ${creditNotes.id}, ${creditNotes.creditNoteNumber},
             ${creditNotes.businessDate}
      from ${creditNotes}
      where ${creditNotes.orgId} = ${orgId}
        and ${creditNotes.businessDate} between ${period.from} and ${period.to}
    ) document
    ${
      page.cursor
        ? sql`where ("businessDate", number collate "C", id collate "C") >
            (${page.cursor.date}::date, ${page.cursor.number} collate "C", ${page.cursor.id} collate "C")`
        : sql``
    }
    order by "businessDate", number collate "C", id collate "C"
    limit ${page.limit + 1}
  `);

  const rows = listed.rows.slice(0, page.limit);
  const last = rows.at(-1);

  const buckets = await gstBuckets(orgId, period, {
    invoiceIds: rows.filter((row) => row.docType === "invoice").map((row) => row.id),
    creditNoteIds: rows.filter((row) => row.docType === "credit_note").map((row) => row.id),
  });

  return {
    documents: buildGstReport({ ...period, buckets }).documents,
    nextCursor:
      listed.rows.length > page.limit && last
        ? { date: last.date, number: last.number, id: last.id }
        : null,
  };
}

export const reportRouter = {
  invoiceRegister: orgProcedure({ report: ["readFinancial"] }, invoiceRegisterInput).handler(
    async ({ context, input }) => {
      const orgId = context.scope.orgId;
      const filter = registerFilter(orgId, input);
      const generatedAt = new Date();

      const [base, summary] = await Promise.all([
        registerRows(orgId, filter, input),
        // Later pages reuse the first page's whole-filter summary.
        input.cursor ? null : registerSummary(orgId, filter),
      ]);

      const page = base.slice(0, input.limit);
      const last = page.at(-1);

      return {
        from: input.from,
        to: input.to,
        generatedAt,
        rows: page.map(registerRow),
        summary,
        nextCursor:
          base.length > input.limit && last
            ? { businessDate: last.businessDate, createdAt: last.cursorCreatedAt, id: last.id }
            : null,
      };
    },
  ),

  revenueSignals: orgProcedure({ report: ["readFinancial"] }, revenueSignalsInput).handler(
    async ({ context, input }) => {
      assertValidPeriod(input.from, input.to, REVENUE_BOUND);
      const orgId = context.scope.orgId;
      const { timeZone } = await readOrgSettings(orgId);
      const generatedAt = new Date();
      const source = signalSource(input.kind, orgId, input, timeZone);

      const [page, summary] = await Promise.all([
        signalRows(source, input.limit + 1, input.cursor),
        // Later pages reuse the first page's whole-period summary.
        input.cursor ? null : signalSummary(source, input.kind),
      ]);

      const rows = page.slice(0, input.limit);
      const last = rows.at(-1);

      return {
        from: input.from,
        to: input.to,
        kind: input.kind,
        generatedAt,
        basis: SIGNAL_BASIS[input.kind],
        rows,
        summary,
        nextCursor:
          page.length > input.limit && last ? { eventAt: last.eventAt, id: last.id } : null,
      };
    },
  ),

  expiryExposure: orgProcedure({ report: ["readFinancial"] }, expiryExposureInput).handler(
    async ({ context, input }) => {
      const orgId = context.scope.orgId;
      const { timeZone } = await readOrgSettings(orgId);
      const generatedAt = new Date();
      const today = businessDate(generatedAt, timeZone);
      const through = shiftDate(today, input.horizonDays);

      const stock = await db
        .select({
          batchId: stockBatches.id,
          productId: products.id,
          productName: products.name,
          batchNumber: stockBatches.batchNumber,
          expiryDate: stockBatches.expiryDate,
          mrp: stockBatches.mrp,
          mrpUnits: stockBatches.mrpUnits,
          bucket: stockMovements.bucket,
          quantity: sql`sum(${stockMovements.qty})::integer`.mapWith(Number),
        })
        .from(stockBatches)
        .innerJoin(
          products,
          and(eq(products.id, stockBatches.productId), eq(products.orgId, orgId)),
        )
        .innerJoin(
          stockMovements,
          and(eq(stockMovements.batchId, stockBatches.id), eq(stockMovements.orgId, orgId)),
        )
        .where(
          and(
            eq(stockBatches.orgId, orgId),
            or(isNull(stockBatches.expiryDate), lte(stockBatches.expiryDate, through)),
          ),
        )
        .groupBy(stockBatches.id, products.id, stockMovements.bucket)
        .having(sql`sum(${stockMovements.qty})<>0`)
        .orderBy(asc(stockBatches.expiryDate), asc(stockBatches.id), asc(stockMovements.bucket));

      const noExpiry = new Set<string>();
      const totals = { shelf: 0n, quarantine: 0n, expired: 0n, upcoming: 0n };
      const rows = [];

      for (const row of stock) {
        if (row.quantity < 0)
          throw new Error(`Negative stock in batch ${row.batchId}/${row.bucket}`);

        if (row.expiryDate === null) {
          noExpiry.add(row.batchId);
          continue;
        }

        const status = row.expiryDate < today ? ("expired" as const) : ("upcoming" as const);
        const exposure = divideHalfUp(row.mrp * BigInt(row.quantity), BigInt(row.mrpUnits));
        totals[row.bucket] += exposure;
        totals[status] += exposure;
        rows.push({
          batchId: row.batchId,
          productId: row.productId,
          productName: row.productName,
          batchNumber: row.batchNumber,
          expiryDate: row.expiryDate,
          bucket: row.bucket,
          quantity: row.quantity,
          exposure,
          status,
        });
      }

      return {
        generatedAt,
        today,
        through,
        horizonDays: input.horizonDays,
        basis: "MRP exposure, not purchase cost or inventory valuation",
        rows,
        totals,
        noExpiryBatchCount: noExpiry.size,
      };
    },
  ),

  revenueBreakdown: orgProcedure({ report: ["readFinancial"] }, periodInput).handler(
    async ({ context, input }) => {
      assertValidPeriod(input.from, input.to, REVENUE_BOUND);
      const orgId = context.scope.orgId;

      const [activity, rounding, bridgeResult] = await Promise.all([
        db.execute<{
          stream: "opd" | "pharmacy";
          practitionerId: string | null;
          practitionerName: string | null;
          category: string | null;
          issued: string;
          credited: string;
          tax: string;
        }>(sql`
          with activity as (
            select ${invoices.stream} as stream, ${opdAppointments.practitionerId} as practitioner_id,
              ${practitioners.name} as practitioner_name, ${invoiceLines.revenueCategory} as category,
              ${invoiceLines.taxableValue} as issued, 0::bigint as credited, ${invoiceLines.taxAmount} as tax
            from ${invoiceLines} inner join ${invoices}
              on ${invoices.id}=${invoiceLines.invoiceId} and ${invoices.orgId}=${orgId}
            left join ${pharmacySales} on ${pharmacySales.id}=${invoices.pharmacySaleId} and ${pharmacySales.orgId}=${orgId}
            left join ${opdAppointments}
              on ${opdAppointments.id}=coalesce(${invoices.opdAppointmentId},${pharmacySales.opdAppointmentId})
              and ${opdAppointments.orgId}=${orgId}
            left join ${practitioners} on ${practitioners.id}=${opdAppointments.practitionerId} and ${practitioners.orgId}=${orgId}
            where ${invoiceLines.orgId}=${orgId} and ${invoices.businessDate} between ${input.from} and ${input.to}
            union all
            select ${invoices.stream},${opdAppointments.practitionerId},${practitioners.name},
              ${invoiceLines.revenueCategory},0::bigint,${creditNoteLines.taxableValue},-${creditNoteLines.taxAmount}
            from ${creditNoteLines} inner join ${creditNotes}
              on ${creditNotes.id}=${creditNoteLines.creditNoteId} and ${creditNotes.orgId}=${orgId}
            inner join ${invoiceLines} on ${invoiceLines.id}=${creditNoteLines.invoiceLineId} and ${invoiceLines.orgId}=${orgId}
            inner join ${invoices} on ${invoices.id}=${creditNotes.invoiceId} and ${invoices.orgId}=${orgId}
            left join ${pharmacySales} on ${pharmacySales.id}=${invoices.pharmacySaleId} and ${pharmacySales.orgId}=${orgId}
            left join ${opdAppointments}
              on ${opdAppointments.id}=coalesce(${invoices.opdAppointmentId},${pharmacySales.opdAppointmentId})
              and ${opdAppointments.orgId}=${orgId}
            left join ${practitioners} on ${practitioners.id}=${opdAppointments.practitionerId} and ${practitioners.orgId}=${orgId}
            where ${creditNoteLines.orgId}=${orgId} and ${creditNotes.businessDate} between ${input.from} and ${input.to}
          )
          select stream,practitioner_id as "practitionerId",practitioner_name as "practitionerName",category,
            sum(issued)::text as issued,sum(credited)::text as credited,sum(tax)::text as tax
          from activity group by stream,practitioner_id,practitioner_name,category
        `),
        db.execute<{ stream: "opd" | "pharmacy"; roundOff: string }>(sql`
          select stream,sum(amount)::text as "roundOff" from (
            select ${invoices.stream} as stream,${invoices.roundOff} as amount from ${invoices}
              where ${invoices.orgId}=${orgId} and ${invoices.businessDate} between ${input.from} and ${input.to}
            union all
            select ${invoices.stream},-${creditNotes.roundOff} from ${creditNotes} inner join ${invoices}
              on ${invoices.id}=${creditNotes.invoiceId} and ${invoices.orgId}=${orgId}
              where ${creditNotes.orgId}=${orgId} and ${creditNotes.businessDate} between ${input.from} and ${input.to}
          ) documents group by stream
        `),
        db.execute<{ older: string; later: string; allPeriodCredits: string }>(sql`
          select coalesce(sum(case when ${creditNotes.businessDate} between ${input.from} and ${input.to}
            and ${invoices.businessDate}<${input.from} then ${creditNoteLines.taxableValue} else 0 end),0)::text as older,
            coalesce(sum(case when ${invoices.businessDate} between ${input.from} and ${input.to}
              and ${creditNotes.businessDate}>${input.to} then ${creditNoteLines.taxableValue} else 0 end),0)::text as later,
            coalesce(sum(case when ${invoices.businessDate} between ${input.from} and ${input.to}
              then ${creditNoteLines.taxableValue} else 0 end),0)::text as "allPeriodCredits"
          from ${creditNoteLines} inner join ${creditNotes}
            on ${creditNotes.id}=${creditNoteLines.creditNoteId} and ${creditNotes.orgId}=${orgId}
          inner join ${invoices} on ${invoices.id}=${creditNotes.invoiceId} and ${invoices.orgId}=${orgId}
          where ${creditNoteLines.orgId}=${orgId}
            and (${invoices.businessDate} between ${input.from} and ${input.to}
              or ${creditNotes.businessDate} between ${input.from} and ${input.to})
        `),
      ]);

      type Bucket = {
        id: string | null;
        label: string;
        issuedTaxableValue: bigint;
        creditedTaxableValue: bigint;
        netTaxableValue: bigint;
        tax: bigint;
        roundOff: bigint;
      };

      const bucket = (id: string | null, label: string): Bucket => ({
        id,
        label,
        issuedTaxableValue: 0n,
        creditedTaxableValue: 0n,
        netTaxableValue: 0n,
        tax: 0n,
        roundOff: 0n,
      });

      const streams = new Map<string, Bucket>();
      const doctors = new Map<string | null, Bucket>();
      const categories = new Map<string | null, Bucket>();
      const totals = bucket(null, "Total");

      for (const row of activity.rows) {
        const stream =
          streams.get(row.stream) ?? bucket(row.stream, row.stream === "opd" ? "OPD" : "Pharmacy");

        const practitioner =
          doctors.get(row.practitionerId) ??
          bucket(row.practitionerId, row.practitionerName ?? "Unassigned");

        const category =
          categories.get(row.category) ?? bucket(row.category, row.category ?? "Unassigned");

        for (const target of [stream, practitioner, category, totals]) {
          target.issuedTaxableValue += BigInt(row.issued);
          target.creditedTaxableValue += BigInt(row.credited);
          target.netTaxableValue += BigInt(row.issued) - BigInt(row.credited);
          target.tax += BigInt(row.tax);
        }

        streams.set(row.stream, stream);
        doctors.set(row.practitionerId, practitioner);
        categories.set(row.category, category);
      }

      for (const row of rounding.rows) {
        const stream =
          streams.get(row.stream) ?? bucket(row.stream, row.stream === "opd" ? "OPD" : "Pharmacy");

        stream.roundOff = BigInt(row.roundOff);
        streams.set(row.stream, stream);
        totals.roundOff += stream.roundOff;
      }

      const bridge = bridgeResult.rows[0];

      if (!bridge) throw new Error("Revenue correction bridge missing");

      const sorted = (buckets: Iterable<Bucket>) =>
        [...buckets].sort(
          (a, b) => a.label.localeCompare(b.label) || (a.id ?? "").localeCompare(b.id ?? ""),
        );

      return {
        from: input.from,
        to: input.to,
        byStream: sorted(streams.values()),
        byPractitioner: sorted(doctors.values()),
        byCategory: sorted(categories.values()),
        totals,
        bridge: {
          creditsToOlderInvoices: BigInt(bridge.older),
          laterCreditsAgainstPeriodInvoices: BigInt(bridge.later),
          registerNetTaxableValue: totals.issuedTaxableValue - BigInt(bridge.allPeriodCredits),
        },
      };
    },
  ),

  trialBalance: orgProcedure({ report: ["readFinancial"] }, periodInput).handler(
    async ({ context, input }) => {
      assertValidPeriod(input.from, input.to);

      const [openingRows, activityRows] = await Promise.all([
        accountAggregates(context.scope.orgId, lt(journalEntries.entryDate, input.from)),
        accountAggregates(
          context.scope.orgId,
          gte(journalEntries.entryDate, input.from),
          lte(journalEntries.entryDate, input.to),
        ),
      ]);

      return buildTrialBalance({
        from: input.from,
        to: input.to,
        openingRows,
        activityRows,
      });
    },
  ),

  balanceSheet: orgProcedure({ report: ["readFinancial"] }, asOfInput).handler(
    async ({ context, input }) => {
      const aggregates = await accountAggregates(
        context.scope.orgId,
        lte(journalEntries.entryDate, input.asOf),
      );

      return buildBalanceSheet({ asOf: input.asOf, aggregates });
    },
  ),

  dailyCollections: orgProcedure({ report: ["readDailyCollections"] }, periodInput).handler(
    async ({ context, input }) => {
      assertValidPeriod(input.from, input.to, COLLECTIONS_BOUND);
      const orgId = context.scope.orgId;

      // One row per date, method, and kind; a refund's kind follows its source document.
      const movements = await db.execute<{
        businessDate: string;
        method: PaymentMethod;
        kind: "payments" | "advances" | "refunds" | "advanceRefunds";
        amount: string;
      }>(sql`
        select business_date::text as "businessDate", method, kind, sum(amount)::bigint as amount
        from (
          select ${payments.businessDate} as business_date, ${payments.method} as method,
                 'payments'::text as kind, ${payments.amount} as amount
          from ${payments}
          where ${payments.orgId} = ${orgId}
            and ${payments.businessDate} between ${input.from} and ${input.to}
          union all
          select ${advanceReceipts.businessDate}, ${advanceReceipts.method}, 'advances',
                 ${advanceReceipts.amount}
          from ${advanceReceipts}
          where ${advanceReceipts.orgId} = ${orgId}
            and ${advanceReceipts.businessDate} between ${input.from} and ${input.to}
          union all
          select ${refunds.businessDate}, ${refunds.method},
                 case when ${refunds.advanceReceiptId} is null then 'refunds' else 'advanceRefunds' end,
                 ${refunds.amount}
          from ${refunds}
          where ${refunds.orgId} = ${orgId}
            and ${refunds.businessDate} between ${input.from} and ${input.to}
        ) movement
        group by business_date, method, kind
        order by business_date
      `);

      const empty = () => ({ payments: 0n, advances: 0n, refunds: 0n, advanceRefunds: 0n });

      const net = (amounts: ReturnType<typeof empty>) =>
        amounts.payments + amounts.advances - amounts.refunds - amounts.advanceRefunds;

      const totals = empty();
      const methodTotals = perMethod(empty);

      const days = new Map<
        string,
        { businessDate: string; byMethod: Record<PaymentMethod, bigint> } & ReturnType<typeof empty>
      >();

      for (const row of movements.rows) {
        const amount = BigInt(row.amount);

        const day = days.get(row.businessDate) ?? {
          businessDate: row.businessDate,
          byMethod: perMethod(() => 0n),
          ...empty(),
        };

        day[row.kind] += amount;
        day.byMethod[row.method] +=
          row.kind === "payments" || row.kind === "advances" ? amount : -amount;
        methodTotals[row.method][row.kind] += amount;
        totals[row.kind] += amount;
        days.set(row.businessDate, day);
      }

      return {
        from: input.from,
        to: input.to,
        rows: [...days.values()].map((day) => ({ ...day, net: net(day) })),
        byMethod: PAYMENT_METHODS.map((method) => ({
          method,
          ...methodTotals[method],
          net: net(methodTotals[method]),
        })),
        totals: { ...totals, net: net(totals) },
      };
    },
  ),

  opdRegister: orgProcedure({ report: ["readOpdRegister"] }, opdRegisterInput).handler(
    async ({ context, input }) => {
      const { scope } = context;
      await settleOpdRegister(scope, input);

      const [selected, totals] = await Promise.all([
        opdRegisterRows(scope.orgId, input, input),
        // Later pages reuse the first page's whole-period totals.
        input.cursor ? null : opdRegisterTotals(scope.orgId, input),
      ]);

      const rows = selected.slice(0, input.limit);
      const last = rows.at(-1);

      return {
        from: input.from,
        to: input.to,
        rows: rows.map(opdRegisterRow),
        totals,
        nextCursor:
          selected.length > input.limit && last
            ? {
                businessDate: last.businessDate,
                dayOrderAt: last.cursorDayOrderAt,
                id: last.appointmentId,
              }
            : null,
      };
    },
  ),

  gst: orgProcedure({ report: ["readFinancial"] }, gstInput).handler(async ({ context, input }) => {
    assertValidPeriod(input.from, input.to, GST_BOUND);
    const orgId = context.scope.orgId;

    const [page, summary] = await Promise.all([
      gstDocumentPage(orgId, input, input),
      // Later pages reuse the first page's whole-period summaries.
      input.cursor ? null : gstReport(orgId, input),
    ]);

    return {
      from: input.from,
      to: input.to,
      documents: page.documents,
      summary: summary && {
        rateSummary: summary.rateSummary,
        hsnSummary: summary.hsnSummary,
        totals: summary.totals,
      },
      nextCursor: page.nextCursor,
    };
  }),
};
