import { Button } from "@hms/ui/components/button";
import { DownloadIcon, PrinterIcon } from "lucide-react";

export function ReportActions({ disabled, onExport }: { disabled: boolean; onExport: () => void }) {
  return (
    <>
      <Button disabled={disabled} onClick={onExport}>
        <DownloadIcon data-icon="inline-start" />
        Export Excel
      </Button>
      <Button variant="outline" disabled={disabled} onClick={() => window.print()}>
        <PrinterIcon data-icon="inline-start" />
        Print / PDF
      </Button>
    </>
  );
}
