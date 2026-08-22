import { Button } from "@hms/ui/components/button";
import { ReceiptTextIcon } from "lucide-react";

import {
  CareFields,
  ChargeSummary,
  Completion,
  PatientPicker,
  PrototypeFrame,
  ServicePicker,
  SettlementChoice,
  useDeskPrototype,
} from "./shared";

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-muted p-1">
      <div className="flex h-9 items-center px-3 text-muted-foreground">{label}</div>
      <div className="rounded-lg border border-border bg-card p-4">{children}</div>
    </section>
  );
}

export function OnePassLedger() {
  const desk = useDeskPrototype();

  if (desk.completed) {
    return (
      <PrototypeFrame
        eyebrow="Direction 1 · One-pass ledger"
        title="Register, queue, and settle without leaving the page"
        description="Axis: maximum throughput"
      >
        <Completion desk={desk} onReset={() => desk.setCompleted(false)} />
      </PrototypeFrame>
    );
  }

  return (
    <PrototypeFrame
      eyebrow="Direction 1 · One-pass ledger"
      title="Register, queue, and settle without leaving the page"
      description="Axis: maximum throughput"
    >
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-3 p-4">
        <Section label="1 · Patient">
          <PatientPicker desk={desk} />
        </Section>

        <Section label="2 · OPD attendance">
          <div className="flex flex-col gap-4">
            <CareFields desk={desk} />
            <div className="grid gap-1">
              <span className="text-muted-foreground">Known services at check-in</span>
              <ServicePicker desk={desk} />
            </div>
          </div>
        </Section>

        <Section label="3 · Settlement">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <SettlementChoice desk={desk} />
            <div className="rounded-lg border border-border bg-muted p-3">
              <ChargeSummary desk={desk} compact />
            </div>
          </div>
        </Section>

        <div className="sticky bottom-4 flex items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-sm">
          <ReceiptTextIcon className="size-4 text-muted-foreground" />
          <p className="min-w-0 flex-1 truncate text-muted-foreground">
            {desk.patientName || "Choose a patient"} · {desk.practitioner.name}
          </p>
          <Button disabled={!desk.canSubmit} onClick={desk.submit}>
            {desk.settlement === "pay_now"
              ? "Create OPD & record payment"
              : "Create OPD with amount due"}
          </Button>
        </div>
      </main>
    </PrototypeFrame>
  );
}
