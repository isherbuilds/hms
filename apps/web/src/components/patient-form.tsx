import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@hms/ui/components/form";
import { Button } from "@hms/ui/components/button";
import { Input } from "@hms/ui/components/input";
import { NativeSelect } from "@hms/ui/components/native-select";
import { SubmitButton } from "@hms/ui/components/submit-button";
import { Textarea } from "@hms/ui/components/textarea";
import { cn } from "@hms/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangleIcon, MailIcon, PhoneIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useZodForm } from "@/hooks/use-zod-form";
import { orpc } from "@/lib/orpc";
import { isConflictError } from "@/lib/orpc-error";

/**
 * A patient record, as one plain column of labels and fields — the same form
 * whether the record is being created or corrected.
 *
 * Presentation-free on purpose: the sheet owns opening and closing, this owns
 * the record. Create and edit shared eleven fields, a schema and every nullable
 * quirk between two files before this; there is no version of that which stays
 * in step.
 */

/** What editing needs from an existing record. `patient.get` returns a superset. */
export type EditablePatient = z.input<typeof patientFormSchema> & { id: string };

const patientFormSchema = z
  .object({
    name: z.string().trim().min(1, "Enter the patient's name").max(200),
    phone: z.string().trim().min(4, "Enter at least 4 characters").max(20),
    sex: z.enum(["male", "female", "other", "unknown"]),
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")
      .nullable(),
    ageYears: z.number().int().min(0).max(150).nullable(),
    address: z.string().trim().max(500).default(""),
    email: z.email("Enter a valid email address").nullable(),
    bloodGroup: z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]).nullable(),
    allergies: z.string().nullable(),
    medicalHistory: z.string().nullable(),
    uid: z.string().trim().min(1).max(100).nullable(),
  })
  .refine((values) => values.dateOfBirth !== null || values.ageYears !== null, {
    message: "Enter a date of birth or age",
    path: ["dateOfBirth"],
  });

/** `SheetContent` opens over 200ms; nothing measures until it has landed. */
const SHEET_ENTER_MS = 200;

/** Puts a glyph inside a control. Inputs only — a textarea has no vertical
 * centre to hang one on. */
function WithIcon({ icon: Icon, children }: { icon: typeof PhoneIcon; children: ReactNode }) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      {children}
    </div>
  );
}

export function PatientForm({
  orgSlug,
  patient,
  onCancel,
  onSaved,
  onDirtyChange,
  onPendingChange,
}: {
  orgSlug: string;
  /** Omit to register a new patient; pass a record to correct an existing one. */
  patient?: EditablePatient;
  onCancel: () => void;
  onSaved: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const isEdit = patient !== undefined;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const bodyRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);

  // The rule above the actions is not "has scrolled" but "there is more to
  // read": it has to be there while the form is taller than the panel, and gone
  // once the last field is in view.
  const measure = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    setMoreBelow(body.scrollHeight - body.scrollTop - body.clientHeight > 1);
  }, []);

  /**
   * Deliberately nothing measures until the sheet has finished sliding in.
   * Mounting twelve fields already costs the first frame of the entrance; a
   * synchronous measure and a second render on top of it is what made the panel
   * stutter as it arrived. Watching the content wrapper (not the scroll box)
   * catches the height changes that matter — an error message, the duplicate
   * notice — without a subtree MutationObserver firing through the whole mount.
   */
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    let observer: ResizeObserver | undefined;
    const start = setTimeout(() => {
      measure();
      observer = new ResizeObserver(measure);
      observer.observe(content);
    }, SHEET_ENTER_MS);
    return () => {
      clearTimeout(start);
      observer?.disconnect();
    };
  }, [measure]);

  const form = useZodForm(patientFormSchema, {
    defaultValues: patient ?? {
      name: "",
      phone: "",
      sex: "other",
      dateOfBirth: null,
      ageYears: null,
      address: "",
      email: null,
      bloodGroup: null,
      allergies: null,
      medicalHistory: null,
      uid: null,
    },
  });

  useEffect(() => {
    onDirtyChange?.(form.formState.isDirty);
  }, [form.formState.isDirty, onDirtyChange]);

  const phone = form.watch("phone");
  const debouncedPhone = useDebouncedValue(phone.trim(), 300);
  const duplicates = useQuery({
    ...orpc.patient.search.queryOptions({
      input: { orgSlug, phone: debouncedPhone, limit: 100 },
    }),
    enabled: debouncedPhone.length >= 4,
  });

  const onConflict = (error: Error) =>
    toast.error(isConflictError(error) ? "A patient with this UID already exists." : error.message);

  const register = useMutation(
    orpc.patient.register.mutationOptions({
      onSuccess: async (created) => {
        await queryClient.invalidateQueries({
          queryKey: orpc.patient.search.key({ input: { orgSlug } }),
        });
        toast.success(`Patient registered as ${created.mrn}`);
        await navigate({
          to: "/$orgSlug/patients/$patientId",
          params: { orgSlug, patientId: created.id },
          ignoreBlocker: true,
        });
      },
      onError: onConflict,
    }),
  );

  const update = useMutation(
    orpc.patient.update.mutationOptions({
      onSuccess: async (saved) => {
        // Held so the button stays pending until both the record and the search
        // list are fresh — otherwise the sheet closes over stale rows.
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: orpc.patient.get.key({ input: { orgSlug, patientId: patient!.id } }),
          }),
          queryClient.invalidateQueries({
            queryKey: orpc.patient.search.key({ input: { orgSlug } }),
          }),
        ]);
        toast.success(`${saved.name} updated`);
        onSaved();
      },
      onError: onConflict,
    }),
  );

  const pending = isEdit ? update.isPending : register.isPending;
  useEffect(() => {
    onPendingChange?.(pending);
  }, [onPendingChange, pending]);
  const onSubmit = form.handleSubmit((values) =>
    isEdit
      ? update.mutate({ orgSlug, patientId: patient.id, ...values })
      : register.mutate({ orgSlug, ...values }),
  );
  const matches =
    phone.trim() === debouncedPhone && debouncedPhone.length >= 4
      ? // A patient being edited always matches its own number; warning about
        // itself would be noise.
        (duplicates.data?.items ?? []).filter((match) => match.id !== patient?.id)
      : [];
  const problems = Object.keys(form.formState.errors).length;

  return (
    <Form {...form}>
      {/* `noValidate`: Zod owns every message, so the browser must not pre-empt
          it with a native bubble that says something different. Without it a
          half-typed email blocks submit silently and the form looks dead. */}
      <form noValidate onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
        <fieldset disabled={pending} className="contents">
          <div ref={bodyRef} onScroll={measure} className="min-h-0 flex-1 overflow-y-auto p-4">
            <div ref={contentRef} className="flex flex-col gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full name</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        autoComplete="name"
                        placeholder="Enter the patient's name"
                      />
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

              {matches.length > 0 ? (
                <div
                  role="status"
                  className="animate-in rounded-sm border border-border bg-muted p-3 text-xs duration-150 fade-in-0 ease-out"
                >
                  <p className="flex items-center gap-1.5 font-medium text-foreground">
                    <AlertTriangleIcon className="size-4 shrink-0" />
                    {matches.length} existing patient(s) with this phone
                  </p>
                  <ul className="flex flex-col gap-0.5 pt-1.5">
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
              ) : null}

              <FormField
                control={form.control}
                name="sex"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sex</FormLabel>
                    <FormControl>
                      <NativeSelect {...field}>
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
                name="dateOfBirth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date of birth</FormLabel>
                    <FormControl>
                      <Input
                        type="date"

                        value={field.value ?? ""}
                        onChange={(event) => field.onChange(event.target.value || null)}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      />
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
                    <FormLabel>Age in years</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        max={150}
                        placeholder="Only if the date of birth is unknown"

                        value={field.value ?? ""}
                        onChange={(event) =>
                          field.onChange(
                            event.target.value === "" ? null : Number(event.target.value),
                          )
                        }
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <WithIcon icon={MailIcon}>
                        <Input
                          type="email"
                          autoComplete="email"
                          placeholder="Enter email address"
                          className="pl-8"
                          value={field.value ?? ""}
                          onChange={(event) => field.onChange(event.target.value || null)}
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                        />
                      </WithIcon>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="uid"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>National ID / UID</FormLabel>
                    <FormControl>
                      <Input
                        className="font-mono"
                        value={field.value ?? ""}
                        onChange={(event) => field.onChange(event.target.value || null)}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="bloodGroup"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Blood group</FormLabel>
                    <FormControl>
                      <NativeSelect
                        value={field.value ?? ""}
                        onChange={(event) => field.onChange(event.target.value || null)}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      >
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

              <FormField
                control={form.control}
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

              <FormField
                control={form.control}
                name="allergies"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Allergies</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={2}
                        placeholder="What reaction, and when"

                        value={field.value ?? ""}
                        onChange={(event) => field.onChange(event.target.value || null)}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="medicalHistory"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Medical history</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={2}
                        placeholder="Ongoing conditions, past surgeries"

                        value={field.value ?? ""}
                        onChange={(event) => field.onChange(event.target.value || null)}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          {/* No rule above the actions while the whole form fits, as in the
            reference. When it does not, one appears — without it the fields
            slide under the buttons and the panel looks broken. */}
          <footer
            className={cn(
              "flex shrink-0 items-center gap-2 border-t border-transparent bg-popover p-4 text-xs transition-colors",
              moreBelow && "border-border",
            )}
          >
            {problems > 0 ? (
              <span className="min-w-0 truncate text-destructive">
                {problems} {problems === 1 ? "field needs" : "fields need"} fixing
              </span>
            ) : null}
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <Button type="button" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
              <SubmitButton isSubmitting={pending} disabled={isEdit && !form.formState.isDirty}>
                {isEdit ? "Save changes" : "Save"}
              </SubmitButton>
            </div>
          </footer>
        </fieldset>
      </form>
    </Form>
  );
}
