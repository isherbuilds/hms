import {
  Form,
  FormControl,
  FormDescription,
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
} from "@hms/ui/components/form";
import { emergencyContactRelation, guardianRelation } from "@hms/api/lib/schemas";
import type { AppRouter } from "@hms/api/routers/index";
import { Button } from "@hms/ui/components/button";
import { Input } from "@hms/ui/components/input";
import { NativeSelect } from "@hms/ui/components/native-select";
import { SheetFooter } from "@hms/ui/components/sheet";
import { SubmitButton } from "@hms/ui/components/submit-button";
import { Textarea } from "@hms/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { RouterClient } from "@orpc/server";
import { AlertTriangleIcon, ChevronDownIcon, MailIcon, PhoneIcon } from "lucide-react";
import { useRef, useState, type FormEventHandler, type ReactNode, type Ref } from "react";
import { useFormContext, useFormState, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useZodForm } from "@/hooks/use-zod-form";
import { invalidatePatientState } from "@/lib/domain-invalidation";
import { optionalNumberText, optionalText, patientFieldSchema } from "@/lib/form-schema";
import { useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { applyOrpcFieldError, errorMessage } from "@/lib/orpc-error";
import { ageYearsToEstimatedDateOfBirth, patientAgeYears } from "@/lib/patient-age";

const patientFormSchema = patientFieldSchema
  .omit({ dobEstimated: true })
  .extend({
    dateOfBirth: optionalText(patientFieldSchema.shape.dateOfBirth),
    age: optionalNumberText(z.number().int().min(0).max(150)),
    sponsorPayerId: z.string(),
    sponsorPolicyNumber: z.string().trim().max(100),
    sponsorEmployeeNumber: z.string().trim().max(100),
  })
  .refine((values) => values.dateOfBirth !== null || values.age !== null, {
    message: "Enter a date of birth or age",
    path: ["dateOfBirth"],
  });

type PatientFormValues = z.input<typeof patientFormSchema>;

const UID_CONFLICT = {
  uid_taken: { field: "uid", message: "A patient with this UID already exists." },
} as const;

/** The record the form edits: `patient.get`'s row, whose `updatedAt` is the compare-and-swap token. */
export type EditablePatient = Awaited<ReturnType<RouterClient<AppRouter>["patient"]["get"]>>;

function guardianEmergencyRelation(relation: string | null) {
  if (relation === "S/o" || relation === "D/o") return "parent";
  if (relation === "W/o" || relation === "H/o") return "spouse";
  return "";
}

/** Controls are uncontrolled, so every default is the string the DOM holds. */
function defaultValues(
  patient: EditablePatient | undefined,
  seed: { name?: string; phone?: string } | undefined,
  today: string,
): PatientFormValues {
  if (!patient) {
    return {
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
      guardian: { relation: "", name: "", phone: "" },
      emergencyContact: { name: "", phone: "", relation: "" },
      sponsorPayerId: "",
      sponsorPolicyNumber: "",
      sponsorEmployeeNumber: "",
    };
  }

  return {
    name: patient.name,
    phone: patient.phone,
    sex: patient.sex,
    // An estimated birth date was computed from an age, so it is offered back as the
    // age. Editing it as a date would turn a guess into a fact.
    dateOfBirth: patient.dobEstimated ? "" : patient.dateOfBirth,
    age: patient.dobEstimated ? String(patientAgeYears(patient.dateOfBirth, today)) : "",
    address: patient.address,
    email: patient.email ?? "",
    bloodGroup: patient.bloodGroup ?? "",
    allergies: patient.allergies ?? "",
    medicalHistory: patient.medicalHistory ?? "",
    uid: patient.uid ?? "",
    guardian: {
      relation: patient.guardianRelation ?? "",
      name: patient.guardianName ?? "",
      phone: patient.guardianPhone ?? "",
    },
    emergencyContact: {
      name: patient.emergencyContactName ?? "",
      phone: patient.emergencyContactPhone ?? "",
      relation: patient.emergencyContactRelation ?? "",
    },
    sponsorPayerId: patient.sponsor?.payerId ?? "",
    sponsorPolicyNumber: patient.sponsor?.policyNumber ?? "",
    sponsorEmployeeNumber: patient.sponsor?.employeeNumber ?? "",
  };
}

/** Inputs only — a textarea has no vertical centre to hang a glyph on. */
function WithIcon({ icon: Icon, children }: { icon: typeof PhoneIcon; children: ReactNode }) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      {children}
    </div>
  );
}

function PatientPhoneDuplicateWarning({
  orgSlug,
  selfId,
}: {
  orgSlug: string;
  /** The record being edited: its own number is not a duplicate of itself. */
  selfId: string | undefined;
}) {
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
      ? (duplicates.data?.items ?? []).filter((patient) => patient.id !== selfId)
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
            <span className="capitalize">{patient.name}</span>
          </li>
        ))}
      </ul>
    </div>
  ) : null;
}

/** Its own component so the error count does not re-render the whole form. */
function PatientFormProblems() {
  "use no memo"; // RHF server errors can change without a new `errors` object.
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
  ref,
  pending,
  onCancel,
  onSubmit,
  children,
}: {
  ref: Ref<HTMLFormElement>;
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
      ref={ref}
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

function PatientFormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group border-t border-border">
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 text-xs marker:content-none">
        {title}
        <ChevronDownIcon className="size-3.5 text-muted-foreground group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-3 pb-3">{children}</div>
    </details>
  );
}

function SponsorFields({
  orgSlug,
  current,
}: {
  orgSlug: string;
  /** The sponsor already on the record, kept selectable even once deactivated. */
  current: string | undefined;
}) {
  const { control } = useFormContext<PatientFormValues>();
  const payerId = useWatch({ control, name: "sponsorPayerId", exact: true });
  const payers = useQuery(orpc.payer.list.queryOptions({ input: { orgSlug } }));
  const list = payers.data ?? [];
  // A deactivated payer takes no new links, so it is offered only to the record that
  // already holds it — otherwise its name silently disappears and the save drops it.
  const options = list.filter((payer) => payer.active || payer.id === current);
  const inactive =
    !payers.isPending &&
    payerId !== "" &&
    !list.some((payer) => payer.id === payerId && payer.active);

  return (
    <div className="flex flex-col gap-3">
      <RegisteredFormField
        name="sponsorPayerId"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Covered by</FormLabel>
            <FormControl>
              <NativeSelect {...field}>
                <option value="">Self-paying</option>
                {options.map((payer) => (
                  <option key={payer.id} value={payer.id}>
                    {payer.name}
                    {payer.active ? "" : " (inactive)"}
                  </option>
                ))}
              </NativeSelect>
            </FormControl>
            <FormDescription>
              {payers.isPending ? (
                "Loading payers…"
              ) : options.length === 0 ? (
                <>
                  No payers are set up yet.{" "}
                  <Link
                    to="/$orgSlug/settings/payers"
                    params={{ orgSlug }}
                    className="underline underline-offset-4"
                  >
                    Add one in settings
                  </Link>
                  .
                </>
              ) : (
                "The bill is still addressed to the patient; an uncovered balance stays outstanding."
              )}
            </FormDescription>
            {inactive ? (
              <p className="text-xs text-destructive">
                This payer is no longer active. Choose another before saving.
              </p>
            ) : null}
            <FormMessage />
          </FormItem>
        )}
      />
      {payerId ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <RegisteredFormField
            name="sponsorPolicyNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Policy number</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <RegisteredFormField
            name="sponsorEmployeeNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Employee number</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      ) : null}
    </div>
  );
}

function EmergencyContactFields() {
  const { control, setValue } = useFormContext<PatientFormValues>();
  const guardian = useWatch({ control, name: "guardian" });
  return (
    <fieldset className="flex flex-col gap-3 border-t border-border pt-4">
      <legend className="pr-2 text-sm font-medium">Emergency contact</legend>
      {/* Fills the fields rather than mirroring them at save time, so the desk sees
          and can correct what will be stored. */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        disabled={!guardian?.name || !guardian?.phone}
        onClick={() => {
          setValue(
            "emergencyContact",
            {
              name: guardian.name,
              phone: guardian.phone,
              relation: guardianEmergencyRelation(guardian.relation),
            },
            { shouldDirty: true, shouldValidate: true },
          );
        }}
      >
        Copy from relation
      </Button>
      <div className="flex flex-col gap-3">
        <RegisteredFormField
          name="emergencyContact.name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input {...field} placeholder="Who to call" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-[1fr_8rem] gap-2">
          <RegisteredFormField
            name="emergencyContact.phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Phone</FormLabel>
                <FormControl>
                  <WithIcon icon={PhoneIcon}>
                    <Input
                      {...field}
                      type="tel"
                      inputMode="numeric"
                      placeholder="Mobile number"
                      className="pl-8"
                    />
                  </WithIcon>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <RegisteredFormField
            name="emergencyContact.relation"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Relation</FormLabel>
                <FormControl>
                  <NativeSelect {...field} className="capitalize">
                    <option value="">Not recorded</option>
                    {emergencyContactRelation.options.map((relation) => (
                      <option key={relation} value={relation}>
                        {relation}
                      </option>
                    ))}
                  </NativeSelect>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </div>
    </fieldset>
  );
}

export function PatientForm({
  orgSlug,
  patient,
  seed,
  onCancel,
  onSaved,
  onRegistered,
}: {
  orgSlug: string;
  /** Set to edit an existing record; absent registers a new one. */
  patient?: EditablePatient;
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
  // Frozen at mount. The page behind this sheet refetches on focus, so a live prop
  // would hand the save a compare-and-swap token newer than the values on screen and
  // quietly overwrite whoever changed the record meanwhile.
  const [record] = useState(patient);
  const formRef = useRef<HTMLFormElement>(null);
  const form = useZodForm(patientFormSchema, {
    defaultValues: defaultValues(record, seed, today),
  });

  // Both client validation and server field errors must reveal their section.
  function revealFields(names: string[]) {
    for (const name of names) {
      const section = formRef.current
        ?.querySelector(`[name="${name}"], [name^="${name}."]`)
        ?.closest("details");
      if (section) section.open = true;
    }
  }

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
        const mapped = applyOrpcFieldError(form, error, UID_CONFLICT);
        if (mapped) revealFields([UID_CONFLICT.uid_taken.field]);
        toast.error(mapped ?? errorMessage(error, "Could not register the patient"));
      },
    }),
  );

  const update = useMutation(
    orpc.patient.update.mutationOptions({
      onSuccess: async (saved) => {
        await invalidatePatientState(queryClient, orgSlug, saved.id);
        toast.success("Changes saved");
        onSaved();
      },
      onError: (error) => {
        // A stale token means the record moved under the open sheet, so this save would
        // overwrite whoever got there first. Closing and reopening is the only honest
        // recovery: it is what rebuilds the form from the record as it now stands.
        const mapped = applyOrpcFieldError(form, error, UID_CONFLICT);
        if (mapped) revealFields([UID_CONFLICT.uid_taken.field]);
        toast.error(mapped ?? errorMessage(error, "Could not save the changes"));
      },
    }),
  );

  const pending = register.isPending || update.isPending;

  const onSubmit = form.handleSubmit(
    ({ age, sponsorPayerId, sponsorPolicyNumber, sponsorEmployeeNumber, ...fields }) => {
      const dateOfBirth =
        fields.dateOfBirth ?? (age === null ? null : ageYearsToEstimatedDateOfBirth(age, today));
      if (dateOfBirth === null) {
        form.setError("dateOfBirth", { message: "Enter a date of birth or age" });
        return;
      }
      // The procedure takes the whole record, not a patch, so both paths send the
      // same body — the update adds only the id and the token it must match.
      const values = {
        orgSlug,
        ...fields,
        dateOfBirth,
        dobEstimated: age !== null,
        sponsor: sponsorPayerId
          ? {
              payerId: sponsorPayerId,
              policyNumber: sponsorPolicyNumber || undefined,
              employeeNumber: sponsorEmployeeNumber || undefined,
            }
          : null,
      };

      if (record) {
        update.mutate({ ...values, patientId: record.id, updatedAt: record.updatedAt });
        return;
      }
      register.mutate(values);
    },
    (errors) => revealFields(Object.keys(errors)),
  );
  return (
    <Form {...form}>
      {/* `noValidate`: Zod owns every message, so the browser must not pre-empt
          it with a native bubble that says something different. Without it a
          half-typed email blocks submit silently and the form looks dead. */}
      {/* The dirty flag the sheet needs to guard a close, published on the element
          instead of lifted into its state — see `PatientSheet`. */}
      <PatientFormFrame ref={formRef} pending={pending} onCancel={onCancel} onSubmit={onSubmit}>
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

          <PatientPhoneDuplicateWarning orgSlug={orgSlug} selfId={record?.id} />

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

          <PatientFormSection title="Contacts">
            {/* One row: the relation reads as a prefix of the name, "W/o Gurmeet Singh". */}
            <div className="grid grid-cols-[6rem_1fr] gap-2">
              <RegisteredFormField
                name="guardian.relation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Relation</FormLabel>
                    <FormControl>
                      <NativeSelect {...field}>
                        <option value="">None</option>
                        {guardianRelation.options.map((relation) => (
                          <option key={relation} value={relation}>
                            {relation}
                          </option>
                        ))}
                      </NativeSelect>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <RegisteredFormField
                name="guardian.name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Guardian</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Father, husband, or guardian" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <RegisteredFormField
              name="guardian.phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Relation mobile number (optional)</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="tel"
                      autoComplete="section-guardian tel"
                      placeholder="Mobile number"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <EmergencyContactFields />
          </PatientFormSection>
          <PatientFormSection title="Personal details">
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
          </PatientFormSection>
          <PatientFormSection title="Sponsor">
            <SponsorFields orgSlug={orgSlug} current={record?.sponsor?.payerId} />
          </PatientFormSection>
          <PatientFormSection title="Medical details">
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
                    <Textarea
                      {...field}
                      rows={2}
                      placeholder="Ongoing conditions, past surgeries"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </PatientFormSection>
        </div>
      </PatientFormFrame>
    </Form>
  );
}
