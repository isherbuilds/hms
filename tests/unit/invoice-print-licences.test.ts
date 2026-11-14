import { expect, test } from "bun:test";

import { invoicePrintParticulars } from "../../apps/web/src/lib/invoice-print";

const GSTIN = "27ABCDE1234F1Z5";

const service = { priceBasis: "exclusive" as const, taxRatePercent: "5.00" };

const medicine = { priceBasis: "inclusive" as const, taxRatePercent: "0.00" };

test("an ipd document prints drug licences only with a medicine line", () => {
  for (const orgGstin of [GSTIN, ""]) {
    const ipd = { orgGstin, stream: "ipd" as const };

    expect(invoicePrintParticulars(ipd, [service]).licences).toBe(false);
    expect(invoicePrintParticulars(ipd, [service, medicine]).licences).toBe(true);
    expect(invoicePrintParticulars(ipd, [medicine]).licences).toBe(true);
    // A receipt has no lines at hand.
    expect(invoicePrintParticulars(ipd, []).licences).toBe(false);
  }
});

test("pharmacy documents always print drug licences and opd documents never do", () => {
  for (const lines of [[], [medicine]]) {
    expect(invoicePrintParticulars({ orgGstin: GSTIN, stream: "pharmacy" }, lines).licences).toBe(
      true,
    );
    expect(invoicePrintParticulars({ orgGstin: GSTIN, stream: "opd" }, lines).licences).toBe(false);
  }
});
