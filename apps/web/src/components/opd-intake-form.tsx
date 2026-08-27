import { Button } from "@hms/ui/components/button";
import { Input } from "@hms/ui/components/input";
import { NativeSelect } from "@hms/ui/components/native-select";
import { SubmitButton } from "@hms/ui/components/submit-button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClientOnly, useNavigate } from "@tanstack/react-router";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import {
  FinancialSummary,
  ServiceLines,
  ServicePicker,
  type ServiceLine,
} from "@/components/opd-intake-services";
import { SettlementOverlay, type PaymentLine } from "@/components/opd-intake-settlement";
import { OpdPatientSearch, type SelectedPatient } from "@/components/opd-patient-picker";
import { invalidateOpdAppointmentState } from "@/lib/domain-invalidation";
import { toPaise } from "@hms/api/lib/invoice-math";

import { formatMoney, MONEY_INPUT_PATTERN, parseMoneyInput } from "@/lib/money";
import { applyDiscount, servicePreview } from "@/lib/opd-service-preview";
import { formatBusinessDate } from "@/lib/org-datetime";
import { amountOf, settlementProblems } from "@/lib/settlement";
import { Monogram } from "@/components/monogram";
import { orpc } from "@/lib/orpc";

function IntakeSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-3 border-b border-border p-4 last:border-b-0 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-xs text-muted-foreground">{title}</h2>
        <p className="text-muted-foreground">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function ChosenPatient({ patient, onChange }: { patient: SelectedPatient; onChange?: () => void }) {
  return (
    <div className="flex min-h-10 items-center gap-2 rounded-md bg-muted px-3">
      <Monogram label={patient.name} />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate font-medium">{patient.name}</span>
        <span className="truncate font-mono text-muted-foreground">{patient.mrn}</span>
      </span>
      {onChange ? (
        <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={onChange}>
          Change
        </Button>
      ) : null}
    </div>
  );
}

type IntakeValues = {
  when: "now" | "later";
  departmentId: string;
  practitionerId: string;
  scheduledLocal: string;
  services: ServiceLine[];
  omitConsultFee: boolean;
  discount: string;
  note: string;
  payments: PaymentLine[];
};

function initialValues(): IntakeValues {
  return {
    when: "now",
    departmentId: "",
    practitionerId: "",
    scheduledLocal: "",
    services: [],
    omitConsultFee: false,
    discount: "",
    note: "",
    payments: [{ id: 1, method: "cash", amount: "", reference: "" }],
  };
}

type IntakeIssue = { fieldId: string; message: string };

export function OpdIntakeForm({
  orgSlug,
  patient,
  initialPatientId,
  timeZone,
  currency,
  canSettleWalkIn,
  onChangePatient,
  onSelectPatient,
}: {
  orgSlug: string;
  patient: SelectedPatient | null;
  initialPatientId?: string;
  timeZone: string;
  currency: string;
  canSettleWalkIn: boolean;
  onChangePatient?: () => void;
  onSelectPatient: (patient: SelectedPatient) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<IntakeValues>(initialValues);
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [settlementAttempted, setSettlementAttempted] = useState(false);

  const update = <K extends keyof IntakeValues>(key: K, value: IntakeValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const departments = useQuery(orpc.staff.listDepartments.queryOptions({ input: { orgSlug } }));
  const practitioners = useQuery(orpc.staff.listPractitioners.queryOptions({ input: { orgSlug } }));
  const serviceClaims = values.services.map(({ catalogItemId, qty }) => ({ catalogItemId, qty }));
  const normalizedDiscount = values.discount.trim() || "0";
  const discountValid = MONEY_INPUT_PATTERN.test(normalizedDiscount);
  const quoteReady =
    values.when === "now" && Boolean(patient && values.departmentId && values.practitionerId);
  const quote = useQuery({
    ...orpc.opd.quoteWalkIn.queryOptions({
      input: {
        orgSlug,
        patientId: patient?.id ?? "",
        departmentId: values.departmentId,
        practitionerId: values.practitionerId,
        services: serviceClaims,
        omitConsultFee: values.omitConsultFee,
        discountAmount: "0",
      },
    }),
    enabled: quoteReady,
  });
  const quoteCurrent = quoteReady && quote.isSuccess && !quote.isFetching;
  const discountPaise = discountValid ? parseMoneyInput(normalizedDiscount) : null;
  const quoteData = quoteCurrent
    ? discountPaise !== null && discountPaise <= toPaise(quote.data.subtotal)
      ? applyDiscount(quote.data, normalizedDiscount)
      : quote.data
    : undefined;
  const previewQuote = servicePreview(values.services, currency);
  const displayQuote = quoteData ?? previewQuote;
  const omissionApplied =
    values.omitConsultFee &&
    quoteCurrent &&
    !quoteData?.lines.some((line) => line.source === "consultation");
  const due = quoteData ? toPaise(quoteData.grandTotal) : 0;
  const parsedPayments = values.payments.map((payment) => ({
    ...payment,
    minorUnits: amountOf(payment),
  }));
  const settlementIssues = settlementProblems({
    due,
    subtotal: quoteData ? toPaise(quoteData.subtotal) : 0,
    discount: values.discount,
    note: values.note,
    payments: values.payments,
    attempted: settlementAttempted,
    currency,
  });
  if (quoteReady && !quoteCurrent) {
    settlementIssues.push({
      key: "quote",
      fieldId: "settlement-discount",
      message: "Loading the bill…",
      quiet: true,
    });
  }
  const zeroWalkIn = Boolean(
    quoteData && quoteCurrent && due === 0 && settlementIssues.length === 0,
  );
  const walkInReady =
    canSettleWalkIn &&
    Boolean(patient && quoteData && quoteCurrent) &&
    settlementIssues.length === 0;
  const finishBooking = async (appointment: { id: string }) => {
    await invalidateOpdAppointmentState(queryClient, orgSlug, appointment.id, "create");
    if (formRef.current) formRef.current.dataset.dirty = "false";
    toast.success("Appointment booked");
    await navigate({
      to: "/$orgSlug/opd/$appointmentId",
      params: { orgSlug, appointmentId: appointment.id },
    });
  };
  const book = useMutation(
    orpc.opd.book.mutationOptions({
      onSuccess: finishBooking,
    }),
  );
  const createWalkIn = useMutation(
    orpc.opd.createWalkIn.mutationOptions({
      onSuccess: async ({ appointment }) => {
        await invalidateOpdAppointmentState(queryClient, orgSlug, appointment.id, "create");
        if (formRef.current) formRef.current.dataset.dirty = "false";
        setSettlementOpen(false);
        toast.success(`Token ${appointment.tokenNumber} created`);
        await navigate({
          to: "/$orgSlug/opd/$appointmentId",
          params: { orgSlug, appointmentId: appointment.id },
        });
      },
    }),
  );
  const pending = book.isPending || createWalkIn.isPending;
  const paymentChanged =
    values.payments.length !== 1 ||
    values.payments[0]?.method !== "cash" ||
    values.payments[0]?.amount !== "" ||
    values.payments[0]?.reference !== "";
  const dirty =
    !book.isSuccess &&
    !createWalkIn.isSuccess &&
    ((patient?.id ?? null) !== (initialPatientId ?? null) ||
      values.departmentId !== "" ||
      values.practitionerId !== "" ||
      values.when !== "now" ||
      values.scheduledLocal !== "" ||
      values.services.length > 0 ||
      values.omitConsultFee ||
      values.discount !== "" ||
      values.note !== "" ||
      paymentChanged);

  let primaryIssue: IntakeIssue | undefined;
  if (!patient) {
    primaryIssue = { fieldId: "patient-search", message: "Choose or register a patient." };
  } else if (!values.departmentId) {
    primaryIssue = { fieldId: "intake-department", message: "Choose a department." };
  } else if (!values.practitionerId) {
    primaryIssue = { fieldId: "intake-practitioner", message: "Choose a practitioner." };
  } else if (values.when === "later" && !values.scheduledLocal) {
    primaryIssue = { fieldId: "intake-time", message: "Choose a date and time." };
  } else if (values.when === "later" && book.isError) {
    primaryIssue = { fieldId: "intake-time", message: book.error.message };
  } else if (values.when === "now" && !canSettleWalkIn) {
    primaryIssue = {
      fieldId: "intake-when",
      message: "Your role cannot settle an immediate appointment.",
    };
  } else if (values.when === "now" && !quoteCurrent) {
    primaryIssue = {
      fieldId: "service-search",
      message: quote.isError ? quote.error.message : "Waiting for the current quote.",
    };
  }

  const focusIssue = (issue: IntakeIssue) => {
    const field = document.getElementById(issue.fieldId);
    field?.focus();
    if (field instanceof HTMLInputElement) field.select();
  };

  const selectPatient = (selected: SelectedPatient) => {
    book.reset();
    onSelectPatient(selected);
    requestAnimationFrame(() => document.getElementById("intake-department")?.focus());
  };

  const confirmWalkIn = () => {
    setSettlementAttempted(true);
    const [blocking] = settlementIssues;
    if (blocking) {
      const field = document.getElementById(blocking.fieldId);
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
        field.focus();
        if (blocking.selectOnFocus) field.select();
      } else field?.focus();
      return;
    }
    if (!patient || !walkInReady) return;
    createWalkIn.mutate({
      orgSlug,
      patientId: patient.id,
      departmentId: values.departmentId,
      practitionerId: values.practitionerId,
      settlement: {
        services: serviceClaims,
        omitConsultFee: values.omitConsultFee,
        discountAmount: normalizedDiscount,
        note: values.note.trim() || undefined,
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

  const openSettlement = () => {
    if (!canSettleWalkIn || !quoteData || !quoteCurrent) return;
    if (values.payments.every((payment) => payment.amount.trim() === "")) {
      const [firstPayment, ...otherPayments] = values.payments;
      if (!firstPayment) throw new Error("Settlement must have a payment line");
      update("payments", [{ ...firstPayment, amount: quoteData.grandTotal }, ...otherPayments]);
    }
    setSettlementAttempted(false);
    setSettlementOpen(true);
  };

  const submitAppointment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    if (primaryIssue) return focusIssue(primaryIssue);
    if (!patient) return;
    if (values.when === "now") {
      if (zeroWalkIn) return confirmWalkIn();
      return openSettlement();
    }
    book.mutate({
      orgSlug,
      patientId: patient.id,
      departmentId: values.departmentId,
      practitionerId: values.practitionerId,
      scheduledLocal: values.scheduledLocal,
      services: serviceClaims,
    });
  };

  const error = departments.error ?? practitioners.error;
  const optionsPending = departments.isPending || practitioners.isPending;
  const practitionerOptions = (practitioners.data ?? []).filter(
    (practitioner) => practitioner.departmentId === values.departmentId,
  );
  const previewTime = values.scheduledLocal
    ? `${formatBusinessDate(values.scheduledLocal.slice(0, 10))} · ${values.scheduledLocal.slice(11, 16)}`
    : "";
  const lineCount = displayQuote.lines.length;
  const payableLabel = `Payable · ${lineCount} line${lineCount === 1 ? "" : "s"}`;
  const primaryActionError = settlementOpen ? undefined : createWalkIn.error?.message;

  return (
    <form ref={formRef} data-dirty={dirty} onSubmit={submitAppointment}>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
          <IntakeSection title="Patient" description="Search or register">
            {patient ? (
              <ChosenPatient patient={patient} onChange={onChangePatient} />
            ) : (
              <OpdPatientSearch orgSlug={orgSlug} onSelect={selectPatient} />
            )}
          </IntakeSection>

          <IntakeSection
            title="Care team"
            description="Configured attendance fees appear in Services"
          >
            <div className="grid gap-3">
              {error ? (
                <div role="alert" className="border-l-2 border-destructive pl-3">
                  <p className="font-medium">Could not load intake options</p>
                  <p className="text-muted-foreground">{error.message}</p>
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-2">
                  <span className="text-muted-foreground">
                    Department <span className="text-destructive">*</span>
                  </span>
                  <NativeSelect
                    id="intake-department"
                    name="department"
                    required
                    value={values.departmentId}
                    disabled={optionsPending || pending}
                    onChange={(event) => {
                      book.reset();
                      setValues((current) => ({
                        ...current,
                        departmentId: event.target.value,
                        practitionerId: "",
                      }));
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && event.currentTarget.value) {
                        event.preventDefault();
                        document.getElementById("intake-practitioner")?.focus();
                      }
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
                  <span className="text-muted-foreground">
                    Practitioner <span className="text-destructive">*</span>
                  </span>
                  <NativeSelect
                    id="intake-practitioner"
                    name="practitioner"
                    required
                    value={values.practitionerId}
                    disabled={!values.departmentId || optionsPending || pending}
                    onChange={(event) => {
                      book.reset();
                      update("practitionerId", event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && event.currentTarget.value) {
                        event.preventDefault();
                        document.getElementById("intake-when")?.focus();
                      }
                    }}
                  >
                    <option value="">
                      {values.departmentId ? "Choose a practitioner" : "Choose a department first"}
                    </option>
                    {practitionerOptions.map((practitioner) => (
                      <option key={practitioner.id} value={practitioner.id}>
                        {practitioner.name}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <label className="grid gap-2">
                  <span className="text-muted-foreground">When</span>
                  <NativeSelect
                    id="intake-when"
                    name="when"
                    value={values.when}
                    disabled={pending}
                    onChange={(event) => {
                      book.reset();
                      update("when", event.target.value as IntakeValues["when"]);
                    }}
                  >
                    <option value="now">Now</option>
                    <option value="later">Later</option>
                  </NativeSelect>
                </label>
                {values.when === "later" ? (
                  <label className="grid gap-2">
                    <span className="text-muted-foreground">
                      Date and time · {timeZone} <span className="text-destructive">*</span>
                    </span>
                    <Input
                      id="intake-time"
                      name="intake-time"
                      type="datetime-local"
                      required
                      value={values.scheduledLocal}
                      disabled={pending}
                      className="tabular-nums"
                      onChange={(event) => {
                        book.reset();
                        update("scheduledLocal", event.target.value);
                      }}
                    />
                    {book.isError ? (
                      <span className="text-destructive">{book.error.message}</span>
                    ) : null}
                  </label>
                ) : null}
              </div>
              {!canSettleWalkIn && values.when === "now" ? (
                <p className="text-muted-foreground">
                  Your role can schedule appointments but cannot collect a walk-in payment
                </p>
              ) : null}
            </div>
          </IntakeSection>

          <IntakeSection title="Services" description="Optional for Now and Later">
            <div className="grid gap-3">
              <ServicePicker
                orgSlug={orgSlug}
                services={values.services}
                currency={currency}
                disabled={!patient || pending}
                onChange={(services) => {
                  book.reset();
                  update("services", services);
                }}
              />
              {quoteReady && quote.isFetching ? (
                <p role="status" className="text-muted-foreground">
                  Recalculating subtotal, discount and tax…
                </p>
              ) : null}
              {values.when === "now" && quote.isError ? (
                <div role="alert" className="border-l-2 border-destructive pl-3">
                  <p className="font-medium">Could not calculate the bill</p>
                  <p className="text-muted-foreground">{quote.error.message}</p>
                </div>
              ) : null}
              <ServiceLines
                quote={displayQuote}
                services={values.services}
                disabled={!patient || pending}
                onChange={(services) => {
                  book.reset();
                  update("services", services);
                }}
                onRemoveConsult={() => update("omitConsultFee", true)}
              />
              {!patient ? (
                <p className="text-muted-foreground">Choose a patient to add services.</p>
              ) : null}
              <div className="border-t border-border pt-3 xl:hidden">
                <FinancialSummary quote={displayQuote} />
              </div>
              <div className="grid gap-1 text-muted-foreground">
                {values.when === "now" && values.omitConsultFee ? (
                  <p className="flex items-center gap-1">
                    <span>
                      {omissionApplied ? "Consultation fee removed" : "Updating consultation fee"}
                    </span>
                    <span aria-hidden="true">·</span>
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => update("omitConsultFee", false)}
                    >
                      Restore fee
                    </Button>
                  </p>
                ) : null}
                <p>
                  Billing a procedure, lab test or X-ray does not mark that clinical work as
                  completed
                </p>
              </div>
            </div>
          </IntakeSection>
        </div>

        <aside className="hidden xl:block">
          <div className="sticky top-4 flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
            <div className="flex flex-col gap-3">
              <h2 className="text-xs text-muted-foreground">Financial preview</h2>
              <FinancialSummary quote={displayQuote} />
              {values.when === "later" ? (
                <dl className="grid gap-2">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Patient</dt>
                    <dd>{patient?.name ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Time</dt>
                    <dd className="tabular-nums">{previewTime || "—"}</dd>
                  </div>
                </dl>
              ) : null}
            </div>
            <SubmitButton
              isSubmitting={pending}
              aria-disabled={primaryIssue ? true : undefined}
              aria-describedby={primaryIssue ? "intake-desktop-issue" : undefined}
            >
              {values.when === "now"
                ? zeroWalkIn
                  ? "Create walk-in"
                  : "Review and collect"
                : "Book appointment"}
            </SubmitButton>
            {primaryIssue ? (
              <p id="intake-desktop-issue" className="text-muted-foreground">
                {primaryIssue.message}
              </p>
            ) : null}
            {primaryActionError ? (
              <p role="alert" className="text-destructive">
                {primaryActionError}
              </p>
            ) : null}
          </div>
        </aside>
      </div>

      <footer className="absolute inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-border bg-card p-3 xl:hidden">
        <div className="min-w-0">
          <p className="truncate text-muted-foreground">
            {values.when === "now" ? payableLabel : "Appointment time"}
          </p>
          <p className="truncate text-sm font-medium tabular-nums">
            {values.when === "now"
              ? formatMoney(displayQuote.grandTotal, displayQuote.currency)
              : previewTime || "Choose a time"}
          </p>
        </div>
        <div className="ml-auto grid shrink-0 justify-items-end gap-1">
          <SubmitButton
            isSubmitting={pending}
            aria-disabled={primaryIssue ? true : undefined}
            aria-describedby={primaryIssue ? "intake-mobile-issue" : undefined}
          >
            {values.when === "now"
              ? zeroWalkIn
                ? "Create walk-in"
                : "Review and collect"
              : "Book appointment"}
          </SubmitButton>
          {primaryIssue ? (
            <p id="intake-mobile-issue" className="max-w-48 text-right text-muted-foreground">
              {primaryIssue.message}
            </p>
          ) : null}
          {primaryActionError ? (
            <p role="alert" className="max-w-48 text-right text-destructive">
              {primaryActionError}
            </p>
          ) : null}
        </div>
      </footer>

      {quoteData && patient && values.when === "now" ? (
        <ClientOnly fallback={null}>
          <SettlementOverlay
            open={settlementOpen}
            quote={quoteData}
            patient={patient}
            discount={values.discount}
            note={values.note}
            payments={values.payments}
            pending={createWalkIn.isPending}
            error={createWalkIn.error?.message}
            due={due}
            problems={settlementIssues}
            onOpenChange={setSettlementOpen}
            onDiscountChange={(discount) => update("discount", discount)}
            onNoteChange={(note) => update("note", note)}
            onPaymentsChange={(payments) => update("payments", payments)}
            onConfirm={confirmWalkIn}
          />
        </ClientOnly>
      ) : null}
    </form>
  );
}
