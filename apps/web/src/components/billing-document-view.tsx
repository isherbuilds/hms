import { Button } from "@hms/ui/components/button";
import { DownloadIcon, PrinterIcon } from "lucide-react";

import { PageBody, PageHeader } from "@/components/page";

/**
 * Every billing document is now one server-rendered PDF (see the
 * `.../invoices/$invoiceId/pdf` route), so the screen shows that exact file
 * rather than a second HTML rendition of it. What the operator previews, saves,
 * and hands the patient is the same bytes.
 */
export function BillingDocumentView({
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
