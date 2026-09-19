import { useQuery } from "@tanstack/react-query";

import { PageHeader } from "@/components/page";
import type { InvoiceBundle } from "@/components/pdf/billing-documents";
import {
  billingPdfUrl,
  type BillingDocumentLayout,
  type BillingDocumentRequest,
} from "@/lib/billing-document";
import { orpc } from "@/lib/orpc";

type BillingDocumentRouteProps = {
  orgSlug: string;
  invoiceId: string;
} & (
  | { kind: "invoice"; layout: BillingDocumentLayout }
  | { kind: "receipt"; paymentId: string }
  | { kind: "credit-note"; creditNoteId: string }
  | { kind: "refund"; refundId: string }
);

const documentTitle = {
  invoice: "Invoice",
  receipt: "Receipt",
  "credit-note": "Credit note",
  refund: "Refund voucher",
} as const;

export function BillingDocumentRoute(props: BillingDocumentRouteProps) {
  const request: BillingDocumentRequest =
    props.kind === "invoice"
      ? { kind: "invoice", documentId: null, layout: props.layout }
      : props.kind === "receipt"
        ? { kind: "receipt", documentId: props.paymentId, layout: "a4" }
        : props.kind === "credit-note"
          ? { kind: "credit-note", documentId: props.creditNoteId, layout: "a4" }
          : { kind: "refund", documentId: props.refundId, layout: "a4" };

  return (
    <BillingDocumentView
      orgSlug={props.orgSlug}
      invoiceId={props.invoiceId}
      request={request}
      pdfUrl={billingPdfUrl({
        orgSlug: props.orgSlug,
        invoiceId: props.invoiceId,
        request,
      })}
    />
  );
}

// The header names the paper, not the page: which document this is and who it is
// for, so a re-print can be checked against the patient in front of the counter
// without reading the PDF. The PDF renderer picks the same numbers server-side; a
// mismatch here would only mislabel the header, never the document.
function documentNumber(data: InvoiceBundle, request: BillingDocumentRequest) {
  switch (request.kind) {
    case "invoice":
      return data.invoice.invoiceNumber;
    case "receipt":
      return data.payments.find((row) => row.id === request.documentId)?.receiptNumber;
    case "credit-note":
      return data.creditNotes.find((row) => row.id === request.documentId)?.creditNoteNumber;
    case "refund":
      return data.refunds.find((row) => row.id === request.documentId)?.refundNumber;
  }
}

// Shows the server-rendered PDF itself, so what the operator previews and what the
// patient is handed are the same bytes.
//
// The browser's PDF viewer brings its own toolbar — print, download, zoom, page
// count — so a bar of ours would only repeat it, and two stacked toolbars is what
// made this page feel cluttered. Below `lg` the header stays for the title and the
// sidebar trigger; the viewer is the only place actions live.
function BillingDocumentView({
  orgSlug,
  invoiceId,
  request,
  pdfUrl,
}: {
  orgSlug: string;
  invoiceId: string;
  request: BillingDocumentRequest;
  pdfUrl: string;
}) {
  // Whoever linked here has almost always loaded this invoice already, so this is a
  // cache read. It resolves after first paint, so the header fills in rather than
  // holding the document back.
  const invoice = useQuery(orpc.billing.getInvoice.queryOptions({ input: { orgSlug, invoiceId } }));
  const kind = documentTitle[request.kind];
  const number = invoice.data && documentNumber(invoice.data, request);
  const patient = invoice.data?.invoice;

  return (
    <>
      <div className="contents lg:hidden">
        <PageHeader title={number ? `${kind} ${number}` : kind} />
        {patient ? (
          <p className="shrink-0 truncate px-4 py-2 text-xs text-muted-foreground">
            <span className="capitalize">{patient.patientName}</span>
            {patient.patientMrn ? ` · MRN ${patient.patientMrn}` : null}
          </p>
        ) : null}
      </div>
      <iframe title={kind} src={pdfUrl} className="min-h-0 w-full flex-1 border-0" />
    </>
  );
}
