import { toPaise } from "@hms/api/lib/invoice-math";
import { authorize } from "@hms/auth/access";
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
import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClientOnly, useBlocker, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useFormContext, useFormState, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Monogram } from "@/components/monogram";
import { FinancialSummary } from "@/components/opd-financial-summary";
import { SettlementOverlay, type SettlementDraft } from "@/components/opd-settlement-overlay";
import { ServiceLines } from "@/components/opd-intake-services";
import { OpdPatientSearch, type SelectedPatient } from "@/components/opd-patient-picker";
import { Panel } from "@/components/page";
import { ServicePicker, type ServiceLine } from "@/components/opd-service-picker";
import { useZodForm } from "@/hooks/use-zod-form";
import {
  invalidateAccountingReports,
  invalidateOpdAppointmentState,
} from "@/lib/domain-invalidation";
import { useMembership } from "@/lib/membership";
import { formatMoney } from "@/lib/money";
import { type WalkInQuote } from "@/lib/opd-service-preview";
import { formatBusinessDate, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { errorMessage, hasErrorCode } from "@/lib/orpc-error";

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
type IntakeDepartment = { id: string; name: string };
type IntakePractitioner = { id: string; name: string; departmentId: string };

function serviceClaims(services: ServiceLine[]) {
  return services.map(({ catalogItemId, qty }) => ({ catalogItemId, qty }));
}

/** A consultation the operator picked replaces the practitioner's own fee. */
function omitsConsultFee(values: IntakeValues) {
  return values.omitConsultFee || values.services.some((s) => s.category === "consultation");
}

function quoteInput(orgSlug: string, values: IntakeValues) {
  if (values.when !== "now" || !values.patient || !values.practitionerId) {
    return null;
  }
  return {
    orgSlug,
    patientId: values.patient.id,
    practitionerId: values.practitionerId,
    services: serviceClaims(values.services),
    omitConsultFee: omitsConsultFee(values),
    discountAmount: "0",
  };
}

type QuoteState = {
  data: WalkInQuote;
  fetching: boolean;
  error: Error | null;
  ready: boolean;
};

function IntakeSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-3 border-b border-border p-4 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className="font-medium">{title}</h2>
        {description ? <p className="text-muted-foreground">{description}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

// One behaviour whether or not the address named a patient: `?patientId` seeds the
// field and the field owns it from there.
function PatientField({ orgSlug }: { orgSlug: string }) {
  const { control, setValue, setFocus } = useFormContext<IntakeValues>();
  const patient = useWatch({ control, name: "patient", exact: true });

  if (patient) {
    return (
      <div className="flex min-h-10 items-center gap-2 rounded-md bg-muted px-3">
        <Monogram label={patient.name} />
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate font-medium capitalize">{patient.name}</span>
          <span className="truncate font-mono text-muted-foreground">{patient.mrn}</span>
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={() => setValue("patient", null, { shouldDirty: true })}
        >
          Change
        </Button>
      </div>
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

function CareTeamFields({
  departments,
  practitioners,
  canSettleWalkIn,
}: {
  departments: IntakeDepartment[];
  practitioners: IntakePractitioner[];
  canSettleWalkIn: boolean;
}) {
  const form = useFormContext<IntakeValues>();
  const { timeZone } = useOrgDateTime();
  const departmentId = useWatch({
    control: form.control,
    name: "departmentId",
    exact: true,
  });
  const when = useWatch({ control: form.control, name: "when", exact: true });

  const practitionerOptions = practitioners.filter(
    (practitioner) => practitioner.departmentId === departmentId,
  );

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
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
                  onChange={(event) => {
                    // The old practitioner belongs to the old department.
                    form.setValue("practitionerId", "", { shouldDirty: true });
                    field.onChange(event);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && event.currentTarget.value) {
                      event.preventDefault();
                      form.setFocus("practitionerId");
                    }
                  }}
                >
                  <option value="">Choose a department</option>
                  {departments.map((department) => (
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
                  disabled={!departmentId}
                  className="capitalize"
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
                    if (event.currentTarget.value !== "later") return;
                    const services = form.getValues("services");
                    const bookable = services.filter(
                      (service) => service.category !== "consultation",
                    );
                    if (bookable.length !== services.length) {
                      form.setValue("services", bookable, { shouldDirty: true });
                    }
                    if (form.getValues("omitConsultFee")) {
                      form.setValue("omitConsultFee", false, { shouldDirty: true });
                    }
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

function ServicesFields({
  orgSlug,
  currency,
  quoteState,
}: {
  orgSlug: string;
  currency: string;
  quoteState: QuoteState;
}) {
  const form = useFormContext<IntakeValues>();
  const when = useWatch({ control: form.control, name: "when", exact: true });
  const services = useWatch({
    control: form.control,
    name: "services",
    exact: true,
  });
  const omitConsultFee = useWatch({
    control: form.control,
    name: "omitConsultFee",
    exact: true,
  });
  const consultation = quoteState.data.lines.find((line) => line.source === "consultation");
  const serviceGross = new Map(
    quoteState.data.lines
      .filter((line) => line.source === "service")
      .map((line) => [line.chargeId, line.gross]),
  );
  const chosen = new Set([
    ...services.map((service) => service.catalogItemId),
    ...(consultation ? [consultation.chargeId] : []),
  ]);
  const lines = [
    ...(when === "now" && consultation
      ? [
          {
            key: "consultation",
            description: consultation.description,
            category: consultation.category,
            qty: 1,
            unitPrice: consultation.unitPrice,
            taxRatePercent: consultation.taxRatePercent,
            gross: consultation.gross,
            editable: false,
          },
        ]
      : []),
    ...services.map((service) => ({
      key: service.catalogItemId,
      description: service.name,
      category: service.category,
      qty: service.qty,
      unitPrice: service.unitPrice,
      taxRatePercent: service.taxRatePercent,
      gross: when === "now" ? serviceGross.get(service.catalogItemId) : undefined,
      editable: true,
    })),
  ];

  const setQty = (catalogItemId: string, qty: number) =>
    form.setValue(
      "services",
      services.map((service) =>
        service.catalogItemId === catalogItemId ? { ...service, qty } : service,
      ),
      { shouldDirty: true },
    );

  const remove = (catalogItemId: string, editable: boolean) => {
    if (!editable) {
      form.setValue("omitConsultFee", true, { shouldDirty: true });
      return;
    }
    form.setValue(
      "services",
      services.filter((service) => service.catalogItemId !== catalogItemId),
      { shouldDirty: true },
    );
  };

  return (
    <div className="grid gap-3">
      <ServicePicker
        orgSlug={orgSlug}
        chosen={chosen}
        allowConsultation={when === "now"}
        onAdd={(line) => form.setValue("services", [...services, line], { shouldDirty: true })}
      />
      {when === "now" && !quoteState.ready && quoteState.error ? (
        <div role="alert" className="border-l-2 border-destructive pl-3">
          <p className="font-medium">Could not calculate the bill</p>
          <p className="text-muted-foreground">
            {errorMessage(quoteState.error, "Could not reach the server")}
          </p>
        </div>
      ) : null}
      <ServiceLines lines={lines} currency={currency} onQuantityChange={setQty} onRemove={remove} />
      {/* A line-level action, so it stays with the lines rather than below the totals. */}
      {when === "now" && omitConsultFee ? (
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="justify-self-start"
          onClick={() => form.setValue("omitConsultFee", false, { shouldDirty: true })}
        >
          Restore consultation fee
        </Button>
      ) : null}
      {when === "now" ? (
        <div className="border-t border-border pt-3 lg:hidden">
          <FinancialSummary quote={quoteState.data} />
        </div>
      ) : null}
    </div>
  );
}

function IntakeSubmit({
  id,
  canSettleWalkIn,
  pending,
  actionError,
  quoteState,
  messageClassName,
}: {
  id: string;
  canSettleWalkIn: boolean;
  pending: boolean;
  actionError: string | undefined;
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
  // Only a reason the operator cannot see on the form itself is worth words; an
  // unchosen patient is already obvious from the empty field above.
  const reason =
    when === "now" && !canSettleWalkIn
      ? "Your role cannot settle an immediate appointment."
      : when === "now" && quoteState.error
        ? errorMessage(quoteState.error, "Could not calculate the bill")
        : undefined;
  const blocked = !hasPatient || Boolean(reason) || (when === "now" && !quoteState.ready);

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

function SummaryRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 truncate text-right">{children}</dd>
    </div>
  );
}

function FinancialAside({
  practitioners,
  canSettleWalkIn,
  pending,
  actionError,
  quoteState,
}: {
  practitioners: IntakePractitioner[];
  canSettleWalkIn: boolean;
  pending: boolean;
  actionError: string | undefined;
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
  const practitionerName =
    practitioners.find((practitioner) => practitioner.id === practitionerId)?.name ?? "—";

  return (
    // `top-0` keeps the tray level with the form card: sticky offsets are measured
    // from PageBody's padding edge, so any offset here drops it below the card.
    <div className="sticky top-0">
      <Panel label={when === "now" ? "Payment" : "Booking"} minHeight="min-h-0" padded>
        {when === "now" ? <FinancialSummary quote={quoteState.data} /> : null}
        {when === "later" ? (
          // Nothing is billed at booking, so the panel confirms the appointment
          // itself rather than showing a column of zeroes.
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
              {serviceCount === 0 ? "None" : `${serviceCount} queued`}
            </SummaryRow>
          </dl>
        ) : null}
        <IntakeSubmit
          id="intake-desktop-issue"
          canSettleWalkIn={canSettleWalkIn}
          pending={pending}
          actionError={actionError}
          quoteState={quoteState}
        />
      </Panel>
    </div>
  );
}

function IntakeFooter({
  canSettleWalkIn,
  pending,
  actionError,
  quoteState,
}: {
  canSettleWalkIn: boolean;
  pending: boolean;
  actionError: string | undefined;
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
          {when === "now"
            ? `Payable · ${lineCount} line${lineCount === 1 ? "" : "s"}`
            : "Appointment time"}
        </p>
        <p className="truncate text-sm font-medium tabular-nums">
          {when === "now"
            ? formatMoney(quoteState.data.grandTotal, quoteState.data.currency)
            : previewTime || "Choose a time"}
        </p>
      </div>
      <div className="ml-auto grid shrink-0 justify-items-end gap-1">
        <IntakeSubmit
          id="intake-mobile-issue"
          canSettleWalkIn={canSettleWalkIn}
          pending={pending}
          actionError={actionError}
          quoteState={quoteState}
          messageClassName="max-w-48 text-right"
        />
      </div>
    </footer>
  );
}

export function OpdIntakeForm({
  orgSlug,
  seedPatient,
  departments,
  practitioners,
}: {
  orgSlug: string;
  seedPatient?: SelectedPatient;
  departments: IntakeDepartment[];
  practitioners: IntakePractitioner[];
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { roles, currency } = useMembership(orgSlug);
  const canSettleWalkIn = authorize(roles, { billing: ["write"] });
  const intake = useZodForm(intakeSchema, {
    defaultValues: {
      patient: seedPatient ?? null,
      when: "now",
      departmentId: "",
      practitionerId: "",
      scheduledLocal: "",
      services: [],
      omitConsultFee: false,
    },
  });
  const { isDirty } = useFormState({ control: intake.control });
  const blocker = useBlocker({
    shouldBlockFn: () => isDirty,
    enableBeforeUnload: isDirty,
    withResolver: true,
  });
  const input = useWatch({
    control: intake.control,
    compute: (values: IntakeValues) => quoteInput(orgSlug, values),
  });
  const quote = useQuery({
    ...orpc.opd.quoteWalkIn.queryOptions({ input: input ?? skipToken }),
    staleTime: 0,
  });
  const quoteReady = input !== null && quote.isSuccess && !quote.isFetching;
  const quoteState: QuoteState = {
    data:
      input !== null && quote.data
        ? quote.data
        : {
            currency,
            subtotal: "0.00",
            discountAmount: "0.00",
            taxTotal: "0.00",
            grandTotal: "0.00",
            lines: [],
          },
    fetching: input !== null && quote.isFetching,
    error: input !== null && quote.isError ? quote.error : null,
    ready: quoteReady,
  };
  const [settlementOpen, setSettlementOpen] = useState(false);

  const goToAppointment = async (appointmentId: string) => {
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
        intake.setError(
          "scheduledLocal",
          { message: errorMessage(error, "Could not book the appointment") },
          { shouldFocus: true },
        ),
    }),
  );

  const createWalkIn = useMutation(
    orpc.opd.createWalkIn.mutationOptions({
      onSuccess: async ({ appointment, invoice }) => {
        setSettlementOpen(false);
        toast.success(`Token ${appointment.tokenNumber} created`);
        await goToAppointment(appointment.id);
        if (invoice) {
          void Promise.all([
            queryClient.invalidateQueries({
              queryKey: orpc.patient.account.key({ input: { orgSlug } }),
            }),
            invalidateAccountingReports(queryClient, orgSlug),
          ]);
        }
      },
      onError: async (error) => {
        if (!hasErrorCode(error, "CONFLICT")) return;
        setSettlementOpen(false);
        await quote.refetch();
        toast.error(errorMessage(error, "The quote changed. Review it and try again."));
      },
    }),
  );

  const pending = book.isPending || createWalkIn.isPending;

  const settleWalkIn = (settlement: SettlementDraft) => {
    const current = intake.getValues();
    if (!current.patient || !canSettleWalkIn || !quoteState.ready) return;
    createWalkIn.mutate({
      orgSlug,
      patientId: current.patient.id,
      practitionerId: current.practitionerId,
      settlement: {
        services: serviceClaims(current.services),
        omitConsultFee: omitsConsultFee(current),
        ...settlement,
      },
    });
  };

  const submitValidated = intake.handleSubmit((current) => {
    if (!current.patient) return;

    if (current.when === "later") {
      book.mutate({
        orgSlug,
        patientId: current.patient.id,
        practitionerId: current.practitionerId,
        scheduledLocal: current.scheduledLocal,
        services: serviceClaims(current.services),
      });
      return;
    }

    if (!canSettleWalkIn || !quoteState.ready) return;
    if (toPaise(quoteState.data.grandTotal) === 0) {
      settleWalkIn({
        discountAmount: "0",
        expectedGrandTotal: quoteState.data.grandTotal,
        payments: [],
      });
      return;
    }
    setSettlementOpen(true);
  });

  const walkInError =
    createWalkIn.error && !hasErrorCode(createWalkIn.error, "CONFLICT")
      ? errorMessage(createWalkIn.error, "Could not create the appointment")
      : undefined;
  const actionError = settlementOpen ? undefined : walkInError;
  const settlementBlockedReason = quoteState.ready
    ? undefined
    : quoteState.error
      ? errorMessage(quoteState.error, "Could not calculate the bill")
      : quoteState.fetching
        ? "Quote is updating. Wait to confirm."
        : "Waiting for the current quote.";

  // The overlay opens from a submit that already proved a patient is chosen, and the
  // form behind a modal cannot change it.
  const settlementPatient = settlementOpen ? intake.getValues("patient") : null;
  return (
    <>
      <Form {...intake}>
        <form noValidate onSubmit={submitValidated}>
          <fieldset disabled={pending} className="contents">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
                <IntakeSection title="Patient">
                  <PatientField orgSlug={orgSlug} />
                </IntakeSection>

                <IntakeSection
                  title="Care team"
                  description="Configured attendance fees appear in Services"
                >
                  <CareTeamFields
                    departments={departments}
                    practitioners={practitioners}
                    canSettleWalkIn={canSettleWalkIn}
                  />
                </IntakeSection>

                <IntakeSection title="Services" description="Optional for Now and Later">
                  <ServicesFields orgSlug={orgSlug} currency={currency} quoteState={quoteState} />
                </IntakeSection>
              </div>

              <aside className="hidden lg:block">
                <FinancialAside
                  practitioners={practitioners}
                  canSettleWalkIn={canSettleWalkIn}
                  pending={pending}
                  actionError={actionError}
                  quoteState={quoteState}
                />
              </aside>
            </div>

            <IntakeFooter
              canSettleWalkIn={canSettleWalkIn}
              pending={pending}
              actionError={actionError}
              quoteState={quoteState}
            />

            {settlementOpen && settlementPatient ? (
              <ClientOnly fallback={null}>
                <SettlementOverlay
                  quote={quoteState.data}
                  description={`${settlementPatient.name} · walk-in now`}
                  label="Confirm walk-in"
                  blockedReason={settlementBlockedReason}
                  pending={createWalkIn.isPending}
                  error={walkInError}
                  onOpenChange={setSettlementOpen}
                  onConfirm={settleWalkIn}
                />
              </ClientOnly>
            ) : null}
          </fieldset>
        </form>
      </Form>
      {blocker.status === "blocked" ? (
        <ConfirmDialog
          title="Discard unsaved appointment?"
          description="This appointment has changes that have not been saved."
          confirmLabel="Discard changes"
          open
          onConfirm={blocker.proceed}
          onCancel={blocker.reset}
        />
      ) : null}
    </>
  );
}
