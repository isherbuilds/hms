import { Button } from "@hms/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@hms/ui/components/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@hms/ui/components/form";
import { Input } from "@hms/ui/components/input";
import { NativeSelect } from "@hms/ui/components/native-select";
import { SubmitButton } from "@hms/ui/components/submit-button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useZodForm } from "@/hooks/use-zod-form";
import { invalidateOpdAppointmentState } from "@/lib/domain-invalidation";
import { useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { patientAgeYears } from "@/lib/patient-age";

/**
 * A walk-in desk has a person and a phone number, not a record id. So the walk-in
 * dialog owns patient selection rather than the other way round: one field searches,
 * warns about duplicates, and offers registration, because at a front desk
 * those are the same question — "have we seen you before?".
 *
 * Registering the patient and creating the OPD appointment are two mutations, not one transaction.
 * That is deliberate: a patient saved without a token is a real record, not
 * garbage, so a failed token leaves the new patient selected here and the desk
 * retries only the token instead of re-keying the person.
 */
const appointmentSchema = z.object({
  departmentId: z.string().min(1, "Choose a department"),
  practitionerId: z.string().min(1, "Choose a practitioner"),
  kind: z.enum(["consultation", "procedure"]),
});

const quickPatientSchema = z.object({
  name: z.string().trim().min(1, "Enter the patient's name").max(200),
  phone: z.string().trim().min(4, "Enter at least 4 characters").max(20),
  sex: z.enum(["male", "female", "other", "unknown"]),
  ageYears: z.number({ error: "Enter the patient's age" }).int().min(0).max(150),
});

export type SelectedPatient = { id: string; name: string; mrn: string };

export function NewOpdWalkInDialog({
  orgSlug,
  patient,
  onClose,
}: {
  orgSlug: string;
  /** Pre-selected when opened from a patient's own record; omitted from the queue. */
  patient?: SelectedPatient;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<SelectedPatient | undefined>(patient);

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New walk-in</DialogTitle>
          <DialogDescription>
            {selected
              ? `Create today's OPD token for ${selected.name}.`
              : "Find a patient by phone or name, or register a new patient."}
          </DialogDescription>
        </DialogHeader>

        {selected ? (
          <OpdAppointmentStep
            orgSlug={orgSlug}
            patient={selected}
            // Only offer "change" when the dialog owns selection. Opened from a
            // patient's record, the patient is the context, not a choice.
            onChangePatient={patient ? undefined : () => setSelected(undefined)}
            onClose={onClose}
          />
        ) : (
          <OpdPatientPicker orgSlug={orgSlug} onSelect={setSelected} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Debounced patient search behind one free-text box. Digits mean a phone;
 * anything else is a name. Phone is an exact-prefix column match, so routing
 * it correctly is what makes one field do both jobs. Shared by the picker and
 * the booking dialog's inline patient link.
 */
export function usePatientMatches(orgSlug: string, raw: string) {
  const trimmed = raw.trim();
  const debounced = useDebouncedValue(trimmed, 300);
  const isPhone = /^[\d+\s-]+$/.test(debounced) && debounced.replace(/\D/g, "").length >= 4;

  const results = useQuery({
    ...orpc.patient.search.queryOptions({
      input: isPhone
        ? { orgSlug, phone: debounced, limit: 20 }
        : { orgSlug, query: debounced, limit: 20 },
    }),
    enabled: debounced.length >= 2,
  });

  return {
    isPhone,
    matches: trimmed === debounced ? (results.data?.items ?? []) : [],
    searched: debounced.length >= 2 && results.isSuccess && trimmed === debounced,
    error: results.isError ? results.error : null,
  };
}

export function OpdPatientPicker({
  orgSlug,
  initialQuery,
  onSelect,
  onClose,
}: {
  orgSlug: string;
  /** Seeds the search — e.g. the booking's caller phone at check-in. */
  initialQuery?: string;
  onSelect: (patient: SelectedPatient) => void;
  onClose: () => void;
}) {
  const { today } = useOrgDateTime();
  const [query, setQuery] = useState(initialQuery ?? "");
  const [registering, setRegistering] = useState(false);
  const trimmed = query.trim();
  const { isPhone, matches, searched, error } = usePatientMatches(orgSlug, query);

  if (registering) {
    return (
      <QuickRegisterStep
        orgSlug={orgSlug}
        initialQuery={trimmed}
        isPhone={isPhone}
        onRegistered={onSelect}
        onBack={() => setRegistering(false)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="opd-patient-search" className="font-medium">
          Phone or name
        </label>
        <Input
          id="opd-patient-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="98765 00011"
          autoFocus
          autoComplete="off"
        />
      </div>

      {error ? (
        <div role="alert" className="border-l-2 border-destructive pl-3">
          <p className="font-medium">Could not search patients</p>
          <p className="mt-0.5 text-muted-foreground">{error.message}</p>
        </div>
      ) : matches.length > 0 ? (
        <>
          <p className="text-muted-foreground">
            {matches.length} match{matches.length === 1 ? "" : "es"}
          </p>
          <ul className="flex max-h-64 flex-col overflow-y-auto ring-1 ring-border">
            {matches.map((match) => {
              const age = patientAgeYears(match.dateOfBirth, match.ageYears, today);
              return (
                <li key={match.id}>
                  <button
                    type="button"
                    onClick={() => onSelect({ id: match.id, name: match.name, mrn: match.mrn })}
                    className="flex w-full items-baseline gap-2 border-b border-border px-3 py-2 text-left last:border-b-0 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted/40"
                  >
                    <span className="font-medium">{match.name}</span>
                    <span className="text-muted-foreground">
                      {match.mrn} · {match.phone}
                    </span>
                    <span className="ml-auto shrink-0 capitalize text-muted-foreground">
                      {age === null ? "Age —" : `${age}y`} · {match.sex}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : searched ? (
        <p className="text-muted-foreground">No patient matches “{trimmed}”.</p>
      ) : null}

      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

      <Button type="button" variant="ghost" onClick={() => setRegistering(true)}>
        Register new patient
      </Button>
      <p className="text-muted-foreground">
        Need address, blood group or history?{" "}
        <Link
          to="/$orgSlug/patients"
          params={{ orgSlug }}
          search={{ create: true }}
          onClick={onClose}
          className="underline underline-offset-4"
        >
          Use the full registration form
        </Link>
        .
      </p>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </DialogFooter>
    </div>
  );
}

function QuickRegisterStep({
  orgSlug,
  initialQuery,
  isPhone,
  onRegistered,
  onBack,
}: {
  orgSlug: string;
  initialQuery: string;
  isPhone: boolean;
  onRegistered: (patient: SelectedPatient) => void;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useZodForm(quickPatientSchema, {
    // Whatever the desk already typed is carried over, so nothing is re-keyed.
    defaultValues: {
      name: isPhone ? "" : initialQuery,
      phone: isPhone ? initialQuery : "",
      sex: "unknown",
      ageYears: undefined,
    },
  });

  const register = useMutation(
    orpc.patient.register.mutationOptions({
      onSuccess: (created) => {
        void queryClient.invalidateQueries({
          queryKey: orpc.patient.search.key({ input: { orgSlug } }),
        });
        toast.success(`${created.mrn} registered`);
        onRegistered({ id: created.id, name: created.name, mrn: created.mrn });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const submit = form.handleSubmit((values) =>
    register.mutate({ orgSlug, ...values, dateOfBirth: null }),
  );

  return (
    <Form {...form}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input {...field} autoFocus disabled={register.isPending} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Phone</FormLabel>
              <FormControl>
                <Input {...field} inputMode="tel" disabled={register.isPending} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="sex"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Sex</FormLabel>
                <FormControl>
                  <NativeSelect {...field} disabled={register.isPending}>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                    <option value="unknown">Unknown</option>
                  </NativeSelect>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="ageYears"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Age (years)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    max={150}
                    value={field.value === undefined ? "" : String(field.value)}
                    onChange={(event) =>
                      field.onChange(
                        event.target.value === "" ? undefined : event.target.valueAsNumber,
                      )
                    }
                    onBlur={field.onBlur}
                    name={field.name}
                    ref={field.ref}
                    disabled={register.isPending}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" disabled={register.isPending} onClick={onBack}>
            Back to search
          </Button>
          <SubmitButton isSubmitting={register.isPending}>Register and continue</SubmitButton>
        </DialogFooter>
      </form>
    </Form>
  );
}

function OpdAppointmentStep({
  orgSlug,
  patient,
  onChangePatient,
  onClose,
}: {
  orgSlug: string;
  patient: SelectedPatient;
  onChangePatient?: () => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const departments = useQuery(orpc.staff.listDepartments.queryOptions({ input: { orgSlug } }));
  const practitioners = useQuery(orpc.staff.listPractitioners.queryOptions({ input: { orgSlug } }));
  const form = useZodForm(appointmentSchema, {
    defaultValues: { departmentId: "", practitionerId: "", kind: "consultation" },
  });

  const createOpdAppointment = useMutation(
    orpc.opd.createWalkIn.mutationOptions({
      onSuccess: ({ appointment }) => {
        void invalidateOpdAppointmentState(queryClient, orgSlug, appointment.id);
        toast.success(`Token ${appointment.tokenNumber} created`);
        onClose();
        void navigate({
          to: "/$orgSlug/opd/$appointmentId",
          params: { orgSlug, appointmentId: appointment.id },
        });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const submit = form.handleSubmit((values) =>
    createOpdAppointment.mutate({ orgSlug, patientId: patient.id, ...values }),
  );
  const loadingOptions = departments.isPending || practitioners.isPending;

  return (
    <Form {...form}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex items-baseline gap-2 bg-muted/40 px-3 py-2">
          <span className="font-medium">{patient.name}</span>
          <span className="text-muted-foreground">{patient.mrn}</span>
          {onChangePatient && (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="ml-auto"
              disabled={createOpdAppointment.isPending}
              onClick={onChangePatient}
            >
              Change
            </Button>
          )}
        </div>

        <OpdCareTeamFields orgSlug={orgSlug} disabled={createOpdAppointment.isPending} autoFocus />
        <FormField
          control={form.control}
          name="kind"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Kind</FormLabel>
              <FormControl>
                <NativeSelect {...field} disabled={createOpdAppointment.isPending}>
                  <option value="consultation">Consultation</option>
                  <option value="procedure">Procedure</option>
                </NativeSelect>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={createOpdAppointment.isPending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <SubmitButton isSubmitting={createOpdAppointment.isPending} disabled={loadingOptions}>
            Create token
          </SubmitButton>
        </DialogFooter>
      </form>
    </Form>
  );
}

/**
 * The cascading department → practitioner pair, shared by the walk-in and
 * booking dialogs so their behavior cannot drift. Reads the parent form
 * through context — both dialogs render inside `<Form>` — and owns its own
 * staff queries, which TanStack Query dedupes against the parent's.
 */
export function OpdCareTeamFields({
  orgSlug,
  disabled,
  autoFocus = false,
}: {
  orgSlug: string;
  /** True while the parent mutation is in flight. */
  disabled: boolean;
  autoFocus?: boolean;
}) {
  const form = useFormContext<{ departmentId: string; practitionerId: string }>();
  const departments = useQuery(orpc.staff.listDepartments.queryOptions({ input: { orgSlug } }));
  const practitioners = useQuery(orpc.staff.listPractitioners.queryOptions({ input: { orgSlug } }));
  const departmentId = form.watch("departmentId");
  const loadingOptions = departments.isPending || practitioners.isPending;

  if (departments.isError || practitioners.isError) {
    return (
      <div role="alert" className="col-span-full border-l-2 border-destructive pl-3">
        <p className="font-medium">Could not load staff options</p>
        <p className="mt-0.5 text-muted-foreground">
          {(departments.error ?? practitioners.error)?.message}
        </p>
      </div>
    );
  }

  return (
    <>
      <FormField
        control={form.control}
        name="departmentId"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Department</FormLabel>
            <FormControl>
              <NativeSelect
                value={field.value}
                onChange={(event) => {
                  field.onChange(event);
                  form.setValue("practitionerId", "");
                }}
                onBlur={field.onBlur}
                name={field.name}
                ref={field.ref}
                disabled={loadingOptions || disabled}
                autoFocus={autoFocus}
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
          <FormItem>
            <FormLabel>Practitioner</FormLabel>
            <FormControl>
              <NativeSelect {...field} disabled={!departmentId || loadingOptions || disabled}>
                <option value="">
                  {departmentId ? "Choose a practitioner" : "Choose a department first"}
                </option>
                {(practitioners.data ?? [])
                  .filter((practitioner) => practitioner.departmentId === departmentId)
                  .map((practitioner) => (
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
    </>
  );
}
