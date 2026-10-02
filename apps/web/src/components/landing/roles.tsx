import { Check } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { Beds, buttonClass, Pill, stagger } from "./primitives";

const LINES = "flex flex-col overflow-hidden rounded-xl border border-border bg-card";

const SMALL = "block text-xs leading-5 text-muted-foreground";

const FIELD_ROW = "grid grid-cols-1 gap-3.5 md:grid-cols-2";

/* The dot grid is the card's own background image, so nothing sits over its content. */
function Visual({ children, reveal = false }: { children: ReactNode; reveal?: boolean }) {
  return (
    <div
      data-role-visual
      data-reveal={reveal || undefined}
      className="flex min-w-0 flex-col gap-3.5 overflow-hidden rounded-2xl border border-border bg-background bg-[radial-gradient(circle_at_1px_1px,color-mix(in_oklch,var(--foreground)_9%,transparent)_1px,transparent_1.5px)] bg-size-[24px_24px] p-4.5 md:min-h-[400px] md:p-7"
    >
      {children}
    </div>
  );
}

function VisualHead({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="text-sm font-semibold">{title}</h4>
      {children}
    </div>
  );
}

function Line({
  title,
  detail,
  className = "",
  children,
}: {
  title: string;
  detail?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-t border-border px-4 py-[11px] text-sm leading-6 first:border-t-0 ${className}`}
    >
      <span>
        {title}
        {detail && <small className={SMALL}>{detail}</small>}
      </span>
      <span>{children}</span>
    </div>
  );
}

type PillTone = ComponentProps<typeof Pill>["tone"];

/* Rows of `[title, detail, status, tone]`. */
function StatusLines({
  rows,
  className = "",
}: {
  rows: readonly (readonly [string, string, string, PillTone?])[];
  className?: string;
}) {
  return (
    <div className={`${LINES} ${className}`}>
      {rows.map(([title, detail, status, tone]) => (
        <Line key={title} title={title} detail={detail}>
          <Pill tone={tone}>{status}</Pill>
        </Line>
      ))}
    </div>
  );
}

const COLLECTIONS = [
  { label: "Consultations", width: "92%", amount: "₹6,12,400" },
  { label: "Procedures", width: "66%", amount: "₹4,38,900" },
  { label: "Pharmacy", width: "40%", amount: "₹2,64,300" },
] as const;

function OwnerVisual() {
  return (
    <Visual reveal>
      <VisualHead title="Collected this month">
        <Pill tone="ok">Up on last month</Pill>
      </VisualHead>
      <div className="flex flex-col gap-3">
        {COLLECTIONS.map((collection, index) => (
          <div
            key={collection.label}
            className="grid grid-cols-[100px_minmax(0,1fr)_74px] items-center gap-3 text-sm md:grid-cols-[120px_minmax(0,1fr)_88px] md:text-sm"
          >
            <span>{collection.label}</span>
            <div className="h-6.5 overflow-hidden rounded-md bg-muted">
              <span
                data-reveal-bar
                style={stagger(index, { width: collection.width })}
                className={`block h-full rounded-md ${index === 0 ? "bg-brand" : "bg-foreground"}`}
              />
            </div>
            <b className="text-right font-semibold tabular-nums">{collection.amount}</b>
          </div>
        ))}
      </div>
      <StatusLines
        className="mt-1.5"
        rows={[
          ["Visits not billed yet", "Today · 4 patients", "₹5,550", "warn"],
          ["Open invoices over 30 days", "Oldest first, with the patient", "11 invoices", "danger"],
        ]}
      />
    </Visual>
  );
}

function Field({
  label,
  prefix,
  children,
}: {
  label: string;
  prefix?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex min-h-11 items-center overflow-hidden rounded-lg border border-muted-foreground/50 bg-card text-sm tabular-nums">
        {prefix && (
          <span className="flex self-stretch items-center border-r border-muted-foreground/50 bg-muted px-3 text-sm text-muted-foreground">
            {prefix}
          </span>
        )}
        <span className="px-3">{children}</span>
      </div>
    </div>
  );
}

/* A button drawn in a preview: it looks pressable and does nothing. */
const MOCK_BUTTON = { size: "sm", className: "pointer-events-none" } as const;

function DeskVisual() {
  return (
    <Visual>
      <div className={FIELD_ROW}>
        <Field label="Mobile number" prefix="+91">
          98230 41177
        </Field>
        <Field label="Doctor">Dr. S. Kulkarni</Field>
      </div>
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold">
          MJ
        </span>
        <div className="min-w-0 flex-1 text-sm">
          <b className="font-semibold">Meena Joshi</b>, 54 · F
          <small className={SMALL}>UHID 24-00318 · Last visit 12/08/2026 · ABHA linked</small>
        </div>
        <Pill tone="ok">Returning</Pill>
      </div>
      <div className={FIELD_ROW}>
        <Field label="Visit type">Follow-up</Field>
        <Field label="Consultation fee" prefix="₹">
          400
        </Field>
      </div>
      <div className="flex flex-wrap justify-end gap-2.5">
        <span className={buttonClass({ ...MOCK_BUTTON, variant: "secondary" })}>Save</span>
        <span className={buttonClass({ ...MOCK_BUTTON, variant: "primary" })}>
          Save &amp; print token 14
        </span>
      </div>
    </Visual>
  );
}

function NurseVisual() {
  return (
    <Visual>
      <VisualHead title="Ward 3 · General">
        <Pill tone="ok" live>
          Live
        </Pill>
      </VisualHead>
      <Beds count={16} />
      <StatusLines
        rows={[
          ["Bed 304 · Inj. Ceftriaxone 1g IV", "Due 2:00 pm · Dr. Kulkarni", "In 20 min", "warn"],
          ["Bed 311 · BP and sugar check", "Due 1:30 pm", "Overdue", "danger"],
          ["Bed 307 · Discharge summary ready", "Waiting for billing", "Discharge"],
        ]}
      />
    </Visual>
  );
}

const BILL_LINES = [
  ["Room charges · Semi-private", "4 days × ₹2,500", "₹10,000"],
  ["Laparoscopic appendectomy", "Surgeon, OT and anaesthesia", "₹42,000"],
  ["Pharmacy", "23 items from ward indents", "₹8,640"],
  ["Lab and radiology", "CBC, LFT, USG abdomen", "₹3,850"],
  ["Deposit received", "12/09/2026 · UPI", "− ₹20,000"],
] as const;

function BillingVisual() {
  return (
    <Visual>
      <VisualHead title="Interim bill · Rahul Deshmukh · IPD 1142">
        <Pill tone="ok">Up to date</Pill>
      </VisualHead>
      <div className={LINES}>
        {BILL_LINES.map(([label, detail, amount]) => (
          <Line key={label} title={label} detail={detail}>
            <b className="font-medium tabular-nums">{amount}</b>
          </Line>
        ))}
        <Line title="Balance · TPA approved ₹40,000" className="bg-muted font-semibold">
          <b className="text-lg font-bold tabular-nums">₹4,490</b>
        </Line>
      </div>
    </Visual>
  );
}

function PharmacyVisual() {
  return (
    <Visual>
      <VisualHead title="Stock alerts">
        <span className="text-xs text-muted-foreground">Main pharmacy</span>
      </VisualHead>
      <StatusLines
        rows={[
          ["Paracetamol 650 mg", "Batch PC2291 · 3 strips left", "Reorder", "danger"],
          ["Amoxicillin 500 mg", "Batch AX1180 · Expires 10/2026", "Expiring", "warn"],
          ["Ringer lactate 500 ml", "148 in stock", "In stock", "ok"],
          ["HbA1c · Meena Joshi", "Sample collected 11:40 am", "Processing"],
        ]}
      />
    </Visual>
  );
}

/* The three proof points under a role's description. */
export function Ticks({ ticks, className }: { ticks: readonly string[]; className: string }) {
  return (
    <ul className={`mt-1.5 flex-col gap-3.5 ${className}`}>
      {ticks.map((tick) => (
        <li key={tick} className="grid grid-cols-[22px_minmax(0,1fr)] gap-3 text-base">
          <Check aria-hidden className="mt-0.5 size-5 text-brand" />
          <span>{tick}</span>
        </li>
      ))}
    </ul>
  );
}

export const ROLES = [
  {
    id: "owner",
    label: "Owner",
    title: "Know where every rupee goes.",
    description: "Collections, open invoices and unbilled visits on one screen, and on your phone.",
    ticks: [
      "Collections by area, with how each was paid",
      "Open invoices and refunds due, oldest first",
      "Unbilled visits flagged before the patient leaves",
    ],
    visual: <OwnerVisual />,
  },
  {
    id: "desk",
    label: "Front desk",
    title: "Register a patient at the counter.",
    description:
      "Type a mobile number and the history appears. The OPD token prints before the next person steps up.",
    ticks: [
      "Search by mobile, name, UHID or ABHA",
      "Walk-ins and appointments in one queue",
      "Token, receipt and prescription header printed together",
    ],
    visual: <DeskVisual />,
  },
  {
    id: "nurse",
    label: "Nurse station",
    title: "Every bed and every order, one screen.",
    description: "See who is in which bed and what is due in the next hour.",
    ticks: [
      "Live bed map for every ward",
      "Medication and doctor orders with due times",
      "Handover notes on each patient",
    ],
    visual: <NurseVisual />,
  },
  {
    id: "billing",
    label: "Billing",
    title: "The discharge bill is ready before the patient is.",
    description: "Charges land on the bill the moment they happen. Discharge becomes a signature.",
    ticks: [
      "Charges added automatically from wards, pharmacy and lab",
      "Deposits, refunds and TPA approvals in one ledger",
      "GST-ready invoices in your format",
    ],
    visual: <BillingVisual />,
  },
  {
    id: "pharmacy",
    label: "Pharmacy & lab",
    title: "Stock and reports without the registers.",
    description:
      "Prescriptions reach the pharmacy and lab from the doctor’s screen. Stock updates itself.",
    ticks: [
      "Batch and expiry tracking with low-stock alerts",
      "Orders arrive from OPD and wards",
      "Lab results attach to the patient",
    ],
    visual: <PharmacyVisual />,
  },
] as const;
