import { Button } from "@hms/ui/components/button";
import { Input } from "@hms/ui/components/input";
import { useState, type ReactNode } from "react";

import { validateReportPeriod } from "@/lib/report-presentation";

type ReportPeriodRange = {
  from: string;
  to: string;
};

type ReportPeriodControlsProps = ReportPeriodRange & {
  maxDays?: number;
  onApply: (range: ReportPeriodRange) => void;
  children: ReactNode;
};

export function ReportPeriodControls({
  from,
  to,
  maxDays,
  onApply,
  children,
}: ReportPeriodControlsProps) {
  const [draft, setDraft] = useState<ReportPeriodRange>({ from, to });
  const periodError = validateReportPeriod(draft.from, draft.to, maxDays);

  return (
    <>
      <div className="flex flex-wrap items-end gap-2 print:hidden">
        <label className="grid gap-1">
          <span className="text-muted-foreground">From</span>
          <Input
            type="date"
            value={draft.from}
            onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-muted-foreground">To</span>
          <Input
            type="date"
            value={draft.to}
            onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
          />
        </label>
        <Button
          size="sm"
          disabled={Boolean(periodError) || (draft.from === from && draft.to === to)}
          onClick={() => {
            if (!periodError) onApply(draft);
          }}
        >
          Apply
        </Button>
        {children}
      </div>
      {periodError ? (
        <p role="alert" className="text-destructive">
          {periodError}
        </p>
      ) : null}
    </>
  );
}
