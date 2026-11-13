// Spec: docs/specs/ipd-admission-to-discharge.md — an ipd Invoice may mix taxed and
// exempt lines and both price bases, so its title and tax rows come from the lines (D052).
import { expect, test } from "bun:test";

import {
  invoiceDocumentTitle,
  invoicePrintParticulars,
  invoiceTaxBreakdown,
  linePriceBasis,
} from "../../apps/web/src/lib/invoice-print";

const GSTIN = "27ABCDE1234F1Z5";

const service = {
  priceBasis: "exclusive" as const,
  taxRatePercent: "5.00",
  taxableValue: 6_000_00n,
  taxAmount: 300_00n,
  gross: 6_300_00n,
};

const bundledMedicine = {
  priceBasis: "inclusive" as const,
  taxRatePercent: "0.00",
  taxableValue: 224_00n,
  taxAmount: 0n,
  gross: 224_00n,
};

const independentMedicine = {
  priceBasis: "inclusive" as const,
  taxRatePercent: "12.00",
  taxableValue: 100_00n,
  taxAmount: 12_00n,
  gross: 112_00n,
};

test("a registered ipd Invoice with taxed and exempt lines is an Invoice-cum-Bill of Supply", () => {
  expect(invoiceDocumentTitle({ orgGstin: GSTIN, stream: "ipd" }, [service, bundledMedicine])).toBe(
    "Invoice-cum-Bill of Supply",
  );
});

test("a registered ipd Invoice with only exempt lines is a Bill of Supply", () => {
  expect(invoiceDocumentTitle({ orgGstin: GSTIN, stream: "ipd" }, [bundledMedicine])).toBe(
    "Bill of Supply",
  );
});

test("a registered ipd Invoice with only taxed lines is a Tax Invoice", () => {
  expect(
    invoiceDocumentTitle({ orgGstin: GSTIN, stream: "ipd" }, [service, independentMedicine]),
  ).toBe("Tax Invoice");
});

test("an unregistered organization prints Invoice on every stream", () => {
  for (const stream of ["opd", "pharmacy", "ipd"] as const) {
    expect(invoiceDocumentTitle({ orgGstin: "", stream }, [service, bundledMedicine])).toBe(
      "Invoice",
    );
  }
});

test("registered OPD and counter Pharmacy titles do not depend on their lines", () => {
  expect(invoiceDocumentTitle({ orgGstin: GSTIN, stream: "opd" }, [bundledMedicine])).toBe(
    "Bill of Supply",
  );
  expect(invoiceDocumentTitle({ orgGstin: GSTIN, stream: "pharmacy" }, [independentMedicine])).toBe(
    "Tax Invoice",
  );
});

test("the tax breakdown separates taxable from exempt value and added GST from GST inside MRP", () => {
  expect(invoiceTaxBreakdown([service, bundledMedicine, independentMedicine])).toEqual({
    taxableValue: 6_100_00n,
    exemptValue: 224_00n,
    gstAdded: 300_00n,
    gstIncluded: 12_00n,
  });
});

test("an exempt line names its basis without a GST claim; taxed lines add or include GST only when registered", () => {
  const exemptService = { priceBasis: "exclusive" as const, taxRatePercent: "0.00" };

  expect(linePriceBasis(true, exemptService)).toEqual({ label: "Rate", suffix: "" });
  expect(linePriceBasis(true, bundledMedicine)).toEqual({ label: "MRP", suffix: "" });
  expect(linePriceBasis(true, service)).toEqual({ label: "Rate", suffix: "+ GST" });
  expect(linePriceBasis(true, independentMedicine)).toEqual({ label: "MRP", suffix: "incl. GST" });
  expect(linePriceBasis(false, service)).toEqual({ label: "Rate", suffix: "" });
  expect(linePriceBasis(false, independentMedicine)).toEqual({ label: "MRP", suffix: "" });
});

test("an ipd Invoice prints GST columns only when registered and a line carries GST", () => {
  const registered = { orgGstin: GSTIN, stream: "ipd" as const };

  const cases = [
    { invoice: registered, lines: [bundledMedicine], title: "Bill of Supply", taxed: false },
    {
      invoice: registered,
      lines: [service, bundledMedicine],
      title: "Invoice-cum-Bill of Supply",
      taxed: true,
    },
    {
      invoice: registered,
      lines: [service, independentMedicine],
      title: "Tax Invoice",
      taxed: true,
    },
    {
      invoice: { orgGstin: "", stream: "ipd" as const },
      lines: [service, bundledMedicine],
      title: "Invoice",
      taxed: false,
    },
  ];

  for (const { invoice, lines, title, taxed } of cases) {
    expect(invoiceDocumentTitle(invoice, lines)).toBe(title);
    expect(invoicePrintParticulars(invoice, lines).taxed).toBe(taxed);
  }
});
