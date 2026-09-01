import { Button } from "@hms/ui/components/button";
import { DownloadIcon, PrinterIcon } from "lucide-react";

import { PageBody, PageHeader } from "@/components/page";

// Shows the server-rendered PDF itself, so what the operator previews and what the
// patient is handed are the same bytes.
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
