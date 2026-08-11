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
import { Skeleton } from "@hms/ui/components/skeleton";
import { SubmitButton } from "@hms/ui/components/submit-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { useZodForm } from "@/hooks/use-zod-form";
import { orpc } from "@/lib/orpc";

export const Route = createFileRoute("/org/$orgSlug/settings/staff")({
  loader: ({ context: { queryClient }, params: { orgSlug } }) => {
    void Promise.all([
      queryClient.prefetchQuery(orpc.staff.listDepartments.queryOptions({ input: { orgSlug } })),
      queryClient.prefetchQuery(orpc.staff.listPractitioners.queryOptions({ input: { orgSlug } })),
    ]);
  },
  component: StaffRoute,
});

const SELECT_CLASS =
  "h-8 w-full rounded-none border border-input bg-transparent px-2 text-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 dark:bg-input/30";

const departmentSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a department name")
    .max(200, "Keep the name under 200 characters"),
  defaultConsultFeeItemId: z.string().min(1).nullable().optional(),
});

const practitionerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a practitioner name")
    .max(200, "Keep the name under 200 characters"),
  departmentId: z.string().min(1, "Choose a department"),
  registrationNumber: z.string().trim().nullable().optional(),
  memberUserId: z.string().min(1).nullable().optional(),
  consultFeeItemId: z.string().min(1).nullable().optional(),
  followUpFeeItemId: z.string().min(1).nullable().optional(),
  followUpValidityDays: z.number().int().min(1).max(365).nullable().optional(),
});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

type Department = {
  id: string;
  name: string;
  defaultConsultFeeItemId: string | null;
  createdAt: Date | string;
};

type Practitioner = {
  id: string;
  name: string;
  departmentId: string;
  registrationNumber: string | null;
  memberUserId: string | null;
  consultFeeItemId: string | null;
  followUpFeeItemId: string | null;
  followUpValidityDays: number | null;
};

type MemberOption = {
  userId: string;
  name: string;
  email: string;
};

type CatalogOption = {
  id: string;
  name: string;
  code: string;
};

type DepartmentDialogState = { mode: "create" } | { mode: "edit"; department: Department } | null;

type PractitionerDialogState =
  | { mode: "create" }
  | { mode: "edit"; practitioner: Practitioner }
  | null;

function StaffRoute() {
  const { orgSlug } = Route.useParams();
  const [departmentDialog, setDepartmentDialog] = useState<DepartmentDialogState>(null);
  const [practitionerDialog, setPractitionerDialog] = useState<PractitionerDialogState>(null);

  const departments = useQuery(orpc.staff.listDepartments.queryOptions({ input: { orgSlug } }));
  const practitioners = useQuery(orpc.staff.listPractitioners.queryOptions({ input: { orgSlug } }));
  const members = useQuery(orpc.members.list.queryOptions({ input: { orgSlug } }));
  const catalog = useQuery(
    orpc.catalog.list.queryOptions({
      input: { orgSlug, category: "consultation", activeOnly: true },
    }),
  );

  const departmentById = useMemo(
    () => new Map((departments.data ?? []).map((department) => [department.id, department])),
    [departments.data],
  );
  const memberByUserId = useMemo(
    () => new Map((members.data?.members ?? []).map((member) => [member.userId, member])),
    [members.data],
  );
  const catalogById = useMemo(
    () => new Map((catalog.data ?? []).map((item) => [item.id, item])),
    [catalog.data],
  );

  return (
    <>
      <PageHeader
        title="Staff"
        description="Manage clinical departments, practitioners, login links, and consultation fees"
      />

      <PageBody>
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium">Departments</h2>
              <p className="text-xs text-muted-foreground">Organize practitioners by department.</p>
            </div>
            <Button size="sm" onClick={() => setDepartmentDialog({ mode: "create" })}>
              <PlusIcon data-icon="inline-start" />
              New department
            </Button>
          </div>

          {departments.isPending ? (
            <div className="flex flex-col gap-2" aria-busy>
              {[0, 1].map((row) => (
                <Skeleton key={row} className="h-10 w-full" />
              ))}
            </div>
          ) : departments.isError ? (
            <ErrorNote title="Could not load departments" detail={departments.error.message} />
          ) : (
            <div className="ring-1 ring-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Default consult fee</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="w-16 text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {departments.data.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        No departments yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    departments.data.map((department) => (
                      <TableRow key={department.id}>
                        <TableCell className="font-medium">{department.name}</TableCell>
                        <TableCell>
                          {department.defaultConsultFeeItemId
                            ? (catalogById.get(department.defaultConsultFeeItemId)?.name ?? "—")
                            : "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {dateFormatter.format(new Date(department.createdAt))}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => setDepartmentDialog({ mode: "edit", department })}
                          >
                            Edit
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium">Practitioners</h2>
              <p className="text-xs text-muted-foreground">
                Link clinicians to departments, accounts, and consultation fees.
              </p>
            </div>
            <Button
              size="sm"
              disabled={!departments.data?.length}
              onClick={() => setPractitionerDialog({ mode: "create" })}
            >
              <PlusIcon data-icon="inline-start" />
              New practitioner
            </Button>
          </div>

          {practitioners.isPending ? (
            <div className="flex flex-col gap-2" aria-busy>
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} className="h-10 w-full" />
              ))}
            </div>
          ) : practitioners.isError ? (
            <ErrorNote title="Could not load practitioners" detail={practitioners.error.message} />
          ) : (
            <div className="ring-1 ring-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Registration no.</TableHead>
                    <TableHead>Linked account</TableHead>
                    <TableHead>Consult fee item</TableHead>
                    <TableHead>Follow-up fee item</TableHead>
                    <TableHead className="w-16 text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {practitioners.data.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        No practitioners yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    practitioners.data.map((practitioner) => {
                      const linkedMember = practitioner.memberUserId
                        ? memberByUserId.get(practitioner.memberUserId)
                        : undefined;
                      return (
                        <TableRow key={practitioner.id}>
                          <TableCell className="font-medium">{practitioner.name}</TableCell>
                          <TableCell>
                            {departmentById.get(practitioner.departmentId)?.name ?? "—"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {practitioner.registrationNumber || "—"}
                          </TableCell>
                          <TableCell>
                            {linkedMember ? (
                              <div className="min-w-0">
                                <div className="truncate">{linkedMember.name}</div>
                                <div className="truncate text-muted-foreground">
                                  {linkedMember.email}
                                </div>
                              </div>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell>
                            {practitioner.consultFeeItemId
                              ? (catalogById.get(practitioner.consultFeeItemId)?.name ?? "—")
                              : "—"}
                          </TableCell>
                          <TableCell>
                            {practitioner.followUpFeeItemId
                              ? (catalogById.get(practitioner.followUpFeeItemId)?.name ?? "—")
                              : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => setPractitionerDialog({ mode: "edit", practitioner })}
                            >
                              Edit
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      </PageBody>

      {departmentDialog ? (
        <DepartmentDialog
          state={departmentDialog}
          orgSlug={orgSlug}
          catalogItems={catalog.data ?? []}
          catalogPending={catalog.isPending}
          onClose={() => setDepartmentDialog(null)}
        />
      ) : null}
      {practitionerDialog ? (
        <PractitionerDialog
          state={practitionerDialog}
          orgSlug={orgSlug}
          departments={departments.data ?? []}
          members={members.data?.members ?? []}
          catalogItems={catalog.data ?? []}
          membersPending={members.isPending}
          catalogPending={catalog.isPending}
          onClose={() => setPractitionerDialog(null)}
        />
      ) : null}
    </>
  );
}

function DepartmentDialog({
  state,
  orgSlug,
  catalogItems,
  catalogPending,
  onClose,
}: {
  state: Exclude<DepartmentDialogState, null>;
  orgSlug: string;
  catalogItems: CatalogOption[];
  catalogPending: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const department = state.mode === "edit" ? state.department : null;
  const form = useZodForm(departmentSchema, {
    defaultValues: {
      name: department?.name ?? "",
      defaultConsultFeeItemId: department?.defaultConsultFeeItemId ?? null,
    },
  });

  const onSuccess = (message: string) => {
    void queryClient.invalidateQueries({
      queryKey: orpc.staff.listDepartments.key({ input: { orgSlug } }),
    });
    toast.success(message);
    onClose();
  };
  const onError = (error: unknown) => {
    const conflict =
      typeof error === "object" && error !== null && "code" in error && error.code === "CONFLICT";
    toast.error(
      conflict
        ? "Department already exists"
        : error instanceof Error
          ? error.message
          : "Something went wrong",
    );
  };

  const createDepartment = useMutation(
    orpc.staff.createDepartment.mutationOptions({
      onSuccess: () => onSuccess("Department created"),
      onError,
    }),
  );
  const updateDepartment = useMutation(
    orpc.staff.updateDepartment.mutationOptions({
      onSuccess: () => onSuccess("Department updated"),
      onError,
    }),
  );
  const isSubmitting = createDepartment.isPending || updateDepartment.isPending;
  const submit = form.handleSubmit(({ name, defaultConsultFeeItemId }) => {
    const fields = { name, defaultConsultFeeItemId: defaultConsultFeeItemId || null };
    if (department) {
      updateDepartment.mutate({ orgSlug, departmentId: department.id, ...fields });
    } else {
      createDepartment.mutate({ orgSlug, ...fields });
    }
  });

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{department ? "Edit department" : "New department"}</DialogTitle>
          <DialogDescription>
            {department
              ? "Rename this department for every practitioner assigned to it."
              : "Create a department before assigning practitioners."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} autoFocus disabled={isSubmitting} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="defaultConsultFeeItemId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Default consult fee (optional)</FormLabel>
                  <FormControl>
                    <select
                      className={SELECT_CLASS}
                      name={field.name}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      value={field.value ?? ""}
                      onChange={(event) => field.onChange(event.target.value || null)}
                      disabled={isSubmitting || catalogPending}
                    >
                      <option value="">None</option>
                      {catalogItems.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} ({item.code})
                        </option>
                      ))}
                    </select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={isSubmitting} onClick={onClose}>
                Cancel
              </Button>
              <SubmitButton isSubmitting={isSubmitting}>
                {department ? "Save changes" : "Create department"}
              </SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function PractitionerDialog({
  state,
  orgSlug,
  departments,
  members,
  catalogItems,
  membersPending,
  catalogPending,
  onClose,
}: {
  state: Exclude<PractitionerDialogState, null>;
  orgSlug: string;
  departments: Department[];
  members: MemberOption[];
  catalogItems: CatalogOption[];
  membersPending: boolean;
  catalogPending: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const practitioner = state.mode === "edit" ? state.practitioner : null;
  const form = useZodForm(practitionerSchema, {
    defaultValues: {
      name: practitioner?.name ?? "",
      departmentId: practitioner?.departmentId ?? departments[0]?.id ?? "",
      registrationNumber: practitioner?.registrationNumber ?? null,
      memberUserId: practitioner?.memberUserId ?? null,
      consultFeeItemId: practitioner?.consultFeeItemId ?? null,
      followUpFeeItemId: practitioner?.followUpFeeItemId ?? null,
      followUpValidityDays: practitioner?.followUpValidityDays ?? null,
    },
  });

  const onError = (error: unknown) =>
    toast.error(error instanceof Error ? error.message : "Something went wrong");
  const onSuccess = (message: string) => {
    void queryClient.invalidateQueries({
      queryKey: orpc.staff.listPractitioners.key({ input: { orgSlug } }),
    });
    toast.success(message);
    onClose();
  };

  const createPractitioner = useMutation(
    orpc.staff.createPractitioner.mutationOptions({
      onSuccess: () => onSuccess("Practitioner created"),
      onError,
    }),
  );
  const updatePractitioner = useMutation(
    orpc.staff.updatePractitioner.mutationOptions({
      onSuccess: () => onSuccess("Practitioner updated"),
      onError,
    }),
  );
  const isSubmitting = createPractitioner.isPending || updatePractitioner.isPending;
  const submit = form.handleSubmit((values) => {
    const fields = {
      name: values.name,
      departmentId: values.departmentId,
      registrationNumber: values.registrationNumber?.trim() || null,
      memberUserId: values.memberUserId || null,
      consultFeeItemId: values.consultFeeItemId || null,
      followUpFeeItemId: values.followUpFeeItemId || null,
      followUpValidityDays: values.followUpValidityDays ?? null,
    };
    if (practitioner) {
      updatePractitioner.mutate({ orgSlug, practitionerId: practitioner.id, ...fields });
    } else {
      createPractitioner.mutate({ orgSlug, ...fields });
    }
  });

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{practitioner ? "Edit practitioner" : "New practitioner"}</DialogTitle>
          <DialogDescription>
            Assign the practitioner to a department and optionally link their login and consultation
            fee.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input {...field} autoFocus disabled={isSubmitting} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="departmentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Department</FormLabel>
                    <FormControl>
                      <select className={SELECT_CLASS} {...field} disabled={isSubmitting}>
                        <option value="" disabled>
                          Choose a department
                        </option>
                        {departments.map((department) => (
                          <option key={department.id} value={department.id}>
                            {department.name}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="registrationNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Registration no. (optional)</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} disabled={isSubmitting} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="memberUserId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Linked member (optional)</FormLabel>
                  <FormControl>
                    <select
                      className={SELECT_CLASS}
                      name={field.name}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      value={field.value ?? ""}
                      onChange={(event) => field.onChange(event.target.value || null)}
                      disabled={isSubmitting || membersPending}
                    >
                      <option value="">None</option>
                      {members.map((member) => (
                        <option key={member.userId} value={member.userId}>
                          {member.name} — {member.email}
                        </option>
                      ))}
                    </select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="consultFeeItemId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Consult fee item (optional)</FormLabel>
                  <FormControl>
                    <select
                      className={SELECT_CLASS}
                      name={field.name}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      value={field.value ?? ""}
                      onChange={(event) => field.onChange(event.target.value || null)}
                      disabled={isSubmitting || catalogPending}
                    >
                      <option value="">None</option>
                      {catalogItems.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} ({item.code})
                        </option>
                      ))}
                    </select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="followUpFeeItemId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Follow-up fee (optional)</FormLabel>
                    <FormControl>
                      <select
                        className={SELECT_CLASS}
                        name={field.name}
                        ref={field.ref}
                        onBlur={field.onBlur}
                        value={field.value ?? ""}
                        onChange={(event) => field.onChange(event.target.value || null)}
                        disabled={isSubmitting || catalogPending}
                      >
                        <option value="">None</option>
                        {catalogItems.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} ({item.code})
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="followUpValidityDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Follow-up window (days)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={365}
                        step={1}
                        name={field.name}
                        ref={field.ref}
                        onBlur={field.onBlur}
                        value={field.value ?? ""}
                        onChange={(event) =>
                          field.onChange(
                            event.target.value === "" ? null : Number(event.target.value),
                          )
                        }
                        placeholder="Organization default"
                        disabled={isSubmitting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" disabled={isSubmitting} onClick={onClose}>
                Cancel
              </Button>
              <SubmitButton isSubmitting={isSubmitting}>
                {practitioner ? "Save changes" : "Create practitioner"}
              </SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
