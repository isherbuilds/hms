import type { AppRouter } from "@hms/api/routers/index";
import type { RouterClient } from "@orpc/server";

type Client = RouterClient<AppRouter>;

export type StayDetail = Awaited<ReturnType<Client["ipd"]["get"]>>;

export type InterimBill = Awaited<ReturnType<Client["ipd"]["previewInvoice"]>>;

export type OrgSettings = Awaited<ReturnType<Client["settings"]["get"]>>;

type Status = StayDetail["admission"]["status"];

/** One stay as `ipd.get` returns it, in the given status with the facts that status implies. */
export function stayDetail(status: Status = "admitted"): StayDetail {
  const admittedAt = new Date("2026-11-14T05:30:00.000Z");
  const left = status === "discharged" ? new Date("2026-11-17T08:00:00.000Z") : null;

  return {
    admission: {
      id: "admission-1",
      admissionNumber: "2026-27/41",
      patientId: "patient-1",
      practitionerId: "practitioner-1",
      status,
      admittedAt,
      readyAt:
        status === "discharge_ready" || status === "discharged"
          ? new Date("2026-11-17T06:00:00.000Z")
          : null,
      dischargedAt: left,
      cancelledAt: status === "cancelled" ? new Date("2026-11-14T06:00:00.000Z") : null,
      cancelReason: status === "cancelled" ? "Admitted to the wrong Patient" : null,
      attendantName: "Meena Kumari",
      attendantPhone: "9876500001",
      medicoLegal: false,
      medicoLegalRef: null,
      diagnosis: "Fracture left femur",
      dischargeType: left ? "normal" : null,
      checkoutMinutes: 720,
      bedDaysBilled: 0,
      revision: 1,
      chargeRevision: 1,
      currentBedId: left || status === "cancelled" ? null : "bed-1",
    },
    patient: { id: "patient-1", name: "ramesh kumar", mrn: "MRN-000123" },
    practitionerName: "Anita Rao",
    stays: [
      {
        id: "stay-1",
        bedId: "bed-1",
        bedLabel: "G-4",
        wardName: "General",
        tariffId: "tariff-1",
        categoryId: "category-1",
        categoryName: "General ward",
        startedAt: admittedAt,
        endedAt: left,
      },
    ],
    runningBill: 6_300_00n,
    depositHeld: 5_000_00n,
  };
}

/** A running bill as `ipd.previewInvoice` returns it: three bed days with GST added. */
export function interimBill(): InterimBill {
  return {
    chargeRevision: 1,
    registered: true,
    through: new Date("2026-11-17T06:30:00.000Z"),
    bedDays: { billed: 0, unbilled: [] },
    pending: {
      lines: [
        {
          chargeId: null,
          admissionKind: "bed_day",
          description: "Ward bed (general)",
          qty: 3,
          unitPrice: 2_000_00n,
          priceUnits: 1,
          lineSubtotal: 6_000_00n,
          allocatedDiscount: 0n,
          taxableValue: 6_000_00n,
          taxRatePercent: "5.00",
          taxAmount: 300_00n,
          gross: 6_300_00n,
          taxCode: "9993",
          priceBasis: "exclusive",
          batch: null,
        },
      ],
      subtotal: 6_000_00n,
      taxTotal: 300_00n,
      addedTaxTotal: 300_00n,
      roundOff: 0n,
      grandTotal: 6_300_00n,
    },
    issued: [],
    credit: { deposit: 5_000_00n, other: 0n },
  };
}

export function orgSettings(): OrgSettings {
  return {
    legalName: "HMS Hospital",
    address: "Pune, Maharashtra",
    taxId: "",
    gstin: "27ABCDE1234F1Z5",
    drugLicence20: "",
    drugLicence21: "",
    currency: "INR",
    timeZone: "Asia/Kolkata",
    mrnPrefix: "",
    invoicePrefix: "INV",
    pharmacyInvoicePrefix: "PH",
    ipdInvoicePrefix: "IP",
    receiptPrefix: "RCT",
    advanceReceiptPrefix: "ADV",
    creditNotePrefix: "CN",
    fiscalYearStartMonth: 4,
    followUpValidityDays: 14,
    unbilledAlertHours: 24,
    ipdCheckoutMinutes: 720,
  };
}
