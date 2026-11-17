// Spec: docs/specs/ipd-admission-to-discharge.md — the interim bill, the admission and
// discharge slips, and the ipd Invoice print the stay's facts on the hospital's paper.
import { expect, test } from "bun:test";
import { ORPCError } from "@orpc/server";

import type { InvoiceBundle } from "../../apps/web/src/components/pdf/billing-documents";
import {
  renderBillingPdf,
  renderInterimBillPdf,
  renderSlipPdf,
} from "../../apps/web/src/lib/billing-pdf";
import { billingPdfFixture } from "../support/billing-pdf-fixture";
import { interimBill, orgSettings, stayDetail } from "../support/ipd-pdf-fixture";

function isPdf(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
}

async function refusal(render: () => Promise<unknown>) {
  try {
    await render();
  } catch (error) {
    return error instanceof ORPCError ? error.code : error;
  }

  return "rendered";
}

test("a stay in hospital prints its interim bill under its IPD No.", async () => {
  for (const status of ["admitted", "discharge_ready"] as const) {
    const pdf = await renderInterimBillPdf(stayDetail(status), interimBill(), orgSettings());

    expect(isPdf(pdf.bytes)).toBe(true);
  }
});

test("a stay that has left or was cancelled has no interim bill", async () => {
  for (const status of ["discharged", "cancelled"] as const) {
    expect(
      await refusal(() => renderInterimBillPdf(stayDetail(status), interimBill(), orgSettings())),
    ).toBe("NOT_FOUND");
  }
});

test("the interim bill shows the deposit held", async () => {
  const render = (depositHeld: bigint) =>
    renderInterimBillPdf({ ...stayDetail(), depositHeld }, interimBill(), orgSettings());

  expect((await render(5_000_00n)).bytes).not.toEqual((await render(2_000_00n)).bytes);
});

test("a stay prints its admission slip, and its discharge slip once it has left", async () => {
  for (const status of ["admitted", "discharge_ready", "discharged"] as const) {
    expect(isPdf((await renderSlipPdf(stayDetail(status), orgSettings(), "admission")).bytes)).toBe(
      true,
    );
  }

  const discharge = await renderSlipPdf(stayDetail("discharged"), orgSettings(), "discharge");

  expect(isPdf(discharge.bytes)).toBe(true);
});

test("a discharge slip needs a departure, and a cancelled stay has no slip", async () => {
  for (const status of ["admitted", "discharge_ready"] as const) {
    expect(await refusal(() => renderSlipPdf(stayDetail(status), orgSettings(), "discharge"))).toBe(
      "NOT_FOUND",
    );
  }

  for (const kind of ["admission", "discharge"] as const) {
    expect(await refusal(() => renderSlipPdf(stayDetail("cancelled"), orgSettings(), kind))).toBe(
      "NOT_FOUND",
    );
  }
});

function ipdInvoice(admission: Partial<NonNullable<InvoiceBundle["admission"]>> = {}) {
  const data = billingPdfFixture({ unicode: false });

  return {
    ...data,
    invoice: {
      ...data.invoice,
      stream: "ipd" as const,
      opdAppointmentId: null,
      admissionId: "admission-1",
      invoiceNumber: "IP2026-27/9",
    },
    admission: {
      admissionNumber: "2026-27/41",
      admittedAt: new Date("2026-11-14T05:30:00.000Z"),
      dischargedAt: new Date("2026-11-17T08:00:00.000Z"),
      diagnosis: "Fracture left femur",
      timeZone: "Asia/Kolkata",
      ...admission,
    },
  } satisfies InvoiceBundle;
}

const printInvoice = (data: InvoiceBundle) =>
  renderBillingPdf({ kind: "invoice", data, documentId: null, layout: "a4" });

test("an ipd Invoice prints the stay's diagnosis when it has one", async () => {
  const withDiagnosis = await printInvoice(ipdInvoice());
  const without = await printInvoice(ipdInvoice({ diagnosis: null }));

  expect(isPdf(without.bytes)).toBe(true);
  expect(withDiagnosis.bytes).not.toEqual(without.bytes);
});

test("an ipd Invoice prints the stay's IPD No., admission and departure", async () => {
  const base = await printInvoice(ipdInvoice());

  expect((await printInvoice(ipdInvoice({ admissionNumber: "2026-27/42" }))).bytes).not.toEqual(
    base.bytes,
  );
  expect(
    (await printInvoice(ipdInvoice({ admittedAt: new Date("2026-11-13T05:30:00.000Z") }))).bytes,
  ).not.toEqual(base.bytes);
  expect((await printInvoice(ipdInvoice({ dischargedAt: null }))).bytes).not.toEqual(base.bytes);
});

test("an Invoice outside a stay prints no stay facts", async () => {
  const opd = billingPdfFixture({ unicode: false });

  expect(opd.admission).toBeNull();
  expect(isPdf((await printInvoice(opd)).bytes)).toBe(true);
});
