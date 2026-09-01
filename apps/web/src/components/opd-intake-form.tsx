import { toPaise } from "@hms/api/lib/invoice-math";
import { Button } from "@hms/ui/components/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
} from "@hms/ui/components/form";
import { Input } from "@hms/ui/components/input";
import { NativeSelect } from "@hms/ui/components/native-select";
import { SubmitButton } from "@hms/ui/components/submit-button";
import { cn } from "@hms/ui/lib/utils";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClientOnly, useNavigate } from "@tanstack/react-router";
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useFormContext, useFormState, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Monogram } from "@/components/monogram";
import { FinancialSummary } from "@/components/opd-financial-summary";
import { SettlementOverlay, type SettlementDraft } from "@/components/opd-settlement-overlay";
import { ServiceLines } from "@/components/opd-intake-services";
import { OpdPatientSearch, type SelectedPatient } from "@/components/opd-patient-picker";
import { ServicePicker, type ServiceLine } from "@/components/opd-service-picker";
import { useZodForm } from "@/hooks/use-zod-form";
import { invalidateOpdAppointmentState } from "@/lib/domain-invalidation";
import { useCan, useMembership } from "@/lib/membership";
import { formatMoney } from "@/lib/money";
import { servicePreview, type WalkInQuote } from "@/lib/opd-service-preview";
import { formatBusinessDate, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";

// On the element rather than in route state: lifting it up would cost a render of
// the page on the first keystroke. Same arrangement as PatientForm and PatientSheet.
const INTAKE_FORM = "[data-intake-form]";

export function isIntakeFormDirty(): boolean {
  return document.querySelector(INTAKE_FORM)?.getAttribute("data-dirty") === "true";
}

const intakeSchema = z
  .object({
    patient: z.custom<SelectedPatient | null>(),
    when: z.enum(["now", "later"]),
    departmentId: z.string().min(1, "Choose a department"),
    practitionerId: z.string().min(1, "Choose a practitioner"),
    scheduledLocal: z.string(),
    services: z.array(z.custom<ServiceLine>()),
    omitConsultFee: z.boolean(),
  })
  .superRefine((values, context) => {
    if (values.when === "later" && !values.scheduledLocal) {
      context.addIssue({
        code: "custom",
        path: ["scheduledLocal"],
        message: "Choose a date and time",
      });
    }
  });

type IntakeValues = z.input<typeof intakeSchema>;

function defaultValues(patient: SelectedPatient | null): IntakeValues {
  return {
    patient,
    when: "now",
    departmentId: "",
    practitionerId: "",
    scheduledLocal: "",
    services: [],
    omitConsultFee: false,
  };
}

function serviceClaims(services: ServiceLine[]) {
  return services.map(({ catalogItemId, qty }) => ({ catalogItemId, qty }));
}

/** A consultation the operator picked replaces the practitioner's own fee. */
function omitsConsultFee(values: IntakeValues) {
  return values.omitConsultFee || values.services.some((s) => s.category === "consultation");
}

function quoteInput(orgSlug: string, values: IntakeValues) {
  if (values.when !== "now" || !values.patient || !values.departmentId || !values.practitionerId) {
    return null;
  }
  return {
    orgSlug,
    patientId: values.patient.id,
    departmentId: values.departmentId,
    practitionerId: values.practitionerId,
    services: serviceClaims(values.services),
    omitConsultFee: omitsConsultFee(values),
    discountAmount: "0",
  };
}

type QuoteInput = NonNullable<ReturnType<typeof quoteInput>>;

// The query is disabled here, so this is never fetched; a stable key keeps
// half-built inputs out of the cache.
const NO_QUOTE: QuoteInput = {
  orgSlug: "",
  patientId: "",
  departmentId: "",
  practitionerId: "",
  services: [],
  omitConsultFee: false,
  discountAmount: "0",
};

type QuoteState = {
  current: WalkInQuote | undefined;
  data: WalkInQuote | undefined;
  fetching: boolean;
  error: string | undefined;
  waiting: boolean;
};

// Split, because a refetch flips the status twice while the totals stand still:
// the footer and the aside draw only the bill and stay asleep through it.
const BillContext = createContext<WalkInQuote | null>(null);
const QuoteStateContext = createContext<QuoteState | null>(null);

function useBill(): WalkInQuote {
  const bill = useContext(BillContext);
  if (!bill) throw new Error("useBill must be used inside <QuoteProvider>");
  return bill;
}

function useQuoteState(): QuoteState {
  const state = useContext(QuoteStateContext);
  if (!state) throw new Error("useQuoteState must be used inside <QuoteProvider>");
  return state;
}

function QuoteProvider({ orgSlug, children }: { orgSlug: string; children: ReactNode }) {
  const { control } = useFormContext<IntakeValues>();
  const currency = useMembership(orgSlug, (membership) => membership.currency);
  // Compared structurally, so typing a date never rebuilds the input or refetches.
  // A second `useWatch` would cost another form emission per keystroke.
  const { input, services } = useWatch({
    control,
    compute: (values: IntakeValues) => ({
      input: quoteInput(orgSlug, values),
      services: values.services,
    }),
  });

  const quote = useQuery({
    ...orpc.opd.quoteWalkIn.queryOptions({ input: input ?? NO_QUOTE }),
    enabled: input !== null,
    // Keeps the last good bill on screen, so an open settlement overlay is never torn
    // down mid-draft by a refetch.
    placeholderData: keepPreviousData,
  });
  // `isPlaceholderData` separates the kept-around bill from a fresh one: without it
  // a stale quote reads as current and the desk settles the wrong total.
  const current =
    input !== null && quote.isSuccess && !quote.isFetching && !quote.isPlaceholderData
      ? quote.data
      : undefined;
  // React Hook Form clones `services` on every emission, so memoise on the values,
  // not the array — otherwise every keystroke publishes a new bill.
  const previewKey = services
    .map((s) => `${s.catalogItemId}:${s.qty}:${s.unitPrice}:${s.taxRatePercent}`)
    .join(",");
  const preview = useMemo(
    () => servicePreview(services, currency),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `previewKey` is `services` by value
    [previewKey, currency],
  );
  // `quote.data`, not `current`: falling back to the preview here swapped the totals
  // out and back on every refetch, flickering every priced line.
  const bill = input !== null && quote.data ? quote.data : preview;

  return (
    <BillContext.Provider value={bill}>
      <QuoteStateContext.Provider
        value={{
          current,
          data: input !== null ? quote.data : undefined,
          fetching: input !== null && quote.isFetching,
          error: quote.isError ? quote.error.message : undefined,
          waiting: input !== null && current === undefined,
        }}
      >
        {children}
      </QuoteStateContext.Provider>
    </BillContext.Provider>
  );
}

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

function ChosenPatient({ patient, onChange }: { patient: SelectedPatient; onChange: () => void }) {
  return (
    <div className="flex min-h-10 items-center gap-2 rounded-md bg-muted px-3">
      <Monogram label={patient.name} />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate font-medium">{patient.name}</span>
        <span className="truncate font-mono text-muted-foreground">{patient.mrn}</span>
      </span>
      <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={onChange}>
        Change
      </Button>
    </div>
  );
}

// One behaviour whether or not the address named a patient: `?patientId` seeds the
// field and the field owns it from there.
function PatientField({ orgSlug }: { orgSlug: string }) {
  const { control, setValue, setFocus } = useFormContext<IntakeValues>();
  const patient = useWatch({ control, name: "patient", exact: true });

  if (patient) {
    return (
      <ChosenPatient
        patient={patient}
        onChange={() => setValue("patient", null, { shouldDirty: true })}
      />
    );
  }

  return (
    <OpdPatientSearch
      orgSlug={orgSlug}
      onSelect={(selected) => {
        setValue("patient", selected, { shouldDirty: true });
        requestAnimationFrame(() => setFocus("departmentId"));
      }}
    />
  );
}

// The only place that reads `isDirty` — it flips once a session, so publishing it
// here keeps the fields out of the subscription.
function IntakeFrame({
  pending,
  onSubmit,
  children,
}: {
  pending: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
}) {
  const { control } = useFormContext<IntakeValues>();
  const { isDirty } = useFormState({ control });

  return (
    // `noValidate`: Zod owns every message, so the browser must not pre-empt it.
    <form noValidate data-intake-form data-dirty={isDirty} onSubmit={onSubmit}>
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
    </form>
  );
}

function CareTeamFields({
  orgSlug,
  canSettleWalkIn,
}: {
  orgSlug: string;
  canSettleWalkIn: boolean;
}) {
  const form = useFormContext<IntakeValues>();
  const { timeZone } = useOrgDateTime();
  const departments = useQuery(orpc.staff.listDepartments.queryOptions({ input: { orgSlug } }));
  const practitioners = useQuery(orpc.staff.listPractitioners.queryOptions({ input: { orgSlug } }));
  const departmentId = useWatch({ control: form.control, name: "departmentId", exact: true });
  const when = useWatch({ control: form.control, name: "when", exact: true });

  const error = departments.error ?? practitioners.error;
  const optionsPending = departments.isPending || practitioners.isPending;
  const practitionerOptions = (practitioners.data ?? []).filter(
    (practitioner) => practitioner.departmentId === departmentId,
  );

  return (
    <div className="grid gap-3">
      {error ? (
        <div role="alert" className="border-l-2 border-destructive pl-3">
          <p className="font-medium">Could not load intake options</p>
          <p className="text-muted-foreground">{error.message}</p>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {/* Both selects take their options from a query, so they must be
            controlled — `register` writes the DOM value once and the browser
            drops it while the list is still empty. */}
        <FormField
          control={form.control}
          name="departmentId"
          render={({ field }) => (
            <FormItem className="gap-2">
              <FormLabel className="text-muted-foreground">
                Department <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <NativeSelect
                  {...field}
                  disabled={optionsPending}
                  onChange={(event) => {
                    field.onChange(event);
                    // The old practitioner belongs to the old department.
                    form.setValue("practitionerId", "", { shouldDirty: true });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && event.currentTarget.value) {
                      event.preventDefault();
                      form.setFocus("practitionerId");
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
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="practitionerId"
          render={({ field }) => (
            <FormItem className="gap-2">
              <FormLabel className="text-muted-foreground">
                Practitioner <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <NativeSelect
                  {...field}
                  disabled={!departmentId || optionsPending}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && event.currentTarget.value) {
                      event.preventDefault();
                      form.setFocus("when");
                    }
                  }}
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
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <RegisteredFormField
          name="when"
          render={({ field }) => (
            <FormItem className="gap-2">
              <FormLabel className="text-muted-foreground">When</FormLabel>
              <FormControl>
                <NativeSelect
                  {...field}
                  onChange={(event) => {
                    field.onChange(event);
                    // Booking rejects consultation items; drop them rather than surface the server
                    // error on the date-and-time field.
                    if (event.target.value !== "later") return;
                    const kept = form
                      .getValues("services")
                      .filter((service) => service.category !== "consultation");
                    form.setValue("services", kept, { shouldDirty: true });
                  }}
                >
                  <option value="now">Now</option>
                  <option value="later">Later</option>
                </NativeSelect>
              </FormControl>
            </FormItem>
          )}
        />

        {when === "later" ? (
          <RegisteredFormField
            name="scheduledLocal"
            render={({ field }) => (
              <FormItem className="gap-2">
                <FormLabel className="text-muted-foreground">
                  Date and time · {timeZone} <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <Input {...field} type="datetime-local" className="tabular-nums" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}
      </div>
      {!canSettleWalkIn && when === "now" ? (
        <p className="text-muted-foreground">
          Your role can schedule appointments but cannot collect a walk-in payment
        </p>
      ) : null}
    </div>
  );
}

// Nothing here reads the patient: the catalog is priced the same for everyone and
// the submit button already refuses without one.
function ServicesFields({ orgSlug }: { orgSlug: string }) {
  const form = useFormContext<IntakeValues>();
  const bill = useBill();
  const quote = useQuoteState();
  const when = useWatch({ control: form.control, name: "when", exact: true });
  const services = useWatch({ control: form.control, name: "services", exact: true });
  const omitConsultFee = useWatch({ control: form.control, name: "omitConsultFee", exact: true });

  // Identity, not payload: a quantity edit leaves the picker's props untouched.
  const chosenIds = services.map((service) => service.catalogItemId).join(" ");
  const setServices = (next: ServiceLine[]) =>
    form.setValue("services", next, { shouldDirty: true });
  const addService = (line: ServiceLine) =>
    form.setValue("services", [...form.getValues("services"), line], { shouldDirty: true });
  const manualConsult = services.some((service) => service.category === "consultation");
  const quotedConsult = quote.current?.lines.some((line) => line.source === "consultation");

  return (
    <div className="grid gap-3">
      <ServicePicker
        orgSlug={orgSlug}
        chosenIds={chosenIds}
        allowConsultation={when === "now"}
        onAdd={addService}
      />
      {quote.fetching ? (
        <p role="status" className="text-muted-foreground">
          Recalculating subtotal, discount and tax…
        </p>
      ) : null}
      {when === "now" && quote.error ? (
        <div role="alert" className="border-l-2 border-destructive pl-3">
          <p className="font-medium">Could not calculate the bill</p>
          <p className="text-muted-foreground">{quote.error}</p>
        </div>
      ) : null}
      <ServiceLines
        quote={bill}
        services={services}
        onChange={setServices}
        onRemoveConsult={() => form.setValue("omitConsultFee", true, { shouldDirty: true })}
      />
      <div className="border-t border-border pt-3 xl:hidden">
        <FinancialSummary quote={bill} />
      </div>
      <div className="grid gap-1 text-muted-foreground">
        {when === "now" ? (
          manualConsult ? (
            <p>Using the consultation you picked</p>
          ) : omitConsultFee ? (
            <p className="flex items-center gap-1">
              <span>
                {quote.current && !quotedConsult
                  ? "Consultation fee removed"
                  : "Updating consultation fee"}
              </span>
              <span aria-hidden="true">·</span>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => form.setValue("omitConsultFee", false, { shouldDirty: true })}
              >
                Restore fee
              </Button>
            </p>
          ) : quote.current && !quotedConsult ? (
            <p>
              No consultation fee is configured for this practitioner. Search the catalog to add
              one.
            </p>
          ) : null
        ) : null}
        <p>Billing a procedure, lab test or X-ray does not mark that clinical work as completed</p>
      </div>
    </div>
  );
}

// Only the reasons no field owns: the schema and `handleSubmit` cover the rest and
// land the cursor on the offending control themselves.
function blockingReason(
  hasPatient: boolean,
  canSettleWalkIn: boolean,
  when: IntakeValues["when"],
  quote: QuoteState,
): string | undefined {
  if (!hasPatient) return "Choose or register a patient.";
  if (when !== "now") return undefined;
  if (!canSettleWalkIn) return "Your role cannot settle an immediate appointment.";
  if (quote.waiting) return quote.error ?? "Waiting for the current quote.";
  return undefined;
}

function IntakeSubmit({
  id,
  canSettleWalkIn,
  pending,
  actionError,
  messageClassName,
}: {
  id: string;
  canSettleWalkIn: boolean;
  pending: boolean;
  actionError: string | undefined;
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
  const quote = useQuoteState();
  const reason = blockingReason(hasPatient, canSettleWalkIn, when, quote);
  const zeroWalkIn = quote.current !== undefined && toPaise(quote.current.grandTotal) === 0;

  return (
    <>
      <SubmitButton
        isSubmitting={pending}
        aria-disabled={reason ? true : undefined}
        aria-describedby={reason ? id : undefined}
      >
        {when === "now"
          ? zeroWalkIn
            ? "Create walk-in"
            : "Review and collect"
          : "Book appointment"}
      </SubmitButton>
      {reason ? (
        <p id={id} className={cn("text-muted-foreground", messageClassName)}>
          {reason}
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" className={cn("text-destructive", messageClassName)}>
          {actionError}
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

function FinancialAside({
  canSettleWalkIn,
  pending,
  actionError,
}: {
  canSettleWalkIn: boolean;
  pending: boolean;
  actionError: string | undefined;
}) {
  const { control } = useFormContext<IntakeValues>();
  const when = useWatch({ control, name: "when", exact: true });
  const patientName = useWatch({
    control,
    name: "patient",
    exact: true,
    compute: (patient: SelectedPatient | null) => patient?.name ?? "—",
  });
  const bill = useBill();
  const previewTime = useScheduledPreview();

  return (
    <div className="sticky top-4 flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-3">
        <h2 className="text-xs text-muted-foreground">Financial preview</h2>
        <FinancialSummary quote={bill} />
        {when === "later" ? (
          <dl className="grid gap-2">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Patient</dt>
              <dd>{patientName}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Time</dt>
              <dd className="tabular-nums">{previewTime || "—"}</dd>
            </div>
          </dl>
        ) : null}
      </div>
      <IntakeSubmit
        id="intake-desktop-issue"
        canSettleWalkIn={canSettleWalkIn}
        pending={pending}
        actionError={actionError}
      />
    </div>
  );
}

function IntakeFooter({
  canSettleWalkIn,
  pending,
  actionError,
}: {
  canSettleWalkIn: boolean;
  pending: boolean;
  actionError: string | undefined;
}) {
  const { control } = useFormContext<IntakeValues>();
  const when = useWatch({ control, name: "when", exact: true });
  const bill = useBill();
  const previewTime = useScheduledPreview();
  const lineCount = bill.lines.length;

  return (
    <footer className="absolute inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-border bg-card p-3 xl:hidden">
      <div className="min-w-0">
        <p className="truncate text-muted-foreground">
          {when === "now"
            ? `Payable · ${lineCount} line${lineCount === 1 ? "" : "s"}`
            : "Appointment time"}
        </p>
        <p className="truncate text-sm font-medium tabular-nums">
          {when === "now"
            ? formatMoney(bill.grandTotal, bill.currency)
            : previewTime || "Choose a time"}
        </p>
      </div>
      <div className="ml-auto grid shrink-0 justify-items-end gap-1">
        <IntakeSubmit
          id="intake-mobile-issue"
          canSettleWalkIn={canSettleWalkIn}
          pending={pending}
          actionError={actionError}
          messageClassName="max-w-48 text-right"
        />
      </div>
    </footer>
  );
}

/** Stays mounted while its displayed bill refreshes. */
function SettlementGate({
  pending,
  error,
  onOpenChange,
  onConfirm,
}: {
  pending: boolean;
  error: string | undefined;
  onOpenChange: (open: boolean) => void;
  onConfirm: (settlement: SettlementDraft) => void;
}) {
  const { control } = useFormContext<IntakeValues>();
  const patientName = useWatch({
    control,
    name: "patient",
    exact: true,
    compute: (patient: SelectedPatient | null) => patient?.name ?? "",
  });
  const quote = useQuoteState();
  if (!quote.data || !patientName) return null;

  const blockedReason = quote.current
    ? undefined
    : (quote.error ??
      (quote.fetching ? "Quote is updating. Wait to confirm." : "Waiting for the current quote."));

  return (
    <ClientOnly fallback={null}>
      <SettlementOverlay
        quote={quote.data}
        description={`${patientName} · walk-in now`}
        label="Confirm walk-in"
        blockedReason={blockedReason}
        pending={pending}
        error={error}
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />
    </ClientOnly>
  );
}

export function OpdIntakeForm({
  orgSlug,
  /** From `?patientId`: the patient this page opened with, if the link named one. */
  seedPatientId,
}: {
  orgSlug: string;
  seedPatientId?: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canSettleWalkIn = useCan(orgSlug, { billing: ["write"] });
  // Read, not subscribed: the loader already awaited this record, and it never
  // changes while this page is open.
  const [initialPatient] = useState<SelectedPatient | null>(() => {
    if (!seedPatientId) return null;
    const record = queryClient.getQueryData(
      orpc.patient.get.queryOptions({ input: { orgSlug, patientId: seedPatientId } }).queryKey,
    );
    if (!record) throw new Error(`Patient ${seedPatientId} was not loaded for intake`);
    return { id: record.id, name: record.name, mrn: record.mrn };
  });
  const intake = useZodForm(intakeSchema, { defaultValues: defaultValues(initialPatient) });
  const [settlementOpen, setSettlementOpen] = useState(false);

  const goToAppointment = async (appointmentId: string) => {
    // `ignoreBlocker`: the appointment is saved, so the unsaved-changes guard has
    // nothing left to protect.
    await navigate({
      to: "/$orgSlug/opd/$appointmentId",
      params: { orgSlug, appointmentId },
      ignoreBlocker: true,
    });
    void invalidateOpdAppointmentState(queryClient, orgSlug, appointmentId, "create");
  };

  const book = useMutation(
    orpc.opd.book.mutationOptions({
      onSuccess: async (appointment) => {
        toast.success("Appointment booked");
        await goToAppointment(appointment.id);
      },
      onError: (error) =>
        intake.setError("scheduledLocal", { message: error.message }, { shouldFocus: true }),
    }),
  );

  const createWalkIn = useMutation(
    orpc.opd.createWalkIn.mutationOptions({
      onSuccess: async ({ appointment }) => {
        setSettlementOpen(false);
        toast.success(`Token ${appointment.tokenNumber} created`);
        await goToAppointment(appointment.id);
      },
    }),
  );

  const pending = book.isPending || createWalkIn.isPending;

  // Read from the cache rather than subscribed to, so pricing a walk-in never
  // re-renders this component or the fields under it.
  const settleableQuote = (values: IntakeValues) => {
    const input = quoteInput(orgSlug, values);
    if (!input) return undefined;
    const { queryKey } = orpc.opd.quoteWalkIn.queryOptions({ input });
    const state = queryClient.getQueryState<WalkInQuote>(queryKey);
    return state?.status === "success" && state.fetchStatus === "idle" ? state.data : undefined;
  };

  const settleWalkIn = (settlement: SettlementDraft) => {
    const values = intake.getValues();
    if (!values.patient || !canSettleWalkIn || !settleableQuote(values)) return;
    createWalkIn.mutate({
      orgSlug,
      patientId: values.patient.id,
      departmentId: values.departmentId,
      practitionerId: values.practitionerId,
      settlement: {
        services: serviceClaims(values.services),
        omitConsultFee: omitsConsultFee(values),
        ...settlement,
      },
    });
  };

  const submitValidated = intake.handleSubmit((values) => {
    if (!values.patient) return;

    if (values.when === "later") {
      book.mutate({
        orgSlug,
        patientId: values.patient.id,
        departmentId: values.departmentId,
        practitionerId: values.practitionerId,
        scheduledLocal: values.scheduledLocal,
        services: serviceClaims(values.services),
      });
      return;
    }

    const quote = settleableQuote(values);
    if (!canSettleWalkIn || !quote) return;
    // Nothing to collect, so there is nothing for the overlay to ask.
    if (toPaise(quote.grandTotal) === 0) {
      return settleWalkIn({
        discountAmount: "0",
        expectedGrandTotal: quote.grandTotal,
        payments: [],
      });
    }
    setSettlementOpen(true);
  });

  // The patient has no control of its own, so it is checked before the schema runs —
  // otherwise the message says "choose a patient" while the cursor lands in Department.
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (intake.getValues("patient")) return void submitValidated(event);
    event.preventDefault();
    document.getElementById("patient-search")?.focus();
  };

  const actionError = settlementOpen ? undefined : createWalkIn.error?.message;

  return (
    <Form {...intake}>
      <QuoteProvider orgSlug={orgSlug}>
        <IntakeFrame pending={pending} onSubmit={onSubmit}>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
              <IntakeSection title="Patient" description="Search or register">
                <PatientField orgSlug={orgSlug} />
              </IntakeSection>

              <IntakeSection
                title="Care team"
                description="Configured attendance fees appear in Services"
              >
                <CareTeamFields orgSlug={orgSlug} canSettleWalkIn={canSettleWalkIn} />
              </IntakeSection>

              <IntakeSection title="Services" description="Optional for Now and Later">
                <ServicesFields orgSlug={orgSlug} />
              </IntakeSection>
            </div>

            <aside className="hidden xl:block">
              <FinancialAside
                canSettleWalkIn={canSettleWalkIn}
                pending={pending}
                actionError={actionError}
              />
            </aside>
          </div>

          <IntakeFooter
            canSettleWalkIn={canSettleWalkIn}
            pending={pending}
            actionError={actionError}
          />

          {settlementOpen ? (
            <SettlementGate
              pending={createWalkIn.isPending}
              error={createWalkIn.error?.message}
              onOpenChange={setSettlementOpen}
              onConfirm={settleWalkIn}
            />
          ) : null}
        </IntakeFrame>
      </QuoteProvider>
    </Form>
  );
}
