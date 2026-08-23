import { Badge } from "@hms/ui/components/badge";
import { Button, buttonVariants } from "@hms/ui/components/button";
import { Input } from "@hms/ui/components/input";
import { NativeSelect } from "@hms/ui/components/native-select";
import { SubmitButton } from "@hms/ui/components/submit-button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClientOnly, Link, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import {
  FinancialSummary,
  ServiceLines,
  ServicePicker,
  type ServiceLine,
} from "@/components/opd-intake-services";
import { SettlementOverlay, type PaymentLine } from "@/components/opd-intake-settlement";
import { OpdPatientSearch, type SelectedPatient } from "@/components/opd-patient-picker";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { invalidateOpdAppointmentState } from "@/lib/domain-invalidation";
import { toPaise } from "@hms/api/lib/invoice-math";

import { formatMoney, MONEY_INPUT_PATTERN, parseMoneyInput } from "@/lib/money";
import { nextHalfHour, useOrgDateTime } from "@/lib/org-datetime";
import { Monogram } from "@/components/monogram";
import { orpc } from "@/lib/orpc";

export type IntakeMode = "walk_in" | "scheduled";

type WalkInSuccess = {
  appointment: { id: string; tokenNumber: number | null };
  invoice: { id: string; invoiceNumber: string };
  payments: Array<{ id: string; receiptNumber: string }>;
};

function IntakeSection({
  number,
  title,
  description,
  children,
}: {
  number: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-3 border-b border-border p-4 last:border-b-0 md:grid-cols-[8rem_minmax(0,1fr)]">
      <div className="flex items-start gap-2 md:block">
        <Badge variant="muted">{number}</Badge>
        <div>
          <h2 className="font-medium">{title}</h2>
          <p className="text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function ChosenPatient({ patient, onChange }: { patient: SelectedPatient; onChange?: () => void }) {
  return (
    <div className="flex min-h-12 items-center gap-3 rounded-md bg-muted px-3">
      <Monogram label={patient.name} />
      <span className="min-w-0">
        <span className="block truncate font-medium">{patient.name}</span>
        <span className="block truncate font-mono text-muted-foreground">{patient.mrn}</span>
      </span>
      {onChange ? (
        <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={onChange}>
          Change
        </Button>
      ) : null}
    </div>
  );
}

export function OpdIntakeForm({
  orgSlug,
  initialMode,
  patient,
  canSettleWalkIn,
  onChangePatient,
  onSelectPatient,
}: {
  orgSlug: string;
  initialMode: IntakeMode;
  patient: SelectedPatient | null;
  canSettleWalkIn: boolean;
  onChangePatient?: () => void;
  onSelectPatient: (patient: SelectedPatient) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { timeZone } = useOrgDateTime();
  const [mode, setMode] = useState<IntakeMode>(initialMode);
  const [departmentId, setDepartmentId] = useState("");
  const [practitionerId, setPractitionerId] = useState("");
  const [scheduledFor, setScheduledFor] = useState(() => nextHalfHour(timeZone));
  const [callerName, setCallerName] = useState("");
  const [callerPhone, setCallerPhone] = useState("");
  const [services, setServices] = useState<ServiceLine[]>([]);
  const [discount, setDiscount] = useState("");
  const [note, setNote] = useState("");
  const [payments, setPayments] = useState<PaymentLine[]>([
    { id: 1, method: "cash", amount: "", reference: "" },
  ]);
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [walkInSuccess, setWalkInSuccess] = useState<WalkInSuccess | null>(null);

  const departments = useQuery(orpc.staff.listDepartments.queryOptions({ input: { orgSlug } }));
  const practitioners = useQuery(orpc.staff.listPractitioners.queryOptions({ input: { orgSlug } }));
  const catalog = useQuery(
    orpc.catalog.list.queryOptions({ input: { orgSlug, activeOnly: true } }),
  );
  const normalizedDiscount = discount.trim() || "0";
  const discountValid = MONEY_INPUT_PATTERN.test(normalizedDiscount);
  const quotedDiscount = useDebouncedValue(normalizedDiscount, 250);
  const quoteReady =
    mode === "walk_in" && Boolean(patient && departmentId && practitionerId) && discountValid;
  const quote = useQuery({
    ...orpc.opd.quoteWalkIn.queryOptions({
      input: {
        orgSlug,
        patientId: patient?.id ?? "",
        departmentId,
        practitionerId,
        services,
        discountAmount: discountValid ? quotedDiscount : "0",
      },
    }),
    enabled: quoteReady,
    placeholderData: (previous) => previous,
  });
  const quoteCurrent =
    quoteReady && quotedDiscount === normalizedDiscount && quote.isSuccess && !quote.isFetching;
  const quoteData = quoteReady ? quote.data : undefined;
  const due = quoteData ? toPaise(quoteData.grandTotal) : 0;
  const parsedPayments = payments.map((payment) => ({
    ...payment,
    minorUnits: payment.amount.trim() === "" ? 0 : parseMoneyInput(payment.amount.trim()),
  }));
  const paymentInvalid = parsedPayments.some((payment) => payment.minorUnits === null);
  const collecting = parsedPayments.reduce((sum, payment) => sum + (payment.minorUnits ?? 0), 0);
  const balance = due - collecting;
  const needsNote = (parseMoneyInput(normalizedDiscount) ?? 0) > 0 || balance > 0;
  const completeCareTeam = Boolean(departmentId && practitionerId);
  const scheduledReady =
    mode === "scheduled" &&
    completeCareTeam &&
    scheduledFor !== "" &&
    Boolean(patient || (callerName.trim() && callerPhone.trim().length >= 4));
  const walkInReady =
    mode === "walk_in" &&
    canSettleWalkIn &&
    Boolean(patient && quoteData && quoteCurrent) &&
    discountValid &&
    !paymentInvalid &&
    collecting <= due &&
    (!needsNote || note.trim().length > 0);

  const finishBooking = async (appointment: { id: string }) => {
    await invalidateOpdAppointmentState(queryClient, orgSlug, appointment.id, "create");
    toast.success("Appointment booked");
    await navigate({
      to: "/$orgSlug/opd/$appointmentId",
      params: { orgSlug, appointmentId: appointment.id },
    });
  };
  const book = useMutation(
    orpc.opd.book.mutationOptions({
      onSuccess: finishBooking,
      onError: (error) => toast.error(error.message),
    }),
  );
  const createWalkIn = useMutation(
    orpc.opd.createWalkIn.mutationOptions({
      onSuccess: async ({ appointment, invoice, payments: recordedPayments }) => {
        await invalidateOpdAppointmentState(queryClient, orgSlug, appointment.id, "create");
        setSettlementOpen(false);
        setWalkInSuccess({ appointment, invoice, payments: recordedPayments });
        toast.success(`Token ${appointment.tokenNumber} created`);
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const pending = book.isPending || createWalkIn.isPending;

  const resetWalkIn = () => {
    setWalkInSuccess(null);
    setMode("walk_in");
    setDepartmentId("");
    setPractitionerId("");
    setScheduledFor(nextHalfHour(timeZone));
    setCallerName("");
    setCallerPhone("");
    setServices([]);
    setDiscount("");
    setNote("");
    setPayments([{ id: 1, method: "cash", amount: "", reference: "" }]);
    setSettlementOpen(false);
    createWalkIn.reset();
    onChangePatient?.();
  };

  const confirmWalkIn = () => {
    if (!patient || !walkInReady) return;
    createWalkIn.mutate({
      orgSlug,
      patientId: patient.id,
      departmentId,
      practitionerId,
      settlement: {
        services,
        discountAmount: normalizedDiscount,
        note: note.trim() || undefined,
        payments: parsedPayments
          .filter((payment) => (payment.minorUnits ?? 0) > 0)
          .map((payment) => ({
            method: payment.method,
            amount: payment.amount.trim(),
            reference: payment.reference.trim() || undefined,
          })),
      },
    });
  };

  const bookAppointment = () => {
    if (!scheduledReady) return;
    book.mutate({
      orgSlug,
      patientId: patient?.id ?? null,
      callerName: patient ? undefined : callerName.trim(),
      callerPhone: patient ? undefined : callerPhone.trim(),
      departmentId,
      practitionerId,
      scheduledLocal: scheduledFor,
    });
  };

  const openSettlement = () => {
    if (!quoteData) return;
    if (payments.every((payment) => payment.amount.trim() === "")) {
      const [firstPayment, ...otherPayments] = payments;
      if (!firstPayment) throw new Error("Settlement must have a payment line");
      setPayments([{ ...firstPayment, amount: quoteData.grandTotal }, ...otherPayments]);
    }
    setSettlementOpen(true);
  };

  const error = departments.error ?? practitioners.error ?? catalog.error;
  const optionsPending = departments.isPending || practitioners.isPending;
  const practitionerOptions = (practitioners.data ?? []).filter(
    (practitioner) => practitioner.departmentId === departmentId,
  );
  const catalogItems = catalog.data ?? [];

  if (walkInSuccess) {
    return (
      <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
        <div>
          <p className="font-medium">Walk-in created</p>
          <p className="text-muted-foreground">The bill and receipts are ready.</p>
        </div>
        <div>
          <p className="text-muted-foreground">Token</p>
          <p className="font-mono text-3xl font-semibold tabular-nums">
            {walkInSuccess.appointment.tokenNumber}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            className={buttonVariants({ variant: "outline", size: "sm" })}
            to="/$orgSlug/opd/$appointmentId/billing"
            params={{ orgSlug, appointmentId: walkInSuccess.appointment.id }}
          >
            Itemized bill · {walkInSuccess.invoice.invoiceNumber}
          </Link>
          {walkInSuccess.payments.map((payment) => (
            <Link
              key={payment.id}
              className={buttonVariants({ variant: "outline", size: "sm" })}
              to="/$orgSlug/billing/invoices/$invoiceId/receipt/$paymentId"
              params={{
                orgSlug,
                invoiceId: walkInSuccess.invoice.id,
                paymentId: payment.id,
              }}
            >
              Payment receipt · {payment.receiptNumber}
            </Link>
          ))}
          <Link
            className={buttonVariants({ variant: "outline", size: "sm" })}
            to="/$orgSlug/opd/$appointmentId"
            params={{ orgSlug, appointmentId: walkInSuccess.appointment.id }}
          >
            Open OPD
          </Link>
          <Button size="sm" onClick={resetWalkIn}>
            New walk-in
          </Button>
        </div>
      </section>
    );
  }

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
          <IntakeSection
            number="1"
            title="Patient"
            description={mode === "walk_in" ? "Search or register" : "Link or record caller"}
          >
            {patient ? (
              <ChosenPatient patient={patient} onChange={onChangePatient} />
            ) : mode === "walk_in" ? (
              <OpdPatientSearch orgSlug={orgSlug} onSelect={onSelectPatient} />
            ) : (
              <div className="grid gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-2">
                    <span className="text-muted-foreground">Caller name</span>
                    <Input
                      id="caller-name"
                      name="caller-name"
                      value={callerName}
                      disabled={pending}
                      onChange={(event) => setCallerName(event.target.value)}
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-muted-foreground">Phone</span>
                    <Input
                      id="caller-phone"
                      name="caller-phone"
                      inputMode="tel"
                      value={callerPhone}
                      disabled={pending}
                      onChange={(event) => setCallerPhone(event.target.value)}
                    />
                  </label>
                </div>
                <details>
                  <summary className="cursor-pointer text-muted-foreground">
                    Link an existing patient instead
                  </summary>
                  <div className="pt-3">
                    <OpdPatientSearch orgSlug={orgSlug} onSelect={onSelectPatient} />
                  </div>
                </details>
              </div>
            )}
          </IntakeSection>

          <IntakeSection number="2" title="Care team" description="Sets the attendance fee">
            <div className="grid gap-3">
              {error ? (
                <div role="alert" className="border-l-2 border-destructive pl-3">
                  <p className="font-medium">Could not load intake options</p>
                  <p className="text-muted-foreground">{error.message}</p>
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-2">
                  <span className="text-muted-foreground">Department</span>
                  <NativeSelect
                    id="intake-department"
                    name="department"
                    value={departmentId}
                    disabled={optionsPending || pending}
                    onChange={(event) => {
                      setDepartmentId(event.target.value);
                      setPractitionerId("");
                    }}
                  >
                    <option value="">Choose a department</option>
                    {(departments.data ?? []).map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <label className="grid gap-2">
                  <span className="text-muted-foreground">Practitioner</span>
                  <NativeSelect
                    id="intake-practitioner"
                    name="practitioner"
                    value={practitionerId}
                    disabled={!departmentId || optionsPending || pending}
                    onChange={(event) => setPractitionerId(event.target.value)}
                  >
                    <option value="">
                      {departmentId ? "Choose a practitioner" : "Choose a department first"}
                    </option>
                    {practitionerOptions.map((practitioner) => (
                      <option key={practitioner.id} value={practitioner.id}>
                        {practitioner.name}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
                <label className="grid gap-2">
                  <span className="text-muted-foreground">When</span>
                  <NativeSelect
                    id="intake-mode"
                    name="mode"
                    value={mode}
                    disabled={pending}
                    onChange={(event) => setMode(event.target.value as IntakeMode)}
                  >
                    <option value="walk_in" disabled={!canSettleWalkIn}>
                      Now · walk-in
                    </option>
                    <option value="scheduled">Later</option>
                  </NativeSelect>
                </label>
                {mode === "scheduled" ? (
                  <label className="grid gap-2">
                    <span className="text-muted-foreground">Date and time · {timeZone}</span>
                    <Input
                      id="scheduled-for"
                      name="scheduled-for"
                      type="datetime-local"
                      value={scheduledFor}
                      disabled={pending}
                      className="tabular-nums"
                      onChange={(event) => setScheduledFor(event.target.value)}
                    />
                  </label>
                ) : (
                  <p className="flex items-end pb-2 text-muted-foreground">
                    Token is issued after confirmation.
                  </p>
                )}
              </div>
              {!canSettleWalkIn && mode === "scheduled" ? (
                <p className="text-muted-foreground">
                  Your role can schedule appointments but cannot collect a walk-in payment.
                </p>
              ) : null}
            </div>
          </IntakeSection>

          {mode === "walk_in" ? (
            <IntakeSection number="3" title="Services" description="Search the live catalog">
              <div className="grid gap-3">
                <ServicePicker
                  catalog={catalogItems}
                  services={services}
                  currency={quoteData?.currency ?? "INR"}
                  disabled={pending || catalog.isPending}
                  onChange={setServices}
                />
                {quote.isFetching ? (
                  <p role="status" className="text-muted-foreground">
                    Recalculating subtotal, discount and tax…
                  </p>
                ) : null}
                {quote.isError ? (
                  <div role="alert" className="border-l-2 border-destructive pl-3">
                    <p className="font-medium">Could not calculate the bill</p>
                    <p className="text-muted-foreground">{quote.error.message}</p>
                  </div>
                ) : null}
                <ServiceLines
                  quote={quoteData}
                  services={services}
                  disabled={pending}
                  onChange={setServices}
                />
                <p className="text-muted-foreground">
                  Billing a procedure, lab test or X-ray does not mark that clinical work as
                  completed.
                </p>
              </div>
            </IntakeSection>
          ) : null}
        </div>

        <aside className="hidden xl:block">
          <div className="sticky top-4 flex flex-col rounded-xl bg-muted p-1">
            <div className="flex h-9 items-center px-3 text-muted-foreground">
              {mode === "walk_in" ? "Financial preview" : "Appointment preview"}
            </div>
            <div className="grid gap-4 rounded-lg border border-border bg-card p-4">
              {mode === "walk_in" ? (
                <FinancialSummary quote={quoteData} />
              ) : (
                <dl className="grid gap-2">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Patient</dt>
                    <dd>{patient?.name ?? (callerName || "—")}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">When</dt>
                    <dd className="tabular-nums">{scheduledFor || "—"}</dd>
                  </div>
                </dl>
              )}
              {mode === "walk_in" ? (
                <Button disabled={!quoteData || pending} onClick={openSettlement}>
                  Review and collect
                </Button>
              ) : (
                <SubmitButton
                  isSubmitting={book.isPending}
                  disabled={!scheduledReady}
                  onClick={bookAppointment}
                >
                  Book appointment
                </SubmitButton>
              )}
            </div>
          </div>
        </aside>
      </div>

      <footer className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-border bg-card p-3 md:left-(--sidebar-width) xl:hidden">
        <div className="min-w-0">
          <p className="truncate text-muted-foreground">
            {mode === "walk_in"
              ? `Payable · ${quoteData?.lines.length ?? 0} lines`
              : "Schedule for later"}
          </p>
          <p className="truncate text-sm font-medium tabular-nums">
            {mode === "walk_in"
              ? quoteData
                ? formatMoney(quoteData.grandTotal, quoteData.currency)
                : "—"
              : scheduledFor || "Choose a time"}
          </p>
        </div>
        {mode === "walk_in" ? (
          <Button
            className="ml-auto shrink-0"
            disabled={!quoteData || pending}
            onClick={openSettlement}
          >
            Review and collect
          </Button>
        ) : (
          <SubmitButton
            className="ml-auto shrink-0"
            isSubmitting={book.isPending}
            disabled={!scheduledReady}
            onClick={bookAppointment}
          >
            Book appointment
          </SubmitButton>
        )}
      </footer>

      {quoteData && patient ? (
        <ClientOnly fallback={null}>
          <SettlementOverlay
            open={settlementOpen}
            quote={quoteData}
            patient={patient}
            discount={discount}
            note={note}
            payments={payments}
            pending={createWalkIn.isPending}
            canConfirm={walkInReady}
            due={due}
            collecting={collecting}
            balance={balance}
            paymentInvalid={paymentInvalid}
            discountInvalid={!discountValid}
            needsNote={needsNote}
            onOpenChange={setSettlementOpen}
            onDiscountChange={setDiscount}
            onNoteChange={setNote}
            onPaymentsChange={setPayments}
            onConfirm={confirmWalkIn}
          />
        </ClientOnly>
      ) : null}
    </>
  );
}
