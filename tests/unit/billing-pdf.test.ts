import { expect, test } from "bun:test";

import type { InvoiceBundle } from "../../apps/web/src/components/pdf/billing-documents";
import { renderBillingPdf } from "../../apps/web/src/lib/billing-pdf";
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

test("an invoice PDF uses its business date and ignores later account activity", async () => {
  const source = billingPdfFixture({ unicode: false });
  const afterPayment: InvoiceBundle = {
    ...source,
    invoice: {
      ...source.invoice,
      createdAt: new Date("2026-08-28T23:59:00.000Z"),
    },
    payments: [
      {
        id: "payment-1",
        orgId: "org-1",
        invoiceId: "invoice-1",
        method: "cash",
        amount: "118.00",
        reference: null,
        receiptNumber: "RCP-2026-0001",
        fiscalYear: "2026-27",
        businessDate: "2026-08-27",
        receivedBy: "user-1",
        createdAt: new Date("2026-08-27T10:30:00.000Z"),
      },
    ],
    balance: {
      grandTotal: "118.00",
      paymentsTotal: "118.00",
      creditTotal: "0.00",
      refundsTotal: "0.00",
      outstanding: "0.00",
    },
  };

  const before = await renderBillingPdf({
    kind: "invoice",
    data: source,
    documentId: null,
    layout: "a4",
  });
  const after = await renderBillingPdf({
    kind: "invoice",
    data: afterPayment,
    documentId: null,
    layout: "a4",
  });

  expect(after.bytes).toEqual(before.bytes);
});

test("a receipt PDF does not change when later account activity changes", async () => {
  const source = billingPdfFixture({ unicode: false });
  const payment: InvoiceBundle["payments"][number] = {
    id: "payment-1",
    orgId: "org-1",
    invoiceId: "invoice-1",
    method: "cash",
    amount: "50.00",
    reference: null,
    receiptNumber: "RCP-2026-0001",
    fiscalYear: "2026-27",
    businessDate: "2026-08-27",
    receivedBy: "user-1",
    createdAt: new Date("2026-08-27T10:30:00.000Z"),
  };
  const issued = {
    ...source,
    payments: [payment],
    balance: { ...source.balance, paymentsTotal: "50.00", outstanding: "68.00" },
  };
  const later = {
    ...issued,
    payments: [
      payment,
      { ...payment, id: "payment-2", amount: "68.00", receiptNumber: "RCP-2026-0002" },
    ],
    balance: { ...source.balance, paymentsTotal: "118.00", outstanding: "0.00" },
  };

  const before = await renderBillingPdf({
    kind: "receipt",
    data: issued,
    documentId: payment.id,
    layout: "a4",
  });
  const after = await renderBillingPdf({
    kind: "receipt",
    data: later,
    documentId: payment.id,
    layout: "a4",
  });

  expect(after.bytes).toEqual(before.bytes);
});
