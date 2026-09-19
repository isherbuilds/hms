import { db } from "@hms/db";
import { advanceAllocations } from "@hms/db/schema/advance-allocations";
import { user } from "@hms/db/schema/auth";
import { catalogItems } from "@hms/db/schema/catalog-items";
import { charges } from "@hms/db/schema/charges";
import { creditNoteLines } from "@hms/db/schema/credit-note-lines";
import { creditNotes } from "@hms/db/schema/credit-notes";
import { invoiceLines } from "@hms/db/schema/invoice-lines";
import { invoices } from "@hms/db/schema/invoices";
import { products } from "@hms/db/schema/products";
import { opdAppointments } from "@hms/db/schema/opd-appointments";
import { patients } from "@hms/db/schema/patients";
import { payments } from "@hms/db/schema/payments";
import { pharmacyReturnLines } from "@hms/db/schema/pharmacy-return-lines";
import { pharmacyReturns, RETURN_REASON_CODES } from "@hms/db/schema/pharmacy-returns";
import { pharmacySales } from "@hms/db/schema/pharmacy-sales";
import { refunds } from "@hms/db/schema/refunds";
import { stockBatches } from "@hms/db/schema/stock-batches";
import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { audit } from "../audit";
import { divideHalfUp, formatDecimal } from "../core/money";
import {
  billingDocumentContext,
  insertRefundTx,
  issueInvoiceTx,
  lockInvoice,
  postCreditNoteTx,
  recordPaymentsTx,
  type CreditNoteLineRequest,
  type InvoiceParent,
} from "../lib/billing-documents";
import { businessDate } from "../lib/business-date";
import { impossible } from "../lib/conflict";
import { invoiceBalanceFor } from "../lib/invoice-balance";
import { calculateInvoiceBalance } from "../lib/invoice-math";
import { orgInput, orgProcedure } from "../lib/procedures/factory";
import {
  dayRange,
  money,
  note,
  paymentLine,
  pageLimit,
  personName,
  phone,
  resolveDayRange,
} from "../lib/schemas";
import { readOrgSettings } from "../lib/settings-cache";
import { insertStockMovements, lockBatchStock } from "../lib/stock";
import { pharmacyStockRouter } from "./pharmacy-stock";

/** Sums the desk's lines per batch: two lines on one batch must not each pass alone. */
function aggregateByBatch(lines: ReadonlyArray<{ batchId: string; qty: number }>) {
  const wanted = new Map<string, number>();

  for (const line of lines) {
    wanted.set(line.batchId, (wanted.get(line.batchId) ?? 0) + line.qty);
  }

  return wanted;
}

export const pharmacyRouter = {
  ...pharmacyStockRouter,

  sell: orgProcedure(
    { pharmacy: ["sell"] },
    orgInput.extend({
      lines: z.array(z.object({ batchId: z.string(), qty: z.number().int().positive() })).min(1),
      buyer: z.union([
        z.object({ patientId: z.string() }),
        z.object({ name: personName, phone: phone.optional() }),
      ]),
      forName: personName.optional(),
      prescriberName: personName.optional(),
      prescriptionReference: z.string().trim().max(100).optional(),
      opdAppointmentId: z.string().optional(),
      discountAmount: money.default(0n),
      note,
      payments: z.array(paymentLine).max(4).default([]),
      applyCredit: money.default(0n),
      expectedGrandTotal: money,
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;

    const { settings, now, fiscalYear } = await billingDocumentContext(scope.orgId);
    const today = businessDate(now, settings.timeZone);
    const saleId = Bun.randomUUIDv7();
    const invoiceId = Bun.randomUUIDv7();

    const buyer = await (async () => {
      if (!("patientId" in input.buyer)) {
        return {
          id: null,
          name: input.buyer.name,
          mrn: null,
          phone: input.buyer.phone ?? null,
        };
      }

      const [patient] = await db
        .select({ id: patients.id, name: patients.name, mrn: patients.mrn, phone: patients.phone })
        .from(patients)
        .where(and(eq(patients.orgId, scope.orgId), eq(patients.id, input.buyer.patientId)))
        .limit(1);

      if (!patient) {
        throw new ORPCError("NOT_FOUND", { message: "That patient no longer exists." });
      }

      return patient;
    })();

    if (input.applyCredit > 0n && buyer.id === null) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Patient credit needs a patient on the sale",
      });
    }

    if (input.opdAppointmentId && buyer.id === null) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Name the patient to link this sale to a visit",
      });
    }

    const collected = input.payments.reduce((sum, payment) => sum + payment.amount, 0n);

    const result = await db.transaction(async (tx) => {
      if (input.opdAppointmentId) {
        const [appointment] = await tx
          .select({ patientId: opdAppointments.patientId })
          .from(opdAppointments)
          .where(
            and(
              eq(opdAppointments.orgId, scope.orgId),
              eq(opdAppointments.id, input.opdAppointmentId),
            ),
          )
          .limit(1)
          .for("update");

        if (!appointment || appointment.patientId !== buyer.id) {
          throw new ORPCError("CONFLICT", {
            message: "That visit belongs to another patient.",
          });
        }
      }

      await tx.insert(pharmacySales).values({
        id: saleId,
        orgId: scope.orgId,
        patientId: buyer.id,
        opdAppointmentId: input.opdAppointmentId ?? null,
        buyerName: buyer.name,
        buyerPhone: buyer.phone,
        forName: input.forName ?? buyer.name,
        prescriberName: input.prescriberName ?? null,
        prescriptionReference: input.prescriptionReference ?? null,
        note: input.note ?? null,
        soldBy: scope.userId,
        createdAt: now,
      });

      const batchIds = [...new Set(input.lines.map((line) => line.batchId))];

      const rows = await tx
        .select({
          batchId: stockBatches.id,
          batchNumber: stockBatches.batchNumber,
          expiryDate: stockBatches.expiryDate,
          mrp: stockBatches.mrp,
          productId: products.id,
          schedule: products.schedule,
          catalogItemId: catalogItems.id,
          name: products.name,
          active: catalogItems.active,
          taxRatePercent: catalogItems.taxRatePercent,
          taxCode: catalogItems.taxCode,
        })
        .from(stockBatches)
        .innerJoin(
          products,
          and(eq(products.orgId, scope.orgId), eq(products.id, stockBatches.productId)),
        )
        .innerJoin(
          catalogItems,
          and(eq(catalogItems.orgId, scope.orgId), eq(catalogItems.id, products.catalogItemId)),
        )
        .where(and(eq(stockBatches.orgId, scope.orgId), inArray(stockBatches.id, batchIds)));

      if (rows.length !== batchIds.length) {
        throw new ORPCError("NOT_FOUND", { message: "That batch no longer exists." });
      }

      const batchById = new Map(rows.map((row) => [row.batchId, row]));

      for (const batch of rows) {
        if (batch.expiryDate < today) {
          throw new ORPCError("BAD_REQUEST", {
            message: `${batch.name} batch ${batch.batchNumber} has expired`,
          });
        }

        if (!batch.active) {
          throw new ORPCError("BAD_REQUEST", { message: `${batch.name} is no longer sold` });
        }

        if (batch.schedule === "x") {
          throw new ORPCError("BAD_REQUEST", {
            message: `${batch.name} is a Schedule X medicine and is not sold here`,
          });
        }

        // `forName` defaults to the buyer, so the H1 register only lacks the prescriber.
        if (batch.schedule === "h1" && !input.prescriberName) {
          throw new ORPCError("BAD_REQUEST", {
            message: `${batch.name} needs the prescriber's name`,
          });
        }
      }

      await tx.insert(charges).values(
        input.lines.map((line) => {
          const batch = batchById.get(line.batchId);

          if (!batch) throw impossible(`batch ${line.batchId} vanished after its read`);

          return {
            id: Bun.randomUUIDv7(),
            orgId: scope.orgId,
            opdAppointmentId: null,
            pharmacySaleId: saleId,
            catalogItemId: batch.catalogItemId,
            description: `${batch.name} · batch ${batch.batchNumber}`,
            unitPrice: batch.mrp,
            taxRatePercent: batch.taxRatePercent,
            taxCode: batch.taxCode,
            revenueCategory: "pharmacy" as const,
            qty: line.qty,
            sourceType: "pharmacy_batch" as const,
            sourceId: line.batchId,
            status: "pending" as const,
            createdBy: scope.userId,
            createdAt: now,
            updatedAt: now,
          };
        }),
      );

      const wanted = aggregateByBatch(input.lines);
      const onHand = await lockBatchStock(tx, scope.orgId, [...wanted.keys()]);

      for (const [batchId, qty] of wanted) {
        const stock = onHand.get(batchId);
        const batch = batchById.get(batchId);

        if (!stock || !batch) throw impossible(`locked batch ${batchId} has no stock row`);

        if (stock.shelf - qty < 0) {
          throw new ORPCError("CONFLICT", {
            message: `${batch.name} batch ${batch.batchNumber} has only ${stock.shelf} left`,
          });
        }
      }

      const parent: InvoiceParent = {
        stream: "pharmacy",
        pharmacySaleId: saleId,
        patient: {
          id: buyer.id,
          name: buyer.name,
          mrn: buyer.mrn,
          phone: buyer.phone,
          address: null,
          guardian: null,
        },
      };

      const issued = await issueInvoiceTx(tx, {
        scope,
        parent,
        discountAmount: input.discountAmount,
        note: input.note,
        settings,
        now,
        fiscalYear,
        invoiceId,
      });

      if (issued.invoice.grandTotal !== input.expectedGrandTotal) {
        throw new ORPCError("CONFLICT", {
          message: "The prices changed. Review the sale and try again",
        });
      }

      const settled = collected + input.applyCredit;

      if (settled > issued.invoice.grandTotal) {
        throw new ORPCError("BAD_REQUEST", {
          message: "That payment is more than the sale comes to",
        });
      }

      if (buyer.id === null && settled !== issued.invoice.grandTotal) {
        throw new ORPCError("BAD_REQUEST", {
          message: "A counter sale without a patient is paid in full",
        });
      }

      if (settled < issued.invoice.grandTotal && !input.note) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Add a note for the amount left owing",
        });
      }

      const recordedPayments =
        input.payments.length > 0 || input.applyCredit > 0n
          ? await recordPaymentsTx(tx, {
              scope,
              invoiceId,
              payments: input.payments,
              applyCredit: input.applyCredit,
              settings,
              now,
              fiscalYear,
            })
          : [];

      await insertStockMovements(tx, {
        orgId: scope.orgId,
        userId: scope.userId,
        now,
        rows: [...wanted].map(([batchId, qty]) => ({
          batchId,
          bucket: "shelf" as const,
          qty: -qty,
          reason: "sale" as const,
          sourceType: "pharmacy_sale" as const,
          sourceId: saleId,
          note: null,
        })),
      });

      return { invoice: issued.invoice, payments: recordedPayments };
    });

    audit({
      action: "pharmacy.sell",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `pharmacySale:${saleId}`,
      meta: {
        invoiceNumber: result.invoice.invoiceNumber,
        grandTotal: formatDecimal(result.invoice.grandTotal),
      },
    });

    for (const payment of result.payments) {
      audit({
        action: "payment.record",
        actorId: scope.userId,
        orgId: scope.orgId,
        target: `payment:${payment.id}`,
        meta: { receiptNumber: payment.receiptNumber, amount: formatDecimal(payment.amount) },
      });
    }

    return {
      saleId,
      invoiceId,
      invoiceNumber: result.invoice.invoiceNumber,
      payments: result.payments,
    };
  }),

  returnSale: orgProcedure(
    { pharmacy: ["return"] },
    orgInput.extend({
      saleId: z.string(),
      reasonCode: z.enum(RETURN_REASON_CODES),
      note,
      lines: z
        .array(z.object({ invoiceLineId: z.string(), qty: z.number().int().positive() }))
        .min(1),
      refund: paymentLine.optional(),
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const requestedIds = input.lines.map((line) => line.invoiceLineId);

    if (new Set(requestedIds).size !== requestedIds.length) {
      throw new ORPCError("BAD_REQUEST", { message: "Return each invoice line once" });
    }

    const [sale] = await db
      .select({ id: pharmacySales.id, invoiceId: invoices.id })
      .from(pharmacySales)
      .innerJoin(
        invoices,
        and(eq(invoices.orgId, scope.orgId), eq(invoices.pharmacySaleId, pharmacySales.id)),
      )
      .where(and(eq(pharmacySales.orgId, scope.orgId), eq(pharmacySales.id, input.saleId)))
      .limit(1);

    if (!sale) {
      throw new ORPCError("NOT_FOUND", { message: "That sale no longer exists." });
    }

    const { settings, now, fiscalYear } = await billingDocumentContext(scope.orgId);
    const returnId = Bun.randomUUIDv7();
    const creditNoteId = Bun.randomUUIDv7();

    const result = await db.transaction(async (tx) => {
      const invoice = await lockInvoice(tx, scope.orgId, sale.invoiceId);

      const [sourceLines, priorReturns, priorCredits] = await Promise.all([
        tx
          .select({
            id: invoiceLines.id,
            qty: invoiceLines.qty,
            taxableValue: invoiceLines.taxableValue,
            taxAmount: invoiceLines.taxAmount,
            gross: invoiceLines.gross,
            batchId: charges.sourceId,
          })
          .from(invoiceLines)
          .innerJoin(
            charges,
            and(eq(charges.orgId, scope.orgId), eq(charges.id, invoiceLines.chargeId)),
          )
          .where(
            and(
              eq(invoiceLines.orgId, scope.orgId),
              eq(invoiceLines.invoiceId, sale.invoiceId),
              inArray(invoiceLines.id, requestedIds),
            ),
          ),
        tx
          .select({
            invoiceLineId: pharmacyReturnLines.invoiceLineId,
            qty: sql<number>`sum(${pharmacyReturnLines.qty})::int`,
          })
          .from(pharmacyReturnLines)
          .where(
            and(
              eq(pharmacyReturnLines.orgId, scope.orgId),
              inArray(pharmacyReturnLines.invoiceLineId, requestedIds),
            ),
          )
          .groupBy(pharmacyReturnLines.invoiceLineId),
        tx
          .select({
            invoiceLineId: creditNoteLines.invoiceLineId,
            taxableValue: creditNoteLines.taxableValue,
            taxAmount: creditNoteLines.taxAmount,
            gross: creditNoteLines.gross,
          })
          .from(creditNoteLines)
          .innerJoin(
            creditNotes,
            and(
              eq(creditNotes.orgId, scope.orgId),
              eq(creditNotes.id, creditNoteLines.creditNoteId),
            ),
          )
          .where(
            and(
              eq(creditNoteLines.orgId, scope.orgId),
              eq(creditNotes.invoiceId, sale.invoiceId),
              inArray(creditNoteLines.invoiceLineId, requestedIds),
            ),
          ),
      ]);

      if (sourceLines.length !== requestedIds.length) {
        throw new ORPCError("NOT_FOUND", {
          message: "One of those invoice lines no longer exists.",
        });
      }

      const sourceById = new Map(sourceLines.map((line) => [line.id, line]));
      const returnedQtyByLine = new Map(priorReturns.map((row) => [row.invoiceLineId, row.qty]));

      const creditedByLine = new Map<
        string,
        { taxableValue: bigint; taxAmount: bigint; gross: bigint }
      >();

      for (const line of priorCredits) {
        const credited = creditedByLine.get(line.invoiceLineId) ?? {
          taxableValue: 0n,
          taxAmount: 0n,
          gross: 0n,
        };

        credited.taxableValue += line.taxableValue;
        credited.taxAmount += line.taxAmount;
        credited.gross += line.gross;
        creditedByLine.set(line.invoiceLineId, credited);
      }

      const computed = input.lines.map((line) => {
        const source = sourceById.get(line.invoiceLineId);

        if (!source) throw impossible(`invoice line ${line.invoiceLineId} vanished after its read`);

        if (source.batchId === null) throw impossible("a pharmacy charge without a batch");

        const alreadyReturned = returnedQtyByLine.get(source.id) ?? 0;

        if (alreadyReturned + line.qty > source.qty) {
          throw new ORPCError("BAD_REQUEST", {
            message: "That is more than was sold on this line",
          });
        }

        const prior = creditedByLine.get(source.id) ?? {
          taxableValue: 0n,
          taxAmount: 0n,
          gross: 0n,
        };

        // The last returnable unit takes the exact remainder, so a full return reverses
        // the line's taxable, tax and gross to the paisa.
        const credited =
          alreadyReturned + line.qty === source.qty
            ? {
                taxableValue: source.taxableValue - prior.taxableValue,
                taxAmount: source.taxAmount - prior.taxAmount,
                gross: source.gross - prior.gross,
              }
            : (() => {
                const share = BigInt(line.qty);
                const sold = BigInt(source.qty);
                const gross = divideHalfUp(source.gross * share, sold);
                const taxableValue = divideHalfUp(source.taxableValue * share, sold);

                return { taxableValue, taxAmount: gross - taxableValue, gross };
              })();

        return { invoiceLineId: source.id, batchId: source.batchId, qty: line.qty, ...credited };
      });

      const moneyLines: CreditNoteLineRequest[] = computed
        .filter((line) => line.gross > 0n)
        .map((line) => ({
          invoiceLineId: line.invoiceLineId,
          taxableValue: line.taxableValue,
          taxAmount: line.taxAmount,
          gross: line.gross,
        }));

      // A fully discounted line returns goods with no money, so there is nothing to credit.
      const creditNote =
        moneyLines.length > 0
          ? await postCreditNoteTx(tx, {
              scope,
              invoiceId: sale.invoiceId,
              reason: input.note ?? input.reasonCode,
              lines: moneyLines,
              settings,
              now,
              fiscalYear,
              creditNoteId,
            })
          : null;

      await tx.insert(pharmacyReturns).values({
        id: returnId,
        orgId: scope.orgId,
        pharmacySaleId: sale.id,
        invoiceId: sale.invoiceId,
        creditNoteId: creditNote ? creditNoteId : null,
        reasonCode: input.reasonCode,
        note: input.note ?? null,
        acceptedBy: scope.userId,
        createdAt: now,
      });

      await tx.insert(pharmacyReturnLines).values(
        computed.map((line) => ({
          id: Bun.randomUUIDv7(),
          orgId: scope.orgId,
          returnId,
          invoiceLineId: line.invoiceLineId,
          batchId: line.batchId,
          qty: line.qty,
          gross: line.gross,
        })),
      );

      const returning = aggregateByBatch(computed);

      await lockBatchStock(tx, scope.orgId, [...returning.keys()]);

      await insertStockMovements(tx, {
        orgId: scope.orgId,
        userId: scope.userId,
        now,
        rows: [...returning].map(([batchId, qty]) => ({
          batchId,
          bucket: "quarantine" as const,
          qty,
          reason: "return" as const,
          sourceType: "pharmacy_return" as const,
          sourceId: returnId,
          note: null,
        })),
      });

      if (!input.refund) return { creditNote, refund: null };

      if (!creditNote) {
        throw new ORPCError("BAD_REQUEST", {
          message: "There is nothing to refund on this return",
        });
      }

      if (input.refund.amount > creditNote.creditNote.total) {
        throw new ORPCError("BAD_REQUEST", {
          message: "That refund is more than this return is worth",
        });
      }

      const balance = await invoiceBalanceFor(tx, scope.orgId, invoice);
      const refundDue = balance.outstanding < 0n ? -balance.outstanding : 0n;

      if (input.refund.amount > refundDue) {
        throw new ORPCError("BAD_REQUEST", {
          message: "That refund is more than the invoice owes back.",
        });
      }

      const refund = await insertRefundTx(tx, {
        scope,
        settings,
        now,
        fiscalYear,
        refundId: Bun.randomUUIDv7(),
        line: input.refund,
        source: { invoiceId: sale.invoiceId, creditNoteId, advanceReceiptId: null },
        debit: "patient_receivables",
        narration: `Invoice ${invoice.invoiceNumber}`,
      });

      return { creditNote, refund };
    });

    audit({
      action: "pharmacy.return",
      actorId: scope.userId,
      orgId: scope.orgId,
      target: `pharmacyReturn:${returnId}`,
      meta: {
        reasonCode: input.reasonCode,
        total: formatDecimal(result.creditNote?.creditNote.total ?? 0n),
      },
    });

    return {
      returnId,
      creditNoteId: result.creditNote ? creditNoteId : null,
      creditNoteNumber: result.creditNote?.creditNote.creditNoteNumber ?? null,
      refund: result.refund,
    };
  }),

  getSale: orgProcedure({ pharmacy: ["read"] }, orgInput.extend({ saleId: z.string() })).handler(
    async ({ context, input }) => {
      const { scope } = context;

      // `user` is the global auth table: attribution only; the org predicate stays on the sale.
      const [row] = await db
        .select({ sale: pharmacySales, soldByName: user.name, invoice: invoices })
        .from(pharmacySales)
        .innerJoin(user, eq(user.id, pharmacySales.soldBy))
        .innerJoin(
          invoices,
          and(eq(invoices.orgId, scope.orgId), eq(invoices.pharmacySaleId, pharmacySales.id)),
        )
        .where(and(eq(pharmacySales.orgId, scope.orgId), eq(pharmacySales.id, input.saleId)))
        .limit(1);

      if (!row) {
        throw new ORPCError("NOT_FOUND", { message: "That sale no longer exists." });
      }

      const invoiceId = row.invoice.id;

      const [lines, salePayments, saleAllocations, noteRows, saleRefunds, returnRows] =
        await Promise.all([
          db
            .select({
              line: invoiceLines,
              batchNumber: stockBatches.batchNumber,
              expiryDate: stockBatches.expiryDate,
            })
            .from(invoiceLines)
            .innerJoin(
              charges,
              and(eq(charges.orgId, scope.orgId), eq(charges.id, invoiceLines.chargeId)),
            )
            .innerJoin(
              stockBatches,
              and(eq(stockBatches.orgId, scope.orgId), eq(stockBatches.id, charges.sourceId)),
            )
            .where(and(eq(invoiceLines.orgId, scope.orgId), eq(invoiceLines.invoiceId, invoiceId)))
            .orderBy(asc(invoiceLines.id)),
          db
            .select()
            .from(payments)
            .where(and(eq(payments.orgId, scope.orgId), eq(payments.invoiceId, invoiceId)))
            .orderBy(asc(payments.createdAt), asc(payments.id)),
          db
            .select({ amount: advanceAllocations.amount })
            .from(advanceAllocations)
            .where(
              and(
                eq(advanceAllocations.orgId, scope.orgId),
                eq(advanceAllocations.invoiceId, invoiceId),
              ),
            ),
          db
            .select({ total: creditNotes.total })
            .from(creditNotes)
            .where(and(eq(creditNotes.orgId, scope.orgId), eq(creditNotes.invoiceId, invoiceId))),
          db
            .select()
            .from(refunds)
            .where(and(eq(refunds.orgId, scope.orgId), eq(refunds.invoiceId, invoiceId)))
            .orderBy(asc(refunds.createdAt), asc(refunds.id)),
          db
            .select({ header: pharmacyReturns, line: pharmacyReturnLines })
            .from(pharmacyReturns)
            .leftJoin(
              pharmacyReturnLines,
              and(
                eq(pharmacyReturnLines.orgId, scope.orgId),
                eq(pharmacyReturnLines.returnId, pharmacyReturns.id),
              ),
            )
            .where(
              and(
                eq(pharmacyReturns.orgId, scope.orgId),
                eq(pharmacyReturns.pharmacySaleId, row.sale.id),
              ),
            )
            .orderBy(
              asc(pharmacyReturns.createdAt),
              asc(pharmacyReturns.id),
              asc(pharmacyReturnLines.id),
            ),
        ]);

      type ReturnRow = (typeof returnRows)[number];

      const returnsById = new Map<
        string,
        ReturnRow["header"] & { lines: NonNullable<ReturnRow["line"]>[] }
      >();

      for (const { header, line } of returnRows) {
        const saleReturn = returnsById.get(header.id) ?? { ...header, lines: [] };

        if (line) saleReturn.lines.push(line);
        returnsById.set(header.id, saleReturn);
      }

      const balance = calculateInvoiceBalance({
        grandTotal: row.invoice.grandTotal,
        creditTotal: noteRows.reduce((sum, credit) => sum + credit.total, 0n),
        paymentsTotal: salePayments.reduce((sum, payment) => sum + payment.amount, 0n),
        allocationsTotal: saleAllocations.reduce((sum, allocation) => sum + allocation.amount, 0n),
        refundsTotal: saleRefunds.reduce((sum, refund) => sum + refund.amount, 0n),
      });

      return {
        sale: { ...row.sale, soldByName: row.soldByName },
        invoice: row.invoice,
        lines: lines.map(({ line, batchNumber, expiryDate }) => ({
          ...line,
          batchNumber,
          expiryDate,
        })),
        payments: salePayments,
        returns: [...returnsById.values()],
        refunds: saleRefunds,
        balance,
        refundDue: balance.outstanding < 0n ? -balance.outstanding : 0n,
      };
    },
  ),

  listSales: orgProcedure(
    { pharmacy: ["read"] },
    orgInput.extend({
      ...dayRange,
      cursor: z.object({ createdAt: z.string(), id: z.string() }).optional(),
      limit: pageLimit,
    }),
  ).handler(async ({ context, input }) => {
    const { scope } = context;
    const { timeZone } = await readOrgSettings(scope.orgId);
    // An unasked window is the current day: the counter reads today, not ten years.
    const { from, to } = resolveDayRange(input, businessDate(new Date(), timeZone));

    const items = await db
      .select({
        saleId: pharmacySales.id,
        invoiceId: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        businessDate: invoices.businessDate,
        buyerName: pharmacySales.buyerName,
        patientId: pharmacySales.patientId,
        grandTotal: invoices.grandTotal,
        createdAt: pharmacySales.createdAt,
      })
      .from(pharmacySales)
      .innerJoin(
        invoices,
        and(eq(invoices.orgId, scope.orgId), eq(invoices.pharmacySaleId, pharmacySales.id)),
      )
      .where(
        and(
          eq(pharmacySales.orgId, scope.orgId),
          sql`${invoices.businessDate} between ${from} and ${to}`,
          input.cursor
            ? sql`(${pharmacySales.createdAt}, ${pharmacySales.id}) < (${input.cursor.createdAt}::timestamptz, ${input.cursor.id})`
            : undefined,
        ),
      )
      .orderBy(desc(pharmacySales.createdAt), desc(pharmacySales.id))
      .limit(input.limit + 1);

    const hasNextPage = items.length > input.limit;

    if (hasNextPage) items.pop();

    const last = items.at(-1);

    return {
      items,
      nextCursor:
        hasNextPage && last ? { createdAt: last.createdAt.toISOString(), id: last.saleId } : null,
    };
  }),
};
