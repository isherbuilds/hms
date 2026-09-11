import type { InvoiceBundle } from "../../apps/web/src/components/pdf/billing-documents";

export function billingPdfFixture({
  lineCount = 1,
  unicode = true,
}: { lineCount?: number; unicode?: boolean } = {}): InvoiceBundle {
  const subtotal = 10_000n * BigInt(lineCount);
  const tax = 1_800n * BigInt(lineCount);
  const total = 11_800n * BigInt(lineCount);

  return {
    invoice: {
      id: "invoice-1",
      orgId: "org-1",
      opdAppointmentId: "appointment-1",
      patientId: "patient-1",
      invoiceNumber: "INV-2026-0001",
      fiscalYear: "2026-27",
      businessDate: "2026-08-27",
      discountAmount: 0n,
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
      patientGuardian: unicode ? "W/o राजेश शर्मा" : "W/o Rajesh Sharma",
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
      unitPrice: 100_00n,
      lineSubtotal: 100_00n,
      allocatedDiscount: 0n,
      taxableValue: 100_00n,
      taxAmount: 18_00n,
      gross: 118_00n,
      taxRatePercent: "18.00",
      taxCode: "9983",
      revenueCategory: "consultation" as const,
    })),
    payments: [],
    creditNotes: [],
    refunds: [],
    balance: {
      grandTotal: total,
      paymentsTotal: 0n,
      creditTotal: 0n,
      refundsTotal: 0n,
      outstanding: total,
    },
  };
}
