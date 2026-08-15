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
import { Skeleton } from "@hms/ui/components/skeleton";
import { SubmitButton } from "@hms/ui/components/submit-button";
import { Textarea } from "@hms/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { ErrorNote, PageBody, PageHeader } from "@/components/page";
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

const visitFormSchema = z.object({
  departmentId: z.string().min(1, "Choose a department"),
  practitionerId: z.string().min(1, "Choose a practitioner"),
});

function PatientDetailRoute() {
  const { orgSlug, patientId } = Route.useParams();
  const [visitDialogOpen, setVisitDialogOpen] = useState(false);
  const patient = useQuery(orpc.patient.get.queryOptions({ input: { orgSlug, patientId } }));

  return (
    <>
      <PageHeader
        title={patient.data ? `${patient.data.mrn} · ${patient.data.name}` : "Patient"}
        description="Patient demographics"
        action={
          patient.data ? (
            <Button onClick={() => setVisitDialogOpen(true)}>
              <PlusIcon data-icon="inline-start" />
              New visit
            </Button>
          ) : undefined
        }
      />
      <PageBody className="max-w-2xl">
        {patient.isPending ? (
          <div className="flex flex-col gap-3" aria-busy>
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : patient.isError ? (
          <ErrorNote title="Could not load patient" detail={patient.error.message} />
        ) : (
          <PatientForm
            key={`${orgSlug}:${patientId}`}
            orgSlug={orgSlug}
            patientId={patientId}
            patient={patient.data}
          />
        )}
      </PageBody>
      {visitDialogOpen ? (
        <NewVisitDialog
          orgSlug={orgSlug}
          patientId={patientId}
          patientName={patient.data?.name ?? ""}
          onClose={() => setVisitDialogOpen(false)}
        />
      ) : null}
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
    sex: "male" | "female" | "other" | "unknown";
    dateOfBirth: string | null;
    ageYears: number | null;
    address: string;
    email: string | null;
    bloodGroup: "A+" | "A-" | "B+" | "B-" | "AB+" | "AB-" | "O+" | "O-" | null;
    allergies: string | null;
    medicalHistory: string | null;
    uid: string | null;
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
      email: patient.email,
      bloodGroup: patient.bloodGroup,
      allergies: patient.allergies,
      medicalHistory: patient.medicalHistory,
      uid: patient.uid,
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
          email: saved.email,
          bloodGroup: saved.bloodGroup,
          allergies: saved.allergies,
          medicalHistory: saved.medicalHistory,
          uid: saved.uid,
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
          <SubmitButton isSubmitting={update.isPending} disabled={!form.formState.isDirty}>
            Save changes
          </SubmitButton>
        </div>
      </form>
    </Form>
  );
}

function NewVisitDialog({
  orgSlug,
  patientId,
  patientName,
  onClose,
}: {
  orgSlug: string;
  patientId: string;
  patientName: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const departments = useQuery(orpc.staff.listDepartments.queryOptions({ input: { orgSlug } }));
  const practitioners = useQuery(orpc.staff.listPractitioners.queryOptions({ input: { orgSlug } }));
  const form = useZodForm(visitFormSchema, {
    defaultValues: { departmentId: "", practitionerId: "" },
  });
  const departmentId = form.watch("departmentId");

  const createVisit = useMutation(
    orpc.visit.create.mutationOptions({
      onSuccess: ({ visit }) => {
        void queryClient.invalidateQueries({
          queryKey: orpc.visit.queue.key({ input: { orgSlug } }),
        });
        toast.success(`Token ${visit.tokenNumber} created`);
        onClose();
        void navigate({
          to: "/org/$orgSlug/front-desk/visits/$visitId",
          params: { orgSlug, visitId: visit.id },
        });
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const submit = form.handleSubmit(({ departmentId: selectedDepartmentId, practitionerId }) => {
    createVisit.mutate({
      orgSlug,
      patientId,
      departmentId: selectedDepartmentId,
      practitionerId,
    });
  });
  const loadingOptions = departments.isPending || practitioners.isPending;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New visit</DialogTitle>
          <DialogDescription>Create an outpatient token for {patientName}.</DialogDescription>
        </DialogHeader>
        {departments.isError || practitioners.isError ? (
          <div role="alert" className="border-l-2 border-destructive pl-3 text-xs">
            <p className="font-medium">Could not load staff options</p>
            <p className="mt-0.5 text-muted-foreground">
              {(departments.error ?? practitioners.error)?.message}
            </p>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={submit} className="flex flex-col gap-4">
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
                        disabled={loadingOptions || createVisit.isPending}
                        autoFocus
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
                      <NativeSelect
                        {...field}
                        disabled={!departmentId || loadingOptions || createVisit.isPending}
                      >
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
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={createVisit.isPending}
                  onClick={onClose}
                >
                  Cancel
                </Button>
                <SubmitButton isSubmitting={createVisit.isPending} disabled={loadingOptions}>
                  Create visit
                </SubmitButton>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
