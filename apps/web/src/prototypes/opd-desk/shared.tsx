import { Badge } from "@hms/ui/components/badge";
import { Button } from "@hms/ui/components/button";
import { Input } from "@hms/ui/components/input";
import { NativeSelect } from "@hms/ui/components/native-select";
import { CheckIcon, SearchIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

export const PATIENTS = [
  { id: "patient-1", mrn: "MRN-004821", name: "Anita Rao", phone: "98765 41082", age: 42 },
  { id: "patient-2", mrn: "MRN-003197", name: "Mohammed Imran", phone: "99807 22514", age: 31 },
  { id: "patient-3", mrn: "MRN-005044", name: "Leela Thomas", phone: "98450 66291", age: 67 },
] as const;

export const PRACTITIONERS = [
  { id: "rao", name: "Dr Meera Rao", department: "General Medicine", fee: 600 },
  { id: "shah", name: "Dr Neel Shah", department: "Orthopaedics", fee: 800 },
  { id: "iyer", name: "Dr Kavya Iyer", department: "Dermatology", fee: 700 },
] as const;

export const SERVICES = [
  { id: "ecg", name: "ECG", price: 350 },
  { id: "dressing", name: "Dressing", price: 250 },
  { id: "nebulisation", name: "Nebulisation", price: 300 },
] as const;

export type Settlement = "pay_now" | "amount_due";
export type Tender = "cash" | "upi" | "card";

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export function formatPrototypeMoney(value: number): string {
  return money.format(value);
}

export function useDeskPrototype() {
  const [patientId, setPatientId] = useState<string>(PATIENTS[0].id);
  const [newPatientName, setNewPatientName] = useState("");
  const [newPatientPhone, setNewPatientPhone] = useState("");
  const [practitionerId, setPractitionerId] = useState<string>(PRACTITIONERS[0].id);
  const [reason, setReason] = useState("Fever and body ache");
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [settlement, setSettlement] = useState<Settlement>("pay_now");
  const [tender, setTender] = useState<Tender>("upi");
  const [completed, setCompleted] = useState(false);

  const patient = PATIENTS.find((item) => item.id === patientId);
  const practitioner = PRACTITIONERS.find((item) => item.id === practitionerId)!;
  const selectedServices = SERVICES.filter((item) => serviceIds.includes(item.id));
  const total = useMemo(
    () => practitioner.fee + selectedServices.reduce((sum, item) => sum + item.price, 0),
    [practitioner.fee, selectedServices],
  );
  const patientName = patient?.name ?? newPatientName.trim();
  const hasPatientIdentity = patient
    ? true
    : patientName.length > 0 && newPatientPhone.trim().length >= 4;
  const canSubmit = hasPatientIdentity && practitionerId.length > 0;

  const chooseExistingPatient = (id: string) => {
    setPatientId(id);
    setNewPatientName("");
    setNewPatientPhone("");
  };
  const startNewPatient = () => setPatientId("");
  const toggleService = (id: string) =>
    setServiceIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  const submit = () => {
    if (canSubmit) setCompleted(true);
  };

  return {
    patientId,
    patient,
    patientName,
    newPatientName,
    newPatientPhone,
    practitionerId,
    practitioner,
    reason,
    serviceIds,
    selectedServices,
    settlement,
    tender,
    total,
    completed,
    canSubmit,
    chooseExistingPatient,
    startNewPatient,
    setNewPatientName,
    setNewPatientPhone,
    setPractitionerId,
    setReason,
    toggleService,
    setSettlement,
    setTender,
    setCompleted,
    submit,
  };
}

export type Desk = ReturnType<typeof useDeskPrototype>;

export function PrototypeFrame({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-svh bg-background pb-24 text-xs text-foreground">
      <header className="flex min-h-14 items-center gap-4 border-b border-border bg-card px-4">
        <div className="min-w-0">
          <p className="text-muted-foreground">{eyebrow}</p>
          <h1 className="truncate text-sm font-medium">{title}</h1>
        </div>
        <Badge variant="outline" className="ml-auto">
          Prototype · nothing is saved
        </Badge>
      </header>
      <div className="proto-enter">{children}</div>
      <p className="fixed right-4 bottom-4 text-muted-foreground">{description}</p>
    </div>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}

export function PatientPicker({ desk, compact = false }: { desk: Desk; compact?: boolean }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = PATIENTS.filter((patient) =>
    [patient.name, patient.phone, patient.mrn].some((value) =>
      value.toLocaleLowerCase().includes(normalizedQuery),
    ),
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-8"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name, mobile, or MRN"
          aria-label="Search patient"
        />
      </div>
      <div className={compact ? "grid gap-2" : "grid gap-2 sm:grid-cols-3"}>
        {matches.map((patient) => {
          const active = desk.patientId === patient.id;
          return (
            <button
              key={patient.id}
              type="button"
              onClick={() => desk.chooseExistingPatient(patient.id)}
              className={`flex min-w-0 items-center gap-2 rounded-lg border p-3 text-left ${
                active ? "border-foreground bg-muted" : "border-border bg-card"
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{patient.name}</span>
                <span className="block truncate text-muted-foreground">
                  <span className="font-mono">{patient.mrn}</span> · {patient.phone}
                </span>
              </span>
              {active ? <CheckIcon className="size-3.5 shrink-0" /> : null}
            </button>
          );
        })}
        {matches.length === 0 ? (
          <p className="border border-dashed border-border p-3 text-muted-foreground">
            No matching patient. Register a new patient below.
          </p>
        ) : null}
      </div>
      <Button type="button" variant="ghost" className="self-start" onClick={desk.startNewPatient}>
        Register someone new
      </Button>
      {!desk.patient ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1">
            <FieldLabel>Full name</FieldLabel>
            <Input
              value={desk.newPatientName}
              onChange={(event) => desk.setNewPatientName(event.target.value)}
              placeholder="Patient name"
            />
          </label>
          <label className="grid gap-1">
            <FieldLabel>Mobile number</FieldLabel>
            <Input
              value={desk.newPatientPhone}
              onChange={(event) => desk.setNewPatientPhone(event.target.value)}
              placeholder="Mobile number"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

export function CareFields({ desk }: { desk: Desk }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1">
        <FieldLabel>Practitioner</FieldLabel>
        <NativeSelect
          value={desk.practitionerId}
          onChange={(event) => desk.setPractitionerId(event.target.value)}
        >
          {PRACTITIONERS.map((practitioner) => (
            <option key={practitioner.id} value={practitioner.id}>
              {practitioner.name} · {practitioner.department}
            </option>
          ))}
        </NativeSelect>
      </label>
      <label className="grid gap-1">
        <FieldLabel>Reason for attendance</FieldLabel>
        <Input value={desk.reason} onChange={(event) => desk.setReason(event.target.value)} />
      </label>
    </div>
  );
}

export function ServicePicker({ desk }: { desk: Desk }) {
  return (
    <div className="flex flex-wrap gap-2">
      {SERVICES.map((service) => {
        const active = desk.serviceIds.includes(service.id);
        return (
          <Button
            key={service.id}
            type="button"
            size="sm"
            variant={active ? "secondary" : "outline"}
            onClick={() => desk.toggleService(service.id)}
          >
            {active ? <CheckIcon data-icon="inline-start" /> : null}
            {service.name} · {formatPrototypeMoney(service.price)}
          </Button>
        );
      })}
    </div>
  );
}

export function SettlementChoice({ desk }: { desk: Desk }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <button
        type="button"
        onClick={() => desk.setSettlement("pay_now")}
        className={`rounded-lg border p-3 text-left ${
          desk.settlement === "pay_now" ? "border-foreground bg-muted" : "border-border bg-card"
        }`}
      >
        <span className="block font-medium">Pay consultation now</span>
        <span className="text-muted-foreground">Default for a known, fixed consultation fee.</span>
      </button>
      <button
        type="button"
        onClick={() => desk.setSettlement("amount_due")}
        className={`rounded-lg border p-3 text-left ${
          desk.settlement === "amount_due" ? "border-foreground bg-muted" : "border-border bg-card"
        }`}
      >
        <span className="block font-medium">Record amount due</span>
        <span className="text-muted-foreground">Explicit exception; never an accidental zero.</span>
      </button>
      {desk.settlement === "pay_now" ? (
        <label className="grid gap-1 sm:col-span-2">
          <FieldLabel>Tender</FieldLabel>
          <NativeSelect
            value={desk.tender}
            onChange={(event) => desk.setTender(event.target.value as Tender)}
          >
            <option value="upi">UPI</option>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
          </NativeSelect>
        </label>
      ) : null}
    </div>
  );
}

export function ChargeSummary({ desk, compact = false }: { desk: Desk; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span>Consultation · {desk.practitioner.name}</span>
        <span className="tabular-nums">{formatPrototypeMoney(desk.practitioner.fee)}</span>
      </div>
      {desk.selectedServices.map((service) => (
        <div key={service.id} className="flex items-center justify-between gap-3">
          <span>{service.name}</span>
          <span className="tabular-nums">{formatPrototypeMoney(service.price)}</span>
        </div>
      ))}
      <div
        className={`flex items-center justify-between gap-3 border-t border-border ${compact ? "pt-2" : "pt-3"}`}
      >
        <span className="font-medium">Total</span>
        <span
          className={compact ? "font-medium tabular-nums" : "text-3xl font-medium tabular-nums"}
        >
          {formatPrototypeMoney(desk.total)}
        </span>
      </div>
    </div>
  );
}

export function Completion({ desk, onReset }: { desk: Desk; onReset: () => void }) {
  return (
    <div className="flex min-h-[420px] items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl bg-muted p-1">
        <div className="flex h-9 items-center px-3 text-muted-foreground">OPD created</div>
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
          <div>
            <p className="text-sm font-medium">{desk.patientName}</p>
            <p className="text-muted-foreground">
              Token <span className="font-mono text-foreground">042</span> ·{" "}
              {desk.practitioner.name}
            </p>
          </div>
          <div className="flex items-center justify-between gap-3 border-y border-border py-3">
            <span>{desk.settlement === "pay_now" ? "Paid" : "Amount due"}</span>
            <span className="text-3xl font-medium tabular-nums">
              {formatPrototypeMoney(desk.total)}
            </span>
          </div>
          <p className="text-muted-foreground">
            {desk.settlement === "pay_now"
              ? `Receipt recorded by ${desk.tender.toUpperCase()}. Services added during care remain billable at checkout.`
              : "The consultation remains visible in Billing until the cashier records payment."}
          </p>
          <Button onClick={onReset}>Start next patient</Button>
        </div>
      </div>
    </div>
  );
}
