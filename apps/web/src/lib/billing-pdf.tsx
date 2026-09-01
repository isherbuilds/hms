import devanagariRegularSource from "@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff2?inline";
import devanagariBoldSource from "@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-700-normal.woff2?inline";
import { ORPCError } from "@orpc/server";
import { render } from "takumi-pdf";
import { PageNumber, TotalPages } from "takumi-pdf/primitives";

import {
  CreditNoteDocument,
  type InvoiceBundle,
  InvoiceDocument,
  ReceiptDocument,
  RefundDocument,
} from "@/components/pdf/billing-documents";
import type { BillingDocumentLayout, BillingDocumentRequest } from "@/lib/billing-document";

const PAGE_MARGIN = { bottom: 46, left: 44, right: 44, top: 40 };
const THERMAL_WIDTH = 302;

async function readBundledFont(source: string): Promise<Uint8Array> {
  if (source.startsWith("data:")) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Could not decode bundled font: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  // Bun exposes imported binary assets as absolute paths in unit tests. Vite
  // inlines the same imports in the server build, so this branch is test-only.
  const { readFile } = await import("node:fs/promises");
  return new Uint8Array(await readFile(source));
}

const fonts = [
  {
    key: "hms-noto-devanagari-400-v1",
    name: "Noto Sans Devanagari",
    weight: 400,
    ranges: [[0x0900, 0x097f] as [number, number]],
    data: () => readBundledFont(devanagariRegularSource),
  },
  {
    key: "hms-noto-devanagari-700-v1",
    name: "Noto Sans Devanagari",
    weight: 700,
    ranges: [[0x0900, 0x097f] as [number, number]],
    data: () => readBundledFont(devanagariBoldSource),
  },
];

function footerBand(caption: string) {
  return (
    <div
      style={{
        color: "#71717a",
        display: "flex",
        fontSize: 8,
        justifyContent: "space-between",
        paddingLeft: 44,
        paddingRight: 44,
        width: "100%",
      }}
    >
      <span>{caption}</span>
      <span>
        Page <PageNumber /> of <TotalPages />
      </span>
    </div>
  );
}

function findDocument(data: InvoiceBundle, request: BillingDocumentRequest) {
  switch (request.kind) {
    case "invoice":
      return {
        element: (
          <InvoiceDocument invoice={data.invoice} lines={data.lines} layout={request.layout} />
        ),
        number: data.invoice.invoiceNumber,
        title: "Invoice",
      };
    case "receipt": {
      const payment = data.payments.find((row) => row.id === request.documentId);
      if (!payment) {
        throw new ORPCError("NOT_FOUND", { message: "Receipt not found on this invoice" });
      }
      return {
        element: <ReceiptDocument invoice={data.invoice} payment={payment} />,
        number: payment.receiptNumber,
        title: "Receipt",
      };
    }
    case "credit-note": {
      const note = data.creditNotes.find((row) => row.id === request.documentId);
      if (!note) {
        throw new ORPCError("NOT_FOUND", { message: "Credit note not found on this invoice" });
      }
      return {
        element: (
          <CreditNoteDocument invoice={data.invoice} invoiceLines={data.lines} note={note} />
        ),
        number: note.creditNoteNumber,
        title: "Credit note",
      };
    }
    case "refund": {
      const refund = data.refunds.find((row) => row.id === request.documentId);
      if (!refund) {
        throw new ORPCError("NOT_FOUND", { message: "Refund voucher not found on this invoice" });
      }
      const creditNote = data.creditNotes.find((row) => row.id === refund.creditNoteId);
      if (!creditNote) {
        throw new Error(`Credit note ${refund.creditNoteId} is missing from the invoice bundle`);
      }
      return {
        element: <RefundDocument invoice={data.invoice} refund={refund} creditNote={creditNote} />,
        number: refund.refundNumber,
        title: "Refund voucher",
      };
    }
  }
}

export async function renderBillingPdf(
  request: BillingDocumentRequest & { data: InvoiceBundle },
): Promise<{ bytes: Uint8Array; fileName: string }> {
  const { element, number, title } = findDocument(request.data, request);
  const caption = `${title} ${number} · ${request.data.invoice.orgLegalName}`;
  const common = {
    fontFamilies: ["sans-serif", "Noto Sans Devanagari"],
    fonts,
    lang: "en-IN",
    metadata: { creator: "HMS", title: caption },
  };

  const bytes =
    request.kind === "invoice" && request.layout === "thermal"
      ? await render(element, { ...common, viewport: { width: THERMAL_WIDTH } })
      : await render(element, {
          ...common,
          footer: footerBand(caption),
          margin: PAGE_MARGIN,
          size: "a4",
        });

  return { bytes, fileName: `${number}.pdf` };
}

export type { BillingDocumentLayout };
