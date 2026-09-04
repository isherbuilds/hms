import {
  Form,
  FormControl,
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
} from "@hms/ui/components/form";
import { Button } from "@hms/ui/components/button";
import { Input } from "@hms/ui/components/input";
import { NativeSelect } from "@hms/ui/components/native-select";
import { SheetFooter } from "@hms/ui/components/sheet";
import { SubmitButton } from "@hms/ui/components/submit-button";
import { Textarea } from "@hms/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangleIcon, MailIcon, PhoneIcon } from "lucide-react";
import { type FormEventHandler, type ReactNode } from "react";
import { useFormContext, useFormState, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useZodForm } from "@/hooks/use-zod-form";
import { optionalNumberText, optionalText, patientFieldSchema } from "@/lib/form-schema";
import { useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { applyOrpcFieldError, errorMessage } from "@/lib/orpc-error";
import { ageYearsToEstimatedDateOfBirth } from "@/lib/patient-age";

const patientFormSchema = patientFieldSchema
  .omit({ dobEstimated: true })
  .extend({
    dateOfBirth: optionalText(patientFieldSchema.shape.dateOfBirth),
    age: optionalNumberText(z.number().int().min(0).max(150)),
  })
  .refine((values) => values.dateOfBirth !== null || values.age !== null, {
    message: "Enter a date of birth or age",
    path: ["dateOfBirth"],
  });

type PatientFormValues = z.input<typeof patientFormSchema>;

/** Inputs only — a textarea has no vertical centre to hang a glyph on. */
function WithIcon({ icon: Icon, children }: { icon: typeof PhoneIcon; children: ReactNode }) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      {children}
    </div>
  );
}

function PatientPhoneDuplicateWarning({ orgSlug }: { orgSlug: string }) {
  const { control } = useFormContext<PatientFormValues>();
  const phone = useWatch({ control, name: "phone", exact: true });
  const debouncedPhone = useDebouncedValue(phone.trim(), 300);
  const duplicates = useQuery({
    ...orpc.patient.search.queryOptions({
      input: { orgSlug, phone: debouncedPhone, limit: 100 },
    }),
    enabled: debouncedPhone.length >= 4,
  });
  const matches =
    phone.trim() === debouncedPhone && debouncedPhone.length >= 4
      ? (duplicates.data?.items ?? [])
      : [];

  return matches.length > 0 ? (
    <div
      role="status"
      className="animate-in rounded-lg border border-border bg-muted p-3 text-xs duration-150 fade-in-0 ease-out"
    >
      <p className="flex items-center gap-2 font-medium text-foreground">
        <AlertTriangleIcon className="size-4 shrink-0" />
        {matches.length} existing patient(s) with this phone
      </p>
      <ul className="flex flex-col gap-1 pt-2">
        {matches.map((patient) => (
          <li key={patient.id} className="text-muted-foreground">
            <Link
              to="/$orgSlug/patients/$patientId"
              params={{ orgSlug, patientId: patient.id }}
              className="font-mono underline underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground"
            >
              {patient.mrn}
            </Link>{" "}
            {patient.name}
          </li>
        ))}
      </ul>
    </div>
  ) : null;
}

/** Its own component so the error count does not re-render the whole form. */
function PatientFormProblems() {
  const { control } = useFormContext<PatientFormValues>();
  const { errors } = useFormState({ control });
  const problems = Object.keys(errors).length;

  return problems > 0 ? (
    <span className="min-w-0 truncate text-destructive">
      {problems} {problems === 1 ? "field needs" : "fields need"} fixing
    </span>
  ) : null;
}

function PatientFormFrame({
  pending,
  onCancel,
  onSubmit,
  children,
}: {
  pending: boolean;
  onCancel: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  children: ReactNode;
}) {
  const { control } = useFormContext<PatientFormValues>();
  // Only `isDirty`: it flips once, so per-field errors stay inside the leaves.
  const { isDirty } = useFormState({ control });

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      data-dirty={isDirty}
      className="flex min-h-0 flex-1 flex-col"
    >
      <fieldset disabled={pending} className="contents">
        {/* `scroll-rule` draws the hairline above the actions in CSS: there
            while the form is taller than the panel, gone once the last field
            is in view. */}
        <div className="scroll-rule min-h-0 flex-1 overflow-y-auto p-4">{children}</div>

        <SheetFooter>
          <PatientFormProblems />
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <SubmitButton isSubmitting={pending}>Save</SubmitButton>
          </div>
        </SheetFooter>
      </fieldset>
    </form>
  );
}

export function PatientForm({
  orgSlug,
  seed,
  onCancel,
  onSaved,
  onRegistered,
}: {
  orgSlug: string;
  /** What the operator already typed elsewhere, so it is never keyed twice. */
  seed?: { name?: string; phone?: string };
  onCancel: () => void;
  onSaved: () => void;
  /** Set when the caller needs the record back rather than a trip to its page. */
  onRegistered?: (patient: { id: string; name: string; mrn: string }) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { today } = useOrgDateTime();
  const form = useZodForm(patientFormSchema, {
    // Controls are uncontrolled, so every default is the string the DOM holds.
    defaultValues: {
      name: seed?.name ?? "",
      phone: seed?.phone ?? "",
      sex: "",
      dateOfBirth: "",
      age: "",
      address: "",
      email: "",
      bloodGroup: "",
      allergies: "",
      medicalHistory: "",
      uid: "",
    },
  });

  const register = useMutation(
    orpc.patient.register.mutationOptions({
      onSuccess: async (created) => {
        await queryClient.invalidateQueries({
          queryKey: orpc.patient.search.key({ input: { orgSlug } }),
        });
        toast.success(`Patient registered as ${created.mrn}`);
        // Registering inside another task hands the record straight back.
        if (onRegistered) {
          onRegistered(created);
          onSaved();
          return;
        }
        await navigate({
          to: "/$orgSlug/patients/$patientId",
          params: { orgSlug, patientId: created.id },
          ignoreBlocker: true,
        });
      },
      onError: (error) => {
        const mapped = applyOrpcFieldError(form, error, {
          uid_taken: { field: "uid", message: "A patient with this UID already exists." },
        });
        toast.error(mapped ?? errorMessage(error, "Could not register the patient"));
      },
    }),
  );

  const onSubmit = form.handleSubmit(({ age, ...fields }) => {
    const dateOfBirth =
      fields.dateOfBirth ?? (age === null ? null : ageYearsToEstimatedDateOfBirth(age, today));
    if (dateOfBirth === null) {
      form.setError("dateOfBirth", { message: "Enter a date of birth or age" });
      return;
    }
    register.mutate({ orgSlug, ...fields, dateOfBirth, dobEstimated: age !== null });
  });
  return (
    <Form {...form}>
      {/* `noValidate`: Zod owns every message, so the browser must not pre-empt
          it with a native bubble that says something different. Without it a
          half-typed email blocks submit silently and the form looks dead. */}
      {/* The dirty flag the sheet needs to guard a close, published on the element
          instead of lifted into its state — see `PatientSheet`. */}
      <PatientFormFrame pending={register.isPending} onCancel={onCancel} onSubmit={onSubmit}>
        <div className="flex flex-col gap-4">
          <RegisteredFormField
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Full name</FormLabel>
                <FormControl>
                  <Input {...field} autoComplete="name" placeholder="Enter the patient's name" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <RegisteredFormField
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Phone</FormLabel>
                <FormControl>
                  <WithIcon icon={PhoneIcon}>
                    <Input
                      {...field}
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel"
                      placeholder="Mobile number"
                      className="pl-8"
                    />
                  </WithIcon>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <PatientPhoneDuplicateWarning orgSlug={orgSlug} />

          <RegisteredFormField
            name="sex"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Sex <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <NativeSelect {...field}>
                    <option value="">Choose sex</option>
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

          <RegisteredFormField
            name="dateOfBirth"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Date of birth</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="date"
                    onChange={(event) => {
                      field.onChange(event);
                      if (event.target.value !== "") form.setValue("age", "");
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <RegisteredFormField
            name="age"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Age in years, if birth date is unknown</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="number"
                    min={0}
                    max={150}
                    placeholder="Enter an estimated age"
                    onChange={(event) => {
                      field.onChange(event);
                      if (event.target.value !== "") form.setValue("dateOfBirth", "");
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <RegisteredFormField
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <WithIcon icon={MailIcon}>
                    <Input
                      {...field}
                      type="email"
                      autoComplete="email"
                      placeholder="Enter email address"
                      className="pl-8"
                    />
                  </WithIcon>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <RegisteredFormField
            name="uid"
            render={({ field }) => (
              <FormItem>
                <FormLabel>National ID / UID</FormLabel>
                <FormControl>
                  <Input {...field} className="font-mono" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <RegisteredFormField
            name="bloodGroup"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Blood group</FormLabel>
                <FormControl>
                  <NativeSelect {...field}>
                    <option value="">Not recorded</option>
                    <option value="A+">A+</option>
                    <option value="A-">A-</option>
                    <option value="B+">B+</option>
                    <option value="B-">B-</option>
                    <option value="AB+">AB+</option>
                    <option value="AB-">AB-</option>
                    <option value="O+">O+</option>
                    <option value="O-">O-</option>
                  </NativeSelect>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <RegisteredFormField
            name="address"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Address</FormLabel>
                <FormControl>
                  <Textarea {...field} rows={2} placeholder="Enter address" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <RegisteredFormField
            name="allergies"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Allergies</FormLabel>
                <FormControl>
                  <Textarea {...field} rows={2} placeholder="What reaction, and when" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <RegisteredFormField
            name="medicalHistory"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Medical history</FormLabel>
                <FormControl>
                  <Textarea {...field} rows={2} placeholder="Ongoing conditions, past surgeries" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </PatientFormFrame>
    </Form>
  );
}
