import { Badge } from "@hms/ui/components/badge";
import { Button } from "@hms/ui/components/button";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon } from "lucide-react";
import { useState } from "react";

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

const STEPS = ["Patient", "Attendance", "Settlement"] as const;

export function GuidedCommit() {
  const desk = useDeskPrototype();
  const [step, setStep] = useState(0);

  if (desk.completed) {
    return (
      <PrototypeFrame
        eyebrow="Direction 3 · Guided commit"
        title="One decision at a time, with the outcome always visible"
        description="Axis: error resistance"
      >
        <Completion
          desk={desk}
          onReset={() => {
            desk.setCompleted(false);
            setStep(0);
          }}
        />
      </PrototypeFrame>
    );
  }

  return (
    <PrototypeFrame
      eyebrow="Direction 3 · Guided commit"
      title="One decision at a time, with the outcome always visible"
      description="Axis: error resistance"
    >
      <main className="mx-auto grid w-full max-w-5xl gap-4 p-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <aside className="flex flex-col gap-2">
          {STEPS.map((label, index) => (
            <button
              key={label}
              type="button"
              onClick={() => setStep(index)}
              className={`flex items-center gap-2 rounded-lg border p-3 text-left ${
                step === index ? "border-foreground bg-card" : "border-border bg-muted"
              }`}
            >
              <span className="flex size-5 items-center justify-center rounded-full border border-border font-mono">
                {index < step ? <CheckIcon className="size-3.5" /> : index + 1}
              </span>
              <span>{label}</span>
            </button>
          ))}

          <div className="rounded-xl bg-muted p-1">
            <div className="flex h-9 items-center px-3 text-muted-foreground">Current record</div>
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
              <div>
                <p className="font-medium">{desk.patientName || "No patient"}</p>
                <p className="text-muted-foreground">{desk.practitioner.name}</p>
              </div>
              <ChargeSummary desk={desk} compact />
              <Badge variant={desk.settlement === "pay_now" ? "secondary" : "outline"}>
                {desk.settlement === "pay_now" ? "Pay now" : "Amount due"}
              </Badge>
            </div>
          </div>
        </aside>

        <section className="rounded-xl bg-muted p-1">
          <div className="flex h-9 items-center justify-between gap-3 px-3 text-muted-foreground">
            <span>
              {step + 1} of {STEPS.length}
            </span>
            <span>{STEPS[step]}</span>
          </div>
          <div className="flex min-h-[520px] flex-col rounded-lg border border-border bg-card p-4">
            {step === 0 ? (
              <div className="flex flex-col gap-4">
                <div>
                  <h2 className="text-sm font-medium">Who is at the desk?</h2>
                  <p className="text-muted-foreground">
                    Search first. Registration stays here only when no record matches.
                  </p>
                </div>
                <PatientPicker desk={desk} />
              </div>
            ) : null}

            {step === 1 ? (
              <div className="flex flex-col gap-4">
                <div>
                  <h2 className="text-sm font-medium">Where are they going?</h2>
                  <p className="text-muted-foreground">
                    The practitioner determines the consultation fee; optional known services stay
                    explicit.
                  </p>
                </div>
                <CareFields desk={desk} />
                <ServicePicker desk={desk} />
              </div>
            ) : null}

            {step === 2 ? (
              <div className="flex flex-col gap-4">
                <div>
                  <h2 className="text-sm font-medium">How is the known amount handled?</h2>
                  <p className="text-muted-foreground">
                    The OPD record is created first. This choice records payment or a visible
                    receivable.
                  </p>
                </div>
                <SettlementChoice desk={desk} />
              </div>
            ) : null}

            <div className="mt-auto flex items-center gap-2 border-t border-border pt-4">
              <Button
                variant="ghost"
                disabled={step === 0}
                onClick={() => setStep((current) => Math.max(0, current - 1))}
              >
                <ArrowLeftIcon data-icon="inline-start" />
                Back
              </Button>
              {step < STEPS.length - 1 ? (
                <Button
                  className="ml-auto"
                  disabled={step === 0 && !desk.canSubmit}
                  onClick={() => setStep((current) => Math.min(STEPS.length - 1, current + 1))}
                >
                  Continue
                  <ArrowRightIcon data-icon="inline-end" />
                </Button>
              ) : (
                <Button className="ml-auto" disabled={!desk.canSubmit} onClick={desk.submit}>
                  Confirm OPD
                </Button>
              )}
            </div>
          </div>
        </section>
      </main>
    </PrototypeFrame>
  );
}
