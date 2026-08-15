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
import { Textarea } from "@hms/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangleIcon } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { PageBody, PageHeader } from "@/components/page";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useZodForm } from "@/hooks/use-zod-form";
import { orpc } from "@/lib/orpc";
import { isConflictError } from "@/lib/orpc-error";

export const Route = createFileRoute("/org/$orgSlug/front-desk/register")({
  component: RegisterPatientRoute,
});

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

function RegisterPatientRoute() {
  const { orgSlug } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const form = useZodForm(patientFormSchema, {
    defaultValues: {
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
  const phone = form.watch("phone");
  const debouncedPhone = useDebouncedValue(phone.trim(), 300);
  const duplicates = useQuery({
    ...orpc.patient.search.queryOptions({
      input: { orgSlug, phone: debouncedPhone, limit: 100 },
    }),
    enabled: debouncedPhone.length >= 4,
  });

  const register = useMutation(
    orpc.patient.register.mutationOptions({
      onSuccess: (patient) => {
        void queryClient.invalidateQueries({
          queryKey: orpc.patient.search.key({ input: { orgSlug } }),
        });
        toast.success(`Patient registered as ${patient.mrn}`);
        void navigate({
          to: "/org/$orgSlug/front-desk/patients/$patientId",
          params: { orgSlug, patientId: patient.id },
        });
      },
      onError: (error) => {
        toast.error(
          isConflictError(error)
            ? "A patient with this name and phone (or the same UID) already exists."
            : error.message,
        );
      },
    }),
  );

  const onSubmit = form.handleSubmit((values) => register.mutate({ orgSlug, ...values }));
  const matches =
    phone.trim() === debouncedPhone && debouncedPhone.length >= 4
      ? (duplicates.data?.items ?? [])
      : [];

  return (
    <>
      <PageHeader
        title="Register patient"
        description="Create a patient record and assign the next MRN"
      />
      <PageBody className="max-w-2xl">
        <Form {...form}>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input {...field} autoComplete="name" />
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
                      <Input {...field} type="tel" autoComplete="tel" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {matches.length > 0 ? (
              <div
                role="status"
                className="border-l-2 border-amber-500 bg-amber-500/5 px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-1.5 font-medium">
                  <AlertTriangleIcon className="size-3.5 text-amber-600" />
                  {matches.length} existing patient(s) with this phone
                </div>
                <ul className="mt-1.5 space-y-1 pl-5">
                  {matches.map((patient) => (
                    <li key={patient.id}>
                      <Link
                        to="/org/$orgSlug/front-desk/patients/$patientId"
                        params={{ orgSlug, patientId: patient.id }}
                        className="underline underline-offset-4"
                      >
                        {patient.mrn} · {patient.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-3">
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
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        autoComplete="email"
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
                name="uid"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>National ID / UID</FormLabel>
                    <FormControl>
                      <Input
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
            </div>

            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={3} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="allergies"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Allergies</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={3}
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
                        rows={3}
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

            <div>
              <SubmitButton isSubmitting={register.isPending}>Register patient</SubmitButton>
            </div>
          </form>
        </Form>
      </PageBody>
    </>
  );
}
