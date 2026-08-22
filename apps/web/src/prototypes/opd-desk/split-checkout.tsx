import { Button } from "@hms/ui/components/button";
import { BadgeIndianRupeeIcon, UserRoundIcon } from "lucide-react";

import {
  CareFields,
  ChargeSummary,
  Completion,
  PatientPicker,
  PrototypeFrame,
  ServicePicker,
  SettlementChoice,
  formatPrototypeMoney,
  useDeskPrototype,
} from "./shared";

export function SplitCheckout() {
  const desk = useDeskPrototype();

  if (desk.completed) {
    return (
      <PrototypeFrame
        eyebrow="Direction 2 · Split checkout"
        title="Keep patient context and money visible together"
        description="Axis: parallel visibility"
      >
        <Completion desk={desk} onReset={() => desk.setCompleted(false)} />
      </PrototypeFrame>
    );
  }

  return (
    <PrototypeFrame
      eyebrow="Direction 2 · Split checkout"
      title="Keep patient context and money visible together"
      description="Axis: parallel visibility"
    >
      <main className="grid min-h-[calc(100svh-3.5rem)] lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-4 p-4">
          <section className="rounded-xl bg-muted p-1">
            <div className="flex h-9 items-center gap-2 px-3 text-muted-foreground">
              <UserRoundIcon className="size-3.5" />
              Patient and attendance
            </div>
            <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
              <PatientPicker desk={desk} />
              <CareFields desk={desk} />
            </div>
          </section>

          <section className="rounded-xl bg-muted p-1">
            <div className="flex h-9 items-center px-3 text-muted-foreground">
              Services known now
            </div>
            <div className="flex min-h-28 flex-col gap-3 rounded-lg border border-border bg-card p-4">
              <p className="text-muted-foreground">
                Add only what is known at check-in. Anything ordered during care appears at
                checkout.
              </p>
              <ServicePicker desk={desk} />
            </div>
          </section>
        </div>

        <aside className="flex flex-col gap-4 border-l border-border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <BadgeIndianRupeeIcon className="size-3.5" />
            Live settlement
          </div>
          <div className="rounded-lg border border-border bg-background p-4">
            <ChargeSummary desk={desk} />
          </div>
          <SettlementChoice desk={desk} />
          <div className="rounded-lg border border-border bg-muted p-3 text-muted-foreground">
            <p className="font-medium text-foreground">Policy at this desk</p>
            <p>
              The known consultation defaults to pay now. “Amount due” is deliberate and stays in
              the cashier worklist.
            </p>
          </div>
          <div className="mt-auto flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <span>{desk.settlement === "pay_now" ? "Collect now" : "Record due"}</span>
              <span className="font-medium tabular-nums">{formatPrototypeMoney(desk.total)}</span>
            </div>
            <Button disabled={!desk.canSubmit} onClick={desk.submit}>
              Confirm OPD
            </Button>
          </div>
        </aside>
      </main>
    </PrototypeFrame>
  );
}
