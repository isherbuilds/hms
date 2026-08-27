import type { InvoiceBundle } from "../../apps/web/src/components/pdf/billing-documents";

export function billingPdfFixture({
  lineCount = 1,
  unicode = true,
}: { lineCount?: number; unicode?: boolean } = {}): InvoiceBundle {
  const subtotal = (100 * lineCount).toFixed(2);
  const tax = (18 * lineCount).toFixed(2);
  const total = (118 * lineCount).toFixed(2);

  return {
    invoice: {
      id: "invoice-1",
      orgId: "org-1",
      opdAppointmentId: "appointment-1",
      patientId: "patient-1",
      invoiceNumber: "INV-2026-0001",
      fiscalYear: "2026-27",
      businessDate: "2026-08-27",
      discountAmount: "0.00",
      note: null,
      subtotal,
      taxTotal: tax,
      grandTotal: total,
      orgLegalName: unicode ? "आरोग्य क्लिनिक" : "HMS Clinic",
      orgAddress: unicode ? "पुणे, महाराष्ट्र" : "Pune, Maharashtra",
      orgTaxId: "27ABCDE1234F1Z5",
      currency: "INR",
      patientName: unicode ? "कविता शर्मा" : "Kavita Sharma",
      patientMrn: "MRN-0001",
      patientPhone: "+919876543210",
      patientAddress: unicode ? "शिवाजी नगर, पुणे" : "Shivaji Nagar, Pune",
      issuedBy: "user-1",
      createdAt: new Date("2026-08-26T20:00:00.000Z"),
    },
    lines: Array.from({ length: lineCount }, (_, index) => ({
      id: `line-${index + 1}`,
      orgId: "org-1",
      invoiceId: "invoice-1",
      chargeId: `charge-${index + 1}`,
      description: unicode ? `सामान्य परामर्श ${index + 1}` : `General consultation ${index + 1}`,
      qty: 1,
      unitPrice: "100.00",
      lineSubtotal: "100.00",
      allocatedDiscount: "0.00",
      taxableValue: "100.00",
      taxAmount: "18.00",
      gross: "118.00",
      taxRatePercent: "18.00",
      taxCode: "9983",
      revenueCategory: "consultation" as const,
    })),
    payments: [],
    creditNotes: [],
    refunds: [],
    balance: {
      grandTotal: total,
      paymentsTotal: "0.00",
      creditTotal: "0.00",
      refundsTotal: "0.00",
      outstanding: total,
    },
  };
}
