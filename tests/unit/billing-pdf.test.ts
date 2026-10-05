import { expect, test } from "bun:test";

import type {
  AdvanceBundle,
  InvoiceBundle,
} from "../../apps/web/src/components/pdf/billing-documents";
import { renderAdvancePdf, renderBillingPdf } from "../../apps/web/src/lib/billing-pdf";
import { billingPdfFixture } from "../support/billing-pdf-fixture";

test("renders stored Devanagari text from application-owned fonts", async () => {
  const result = await renderBillingPdf({
    kind: "invoice",
    data: billingPdfFixture(),
    documentId: null,
    layout: "a4",
  });

  expect(new TextDecoder().decode(result.bytes.slice(0, 5))).toBe("%PDF-");
});

test("advance receipt and refund voucher render from the stored receipt snapshot", async () => {
  const receipt: AdvanceBundle["receipt"] = {
    id: "advance-1",
    orgId: "org-1",
    patientId: "patient-1",
    treatmentPlanId: "plan-1",
    method: "cash",
    amount: 300_00n,
    reference: null,
    note: null,
    purpose: "RCT 36",
    receiptNumber: "ADV-2026-0001",
    fiscalYear: "2026-27",
    businessDate: "2026-08-27",
    orgLegalName: "HMS Clinic",
    orgAddress: "Pune, Maharashtra",
    orgTaxId: "",
    orgGstin: "",
    currency: "INR",
    patientName: "Kavita Sharma",
    patientMrn: "MRN-0001",
    patientPhone: "+919876543210",
    patientAddress: "Shivaji Nagar, Pune",
    patientGuardian: null,
    receivedBy: "user-1",
    receivedByName: "Anita Desai",
    createdAt: new Date("2026-08-27T10:30:00.000Z"),
  };

  const refund: AdvanceBundle["refunds"][number] = {
    id: "refund-1",
    orgId: "org-1",
    invoiceId: null,
    creditNoteId: null,
    advanceReceiptId: receipt.id,
    method: "cash",
    amount: 100_00n,
    reference: null,
    refundNumber: "RF-2026-0001",
    fiscalYear: "2026-27",
    businessDate: "2026-08-28",
    refundedBy: "user-1",
    createdAt: new Date("2026-08-28T10:30:00.000Z"),
  };

  const data: AdvanceBundle = { receipt, refunds: [refund] };

  const advancePdf = await renderAdvancePdf(data, null);
  const refundPdf = await renderAdvancePdf(data, refund.id);

  expect(new TextDecoder().decode(advancePdf.bytes.slice(0, 5))).toBe("%PDF-");
  expect(new TextDecoder().decode(refundPdf.bytes.slice(0, 5))).toBe("%PDF-");
  expect(advancePdf.fileName).toBe("ADV-2026-0001.pdf");
  expect(refundPdf.fileName).toBe("RF-2026-0001.pdf");
});

test("a registered pharmacy Tax Invoice renders on A4 and thermal", async () => {
  const data = billingPdfFixture({ unicode: false });

  const registered = {
    ...data,
    invoice: { ...data.invoice, stream: "pharmacy" as const, orgGstin: "27ABCDE1234F1Z5" },
  };

  for (const layout of ["a4", "thermal"] as const) {
    const pdf = await renderBillingPdf({
      kind: "invoice",
      data: registered,
      documentId: null,
      layout,
    });

    expect(new TextDecoder().decode(pdf.bytes.slice(0, 5))).toBe("%PDF-");
  }
});

test("an invoice prints its round-off", async () => {
  const data = billingPdfFixture({ unicode: false });

  const render = (roundOff: bigint) =>
    renderBillingPdf({
      kind: "invoice",
      data: { ...data, invoice: { ...data.invoice, roundOff } },
      documentId: null,
      layout: "a4",
    });

  expect((await render(40n)).bytes).not.toEqual((await render(0n)).bytes);
});

test("invoice and receipt PDFs ignore later account activity", async () => {
  const source = billingPdfFixture({ unicode: false });

  const payment: InvoiceBundle["payments"][number] = {
    id: "payment-1",
    orgId: "org-1",
    invoiceId: "invoice-1",
    method: "cash",
    amount: 50_00n,
    reference: null,
    receiptNumber: "RCP-2026-0001",
    fiscalYear: "2026-27",
    businessDate: "2026-08-27",
    receivedBy: "user-1",
    createdAt: new Date("2026-08-27T10:30:00.000Z"),
  };

  const issued: InvoiceBundle = {
    ...source,
    payments: [payment],
    balance: { ...source.balance, paymentsTotal: 50_00n, outstanding: 68_00n },
  };

  const later: InvoiceBundle = {
    ...issued,
    payments: [
      payment,
      { ...payment, id: "payment-2", amount: 68_00n, receiptNumber: "RCP-2026-0002" },
    ],
    balance: { ...source.balance, paymentsTotal: 118_00n, outstanding: 0n },
  };

  const invoice = (data: InvoiceBundle) =>
    renderBillingPdf({ kind: "invoice", data, documentId: null, layout: "a4" });

  const receipt = (data: InvoiceBundle) =>
    renderBillingPdf({ kind: "receipt", data, documentId: payment.id, layout: "a4" });

  expect(
    (
      await invoice({
        ...later,
        invoice: { ...later.invoice, createdAt: new Date("2026-08-28T23:59:00.000Z") },
      })
    ).bytes,
  ).toEqual((await invoice(source)).bytes);
  expect((await receipt(later)).bytes).toEqual((await receipt(issued)).bytes);
});
