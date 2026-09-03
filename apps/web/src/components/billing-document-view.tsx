import { Button } from "@hms/ui/components/button";
import { DownloadIcon, PrinterIcon } from "lucide-react";

import { PageBody, PageHeader } from "@/components/page";
import {
  billingPdfUrl,
  type BillingDocumentLayout,
  type BillingDocumentRequest,
} from "@/lib/billing-document";

type BillingDocumentRouteProps = {
  orgSlug: string;
  invoiceId: string;
} & (
  | { kind: "invoice"; layout: BillingDocumentLayout }
  | { kind: "receipt"; paymentId: string }
  | { kind: "credit-note"; creditNoteId: string }
  | { kind: "refund"; refundId: string }
);

const documentMetadata = {
  receipt: { title: "Receipt", description: "Payment receipt PDF" },
  "credit-note": { title: "Credit note", description: "Credit note PDF" },
  refund: { title: "Refund voucher", description: "Refund voucher PDF" },
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
  const metadata =
    props.kind === "invoice"
      ? {
          title: "Invoice",
          description: props.layout === "thermal" ? "80 mm till roll" : "A4 document",
        }
      : documentMetadata[props.kind];

  return (
    <BillingDocumentView
      {...metadata}
      pdfUrl={billingPdfUrl({
        orgSlug: props.orgSlug,
        invoiceId: props.invoiceId,
        request,
      })}
    />
  );
}

// Shows the server-rendered PDF itself, so what the operator previews and what the
// patient is handed are the same bytes.
function BillingDocumentView({
  title,
  description,
  pdfUrl,
}: {
  title: string;
  description: string;
  pdfUrl: string;
}) {
  return (
    <>
      <PageHeader
        title={title}
        description={description}
        action={
          <>
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<a href={pdfUrl} target="_blank" rel="noreferrer" />}
            >
              <PrinterIcon data-icon="inline-start" />
              Open to print
            </Button>
            <Button size="sm" nativeButton={false} render={<a href={`${pdfUrl}&download=1`} />}>
              <DownloadIcon data-icon="inline-start" />
              Download
            </Button>
          </>
        }
      />
      <PageBody>
        <iframe title={title} src={pdfUrl} className="min-h-0 w-full flex-1 rounded-md border" />
      </PageBody>
    </>
  );
}
