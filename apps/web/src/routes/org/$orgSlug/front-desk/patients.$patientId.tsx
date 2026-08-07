import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@better-stack/ui/components/form";
import { Input } from "@better-stack/ui/components/input";
import { Skeleton } from "@better-stack/ui/components/skeleton";
import { SubmitButton } from "@better-stack/ui/components/submit-button";
import { Textarea } from "@better-stack/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";

import { PageHeader } from "@/components/app-shell";
import { useZodForm } from "@/hooks/use-zod-form";
import { orpc } from "@/lib/orpc";

export const Route = createFileRoute("/org/$orgSlug/front-desk/patients/$patientId")({
  loader: ({ context: { queryClient }, params: { orgSlug, patientId } }) => {
    void queryClient.prefetchQuery(
      orpc.patient.get.queryOptions({ input: { orgSlug, patientId } }),
    );
  },
  component: PatientDetailRoute,
});

const SELECT_CLASS =
  "h-8 w-full rounded-none border border-input bg-transparent px-2 text-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 dark:bg-input/30";

const patientFormSchema = z
  .object({
    name: z.string().trim().min(1, "Enter the patient's name").max(200),
    phone: z.string().trim().min(4, "Enter at least 4 characters").max(20),
    sex: z.enum(["male", "female", "other"]),
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")
      .nullable(),
    ageYears: z.number().int().min(0).max(150).nullable(),
    address: z.string().trim().max(500).default(""),
  })
  .refine((values) => values.dateOfBirth !== null || values.ageYears !== null, {
    message: "Enter a date of birth or age",
    path: ["dateOfBirth"],
  });

function PatientDetailRoute() {
  const { orgSlug, patientId } = Route.useParams();
  const patient = useQuery(orpc.patient.get.queryOptions({ input: { orgSlug, patientId } }));

  return (
    <>
      <PageHeader
        title={patient.data ? `${patient.data.mrn} · ${patient.data.name}` : "Patient"}
        description="Patient demographics"
      />
      <div className="max-w-2xl p-4">
        {patient.isPending ? (
          <div className="flex flex-col gap-3" aria-busy>
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : patient.isError ? (
          <div role="alert" className="border-l-2 border-destructive pl-3 text-xs">
            <p className="font-medium">Could not load patient</p>
            <p className="mt-0.5 text-muted-foreground">{patient.error.message}</p>
          </div>
        ) : (
          <PatientForm
            key={`${orgSlug}:${patientId}`}
            orgSlug={orgSlug}
            patientId={patientId}
            patient={patient.data}
          />
        )}
      </div>
    </>
  );
}

function PatientForm({
  orgSlug,
  patientId,
  patient,
}: {
  orgSlug: string;
  patientId: string;
  patient: {
    name: string;
    phone: string;
    sex: "male" | "female" | "other";
    dateOfBirth: string | null;
    ageYears: number | null;
    address: string;
  };
}) {
  const queryClient = useQueryClient();
  const form = useZodForm(patientFormSchema, {
    defaultValues: {
      name: patient.name,
      phone: patient.phone,
      sex: patient.sex,
      dateOfBirth: patient.dateOfBirth,
      ageYears: patient.ageYears,
      address: patient.address,
    },
  });

  const update = useMutation(
    orpc.patient.update.mutationOptions({
      onSuccess: (saved) => {
        void Promise.all([
          queryClient.invalidateQueries({
            queryKey: orpc.patient.get.key({ input: { orgSlug, patientId } }),
          }),
          queryClient.invalidateQueries({
            queryKey: orpc.patient.search.key({ input: { orgSlug } }),
          }),
        ]);
        form.reset({
          name: saved.name,
          phone: saved.phone,
          sex: saved.sex,
          dateOfBirth: saved.dateOfBirth,
          ageYears: saved.ageYears,
          address: saved.address,
        });
        toast.success("Patient updated");
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const onSubmit = form.handleSubmit((values) => update.mutate({ orgSlug, patientId, ...values }));

  return (
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

        <div className="grid gap-3 sm:grid-cols-3">
          <FormField
            control={form.control}
            name="sex"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Sex</FormLabel>
                <FormControl>
                  <select className={SELECT_CLASS} {...field}>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
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
                      field.onChange(event.target.value === "" ? null : Number(event.target.value))
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

        <div>
          <SubmitButton isSubmitting={update.isPending} disabled={!form.formState.isDirty}>
            Save changes
          </SubmitButton>
        </div>
      </form>
    </Form>
  );
}
