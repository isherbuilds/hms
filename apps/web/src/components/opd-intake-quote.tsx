import { SubmitButton } from "@hms/ui/components/submit-button";
import { cn } from "@hms/ui/lib/utils";
import type { ReactNode } from "react";
import { useFormContext, useWatch } from "react-hook-form";

import { FinancialSummary } from "@/components/opd-financial-summary";
import type { IntakePractitioner, IntakeValues } from "@/components/opd-intake-form";
import type { SelectedPatient } from "@/components/opd-patient-picker";
import type { ServiceLine } from "@/components/opd-service-picker";
import { Panel } from "@/components/page";
import { formatMoney } from "@/lib/money";
import { type WalkInQuote } from "@/lib/opd-service-preview";
import { formatBusinessDate } from "@/lib/org-datetime";
import { errorMessage } from "@/lib/orpc-error";
import { practitionerDisplayName } from "@/lib/practitioner-name";

export type QuoteState = {
  data: WalkInQuote;
  fetching: boolean;
  error: Error | null;
  ready: boolean;
};

function IntakeSubmit({
  id,
  canSettleWalkIn,
  pending,
  quoteState,
  messageClassName,
}: {
  id: string;
  canSettleWalkIn: boolean;
  pending: boolean;
  quoteState: QuoteState;
  messageClassName?: string;
}) {
  const { control } = useFormContext<IntakeValues>();
  const when = useWatch({ control, name: "when", exact: true });

  const hasPatient = useWatch({
    control,
    name: "patient",
    exact: true,
    compute: (patient: SelectedPatient | null) => patient !== null,
  });

  const reason =
    when === "now" && !canSettleWalkIn
      ? "Your role cannot settle an immediate appointment."
      : when === "now" && quoteState.error
        ? errorMessage(quoteState.error, "Could not calculate the bill")
        : undefined;

  const blocked = !hasPatient || Boolean(reason);

  return (
    <>
      <SubmitButton
        isSubmitting={pending}
        disabled={blocked}
        aria-describedby={reason ? id : undefined}
      >
        Confirm
      </SubmitButton>
      {reason ? (
        <p id={id} className={cn("text-muted-foreground", messageClassName)}>
          {reason}
        </p>
      ) : null}
    </>
  );
}

function useScheduledPreview() {
  const { control } = useFormContext<IntakeValues>();

  return useWatch({
    control,
    name: "scheduledLocal",
    compute: (value: string) =>
      value ? `${formatBusinessDate(value.slice(0, 10))} · ${value.slice(11, 16)}` : "",
  });
}

function SummaryRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 truncate text-right">{children}</dd>
    </div>
  );
}

export function FinancialAside({
  practitioners,
  canSettleWalkIn,
  pending,
  quoteState,
}: {
  practitioners: IntakePractitioner[];
  canSettleWalkIn: boolean;
  pending: boolean;
  quoteState: QuoteState;
}) {
  const { control } = useFormContext<IntakeValues>();
  const when = useWatch({ control, name: "when", exact: true });

  const patientName = useWatch({
    control,
    name: "patient",
    exact: true,
    compute: (patient: SelectedPatient | null) => patient?.name ?? "—",
  });

  const practitionerId = useWatch({ control, name: "practitionerId", exact: true });

  const serviceCount = useWatch({
    control,
    name: "services",
    exact: true,
    compute: (services: ServiceLine[]) => services.length,
  });

  const previewTime = useScheduledPreview();

  const selectedPractitioner = practitioners.find(
    (practitioner) => practitioner.id === practitionerId,
  );

  const practitionerName = selectedPractitioner
    ? practitionerDisplayName(selectedPractitioner.name)
    : "—";

  return (
    <div className="sticky top-0">
      <Panel label={when === "now" ? "Payment" : "Booking"} minHeight="min-h-0" padded>
        {when === "now" && !quoteState.error ? <FinancialSummary quote={quoteState.data} /> : null}
        {when === "later" ? (
          <dl className="grid gap-2">
            <SummaryRow term="Patient">
              <span className="capitalize">{patientName}</span>
            </SummaryRow>
            <SummaryRow term="Seen by">
              <span className="capitalize">{practitionerName}</span>
            </SummaryRow>
            <SummaryRow term="Time">
              <span className="tabular-nums">{previewTime || "—"}</span>
            </SummaryRow>
            <SummaryRow term="Services">
              <span className="tabular-nums">
                {serviceCount === 0 ? "None" : `${serviceCount} queued`}
              </span>
            </SummaryRow>
          </dl>
        ) : null}
        <IntakeSubmit
          id="intake-desktop-issue"
          canSettleWalkIn={canSettleWalkIn}
          pending={pending}
          quoteState={quoteState}
        />
      </Panel>
    </div>
  );
}

export function IntakeFooter({
  canSettleWalkIn,
  pending,
  quoteState,
}: {
  canSettleWalkIn: boolean;
  pending: boolean;
  quoteState: QuoteState;
}) {
  const { control } = useFormContext<IntakeValues>();
  const when = useWatch({ control, name: "when", exact: true });
  const previewTime = useScheduledPreview();
  const lineCount = quoteState.data.lines.length;

  return (
    <footer className="absolute inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-border bg-card p-3 lg:hidden">
      <div className="min-w-0">
        <p className="truncate text-muted-foreground">
          {when === "now" ? (
            <>
              Payable · <span className="tabular-nums">{lineCount}</span> line
              {lineCount === 1 ? "" : "s"}
            </>
          ) : (
            "Appointment time"
          )}
        </p>
        <p className="truncate text-xs font-medium tabular-nums group-aria-busy/quote:opacity-50">
          {when !== "now"
            ? previewTime || "Choose a time"
            : quoteState.error
              ? "—"
              : formatMoney(quoteState.data.grandTotal, quoteState.data.currency)}
        </p>
      </div>
      <div className="ml-auto grid shrink-0 justify-items-end gap-1">
        <IntakeSubmit
          id="intake-mobile-issue"
          canSettleWalkIn={canSettleWalkIn}
          pending={pending}
          quoteState={quoteState}
          messageClassName="max-w-48 text-right"
        />
      </div>
    </footer>
  );
}
