import { authorize } from "@hms/auth/access";
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
import {
  keepPreviousData,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ClientOnly, useBlocker, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useFormContext, useFormState, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { FinancialAside, IntakeFooter, type QuoteState } from "@/components/opd-intake-quote";
import { omitsConsultFee, ServicesFields } from "@/components/opd-intake-service-fields";
import { SettlementOverlay, type SettlementDraft } from "@/components/opd-settlement-overlay";
import {
  OpdPatientSearch,
  SelectedPatientChip,
  type SelectedPatient,
} from "@/components/opd-patient-picker";
import { OptionCombobox } from "@/components/option-combobox";
import { FormSection } from "@/components/page";
import { type ServiceLine } from "@/components/opd-service-picker";
import { useZodForm } from "@/hooks/use-zod-form";
import { useMembership } from "@/lib/membership";
import { ZERO } from "@/lib/money";
import { useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { closeOnConflict, errorMessage } from "@/lib/orpc-error";
import { openingCredit, type PatientCredit } from "@/lib/patient-credit";
import { practitionerDisplayName } from "@/lib/practitioner-name";

const intakeSchema = z
  .object({
    patient: z.custom<SelectedPatient | null>(),
    when: z.enum(["now", "later"]),
    departmentId: z.string().min(1, "Choose a department"),
    practitionerId: z.string().min(1, "Choose a practitioner"),
    treatmentPlanId: z.string(),
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

export type IntakeValues = z.input<typeof intakeSchema>;

type IntakeDepartment = { id: string; name: string };

export type IntakePractitioner = { id: string; name: string; departmentId: string };

function serviceClaims(services: ServiceLine[]) {
  return services.map(({ catalogItemId, qty, customUnitPrice }) => ({
    catalogItemId,
    qty,
    unitPrice: customUnitPrice,
  }));
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
  };
}

function PatientField({ orgSlug }: { orgSlug: string }) {
  const { control, setValue, setFocus } = useFormContext<IntakeValues>();
  const patient = useWatch({ control, name: "patient", exact: true });

  if (patient) {
    return (
      <SelectedPatientChip
        patient={patient}
        onClear={() => {
          setValue("patient", null, { shouldDirty: true });
          setValue("treatmentPlanId", "", { shouldDirty: true });
        }}
      />
    );
  }

  return (
    <OpdPatientSearch
      orgSlug={orgSlug}
      onSelect={(selected) => {
        setValue("patient", selected, { shouldDirty: true });
        setValue("treatmentPlanId", "", { shouldDirty: true });
        requestAnimationFrame(() => setFocus("departmentId"));
      }}
    />
  );
}

function SittingForField({ orgSlug }: { orgSlug: string }) {
  const form = useFormContext<IntakeValues>();
  const patient = useWatch({ control: form.control, name: "patient", exact: true });

  const patientRecord = useQuery(
    orpc.patient.get.queryOptions({
      input: patient ? { orgSlug, patientId: patient.id } : skipToken,
    }),
  );

  if (!patient || !patientRecord.data?.openTreatmentPlans.length) return null;

  return (
    <FormSection title="Sitting for">
      <FormField
        control={form.control}
        name="treatmentPlanId"
        render={({ field }) => (
          <FormItem className="max-w-md gap-2">
            <FormLabel className="text-muted-foreground">Treatment plan</FormLabel>
            <FormControl>
              <OptionCombobox
                {...field}
                options={[
                  { value: "", label: "Not linked to a plan" },
                  ...patientRecord.data.openTreatmentPlans.map((plan) => ({
                    value: plan.id,
                    label: plan.label,
                  })),
                ]}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </FormSection>
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
                <OptionCombobox
                  {...field}
                  options={departments.map((department) => ({
                    value: department.id,
                    label: department.name,
                  }))}
                  placeholder="Choose a department"
                  onChange={(value) => {
                    form.setValue("practitionerId", "", { shouldDirty: true });
                    field.onChange(value);
                  }}
                  onEnter={() => form.setFocus("practitionerId")}
                />
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
                <OptionCombobox
                  {...field}
                  options={practitionerOptions.map((practitioner) => ({
                    value: practitioner.id,
                    label: practitionerDisplayName(practitioner.name),
                  }))}
                  placeholder={departmentId ? "Choose a practitioner" : "Choose a department first"}
                  disabled={!departmentId}
                  className="capitalize"
                  itemClassName="capitalize"
                  onEnter={() => form.setFocus("when")}
                />
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

/** Its own leaf so a dirty flip re-renders only this guard, not the form host. */
function IntakeLeaveGuard() {
  const { control } = useFormContext<IntakeValues>();
  const { isDirty } = useFormState({ control });

  const blocker = useBlocker({
    shouldBlockFn: () => isDirty,
    enableBeforeUnload: isDirty,
    withResolver: true,
  });

  return blocker.status === "blocked" ? (
    <ConfirmDialog
      title="Discard unsaved appointment?"
      description="Unsaved changes will be discarded."
      confirmLabel="Discard changes"
      open
      onConfirm={blocker.proceed}
      onCancel={blocker.reset}
    />
  ) : null;
}

export function OpdIntakeForm({
  orgSlug,
  seedPatient,
  seedTreatmentPlanId,
  departments,
  practitioners,
}: {
  orgSlug: string;
  seedPatient?: SelectedPatient;
  seedTreatmentPlanId?: string;
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
      treatmentPlanId: seedTreatmentPlanId ?? "",
      scheduledLocal: "",
      services: [],
      omitConsultFee: false,
    },
  });

  const input = useWatch({
    control: intake.control,
    compute: (values: IntakeValues) => quoteInput(orgSlug, values),
  });

  const quote = useQuery({
    ...orpc.opd.quoteWalkIn.queryOptions({ input: input ?? skipToken }),
    staleTime: 0,
    placeholderData: keepPreviousData,
  });

  const quoteReady = input !== null && quote.isSuccess && !quote.isFetching;

  const quoteState: QuoteState = {
    data:
      // keepPreviousData holds the last good quote through a failed refetch; never show it.
      input !== null && quote.data && !quote.isError
        ? quote.data
        : {
            currency,
            subtotal: ZERO,
            discountAmount: ZERO,
            taxTotal: ZERO,
            roundOff: ZERO,
            grandTotal: ZERO,
            lines: [],
          },
    fetching: input !== null && quote.isFetching,
    error: input !== null && quote.isError ? quote.error : null,
    ready: quoteReady,
  };

  // The credit the overlay opens with, read on Confirm; null while it is closed.
  const [settlement, setSettlement] = useState<PatientCredit | null>(null);

  const goToAppointment = async (appointmentId: string) => {
    await navigate({
      to: "/$orgSlug/opd/$appointmentId",
      params: { orgSlug, appointmentId },
      ignoreBlocker: true,
    });
  };

  const book = useMutation(
    orpc.opd.book.mutationOptions({
      onSuccess: async (appointment) => {
        toast.success("Appointment booked");
        await goToAppointment(appointment.id);
      },
    }),
  );

  const createWalkIn = useMutation(
    orpc.opd.createWalkIn.mutationOptions({
      onSuccess: async ({ appointment }) => {
        setSettlement(null);
        toast.success(`Token ${appointment.tokenNumber} created`);
        await goToAppointment(appointment.id);
      },
      // The overlay holds the quote the server refused; the refresh brings the new one.
      onError: closeOnConflict(() => setSettlement(null)),
    }),
  );

  const pending = book.isPending || createWalkIn.isPending;

  const settleWalkIn = (settlement: SettlementDraft) => {
    const current = intake.getValues();

    if (!current.patient || !canSettleWalkIn) return;
    createWalkIn.mutate({
      orgSlug,
      patientId: current.patient.id,
      practitionerId: current.practitionerId,
      treatmentPlanId: current.treatmentPlanId || undefined,
      settlement: {
        services: serviceClaims(current.services),
        omitConsultFee: omitsConsultFee(current),
        ...settlement,
      },
    });
  };

  const submitValidated = intake.handleSubmit(async (current) => {
    if (!current.patient) return;

    if (current.when === "later") {
      book.mutate({
        orgSlug,
        patientId: current.patient.id,
        practitionerId: current.practitionerId,
        treatmentPlanId: current.treatmentPlanId || undefined,
        scheduledLocal: current.scheduledLocal,
        services: serviceClaims(current.services),
      });

      return;
    }

    const input = quoteInput(orgSlug, current);

    if (!canSettleWalkIn || !input) return;

    const fresh = await queryClient
      .query(orpc.opd.quoteWalkIn.queryOptions({ input }))
      .catch(() => undefined);

    if (!fresh) return;

    if (fresh.grandTotal === ZERO) {
      settleWalkIn({
        applyCredit: ZERO,
        discountAmount: ZERO,
        expectedGrandTotal: fresh.grandTotal,
        payments: [],
      });

      return;
    }

    const credit = await openingCredit(
      queryClient,
      orgSlug,
      current.patient.id,
      current.treatmentPlanId || null,
    );

    if (credit === null) return;
    setSettlement(credit);
  });

  const settlementBlockedReason = quoteState.ready
    ? undefined
    : quoteState.error
      ? errorMessage(quoteState.error, "Could not calculate the bill")
      : quoteState.fetching
        ? "Quote is updating. Wait to confirm."
        : "Waiting for the current quote.";

  const settlementPatient = settlement === null ? null : intake.getValues("patient");

  return (
    <Form {...intake}>
      <form noValidate onSubmit={submitValidated}>
        <fieldset
          disabled={pending}
          aria-busy={quoteState.fetching}
          className="group/quote contents"
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
              <FormSection title="Patient">
                <PatientField orgSlug={orgSlug} />
              </FormSection>

              <FormSection
                title="Care team"
                description="Configured attendance fees appear in Services"
              >
                <CareTeamFields
                  departments={departments}
                  practitioners={practitioners}
                  canSettleWalkIn={canSettleWalkIn}
                />
              </FormSection>

              <SittingForField orgSlug={orgSlug} />

              <FormSection title="Services">
                <ServicesFields orgSlug={orgSlug} currency={currency} quoteState={quoteState} />
              </FormSection>
            </div>

            <aside className="hidden lg:block">
              <FinancialAside
                practitioners={practitioners}
                canSettleWalkIn={canSettleWalkIn}
                pending={pending}
                quoteState={quoteState}
              />
            </aside>
          </div>

          <IntakeFooter
            canSettleWalkIn={canSettleWalkIn}
            pending={pending}
            quoteState={quoteState}
          />

          {settlement !== null && settlementPatient ? (
            <ClientOnly fallback={null}>
              <SettlementOverlay
                quote={quoteState.data}
                stream="opd"
                availableCredit={settlement}
                description={`${settlementPatient.name} · walk-in now`}
                label="Confirm walk-in"
                blockedReason={settlementBlockedReason}
                pending={createWalkIn.isPending}
                onOpenChange={(open) => {
                  if (!open) setSettlement(null);
                }}
                onConfirm={settleWalkIn}
              />
            </ClientOnly>
          ) : null}
        </fieldset>
      </form>
      <IntakeLeaveGuard />
    </Form>
  );
}
