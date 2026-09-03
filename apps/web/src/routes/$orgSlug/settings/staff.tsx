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
  RegisteredFormField,
} from "@hms/ui/components/form";
import { Input } from "@hms/ui/components/input";
import { NativeSelect } from "@hms/ui/components/native-select";
import { SubmitButton } from "@hms/ui/components/submit-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { optionalNumberText, optionalText } from "@/lib/form-schema";

import {
  ListState,
  ListToolbar,
  LoadMore,
  PageBody,
  PageHeader,
  Panel,
  SearchInput,
} from "@/components/page";
import { useZodForm } from "@/hooks/use-zod-form";
import { orpc } from "@/lib/orpc";
import { formatDate, useOrgDateTime } from "@/lib/org-datetime";
import { errorMessage } from "@/lib/orpc-error";
import { requireOrgPermission } from "@/lib/route-permission";

import { SettingsTabs } from "./route";

const feeItemsQuery = (orgSlug: string) =>
  orpc.catalog.list.infiniteOptions({
    input: (cursor: { name: string; id: string } | undefined) => ({
      orgSlug,
      activeOnly: true,
      cursor,
      limit: 50,
    }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export const Route = createFileRoute("/$orgSlug/settings/staff")({
  head: () => ({ meta: [{ title: "Staff · HMS" }] }),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    // Everyone may read the roster; only these roles may edit it, and this page is
    // nothing but the editor.
    await requireOrgPermission(queryClient, orgSlug, { staff: ["update"] }, "/$orgSlug/settings");
    await Promise.all([
      queryClient
        .query(orpc.staff.listDepartments.queryOptions({ input: { orgSlug } }))
        .catch(() => {}),
      queryClient
        .query(orpc.staff.listPractitioners.queryOptions({ input: { orgSlug } }))
        .catch(() => {}),
      queryClient.query(orpc.member.list.queryOptions({ input: { orgSlug } })).catch(() => {}),
      queryClient.infiniteQuery(feeItemsQuery(orgSlug)).catch(() => {}),
    ]);
  },
  component: StaffRoute,
});

const departmentSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a department name")
    .max(200, "Keep the name under 200 characters"),
  defaultConsultFeeItemId: optionalText(z.string()),
});

const practitionerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a practitioner name")
    .max(200, "Keep the name under 200 characters"),
  departmentId: z.string().min(1, "Choose a department"),
  registrationNumber: optionalText(z.string()),
  memberUserId: optionalText(z.string()),
  consultFeeItemId: optionalText(z.string()),
  followUpFeeItemId: optionalText(z.string()),
  followUpValidityDays: optionalNumberText(
    z.number().int().min(1, "Between 1 and 365 days").max(365, "Between 1 and 365 days"),
  ),
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
  const { timeZone } = useOrgDateTime();
  const [departmentDialog, setDepartmentDialog] = useState<DepartmentDialogState>(null);
  const [practitionerDialog, setPractitionerDialog] = useState<PractitionerDialogState>(null);
  const [query, setQuery] = useState("");

  const departments = useQuery(orpc.staff.listDepartments.queryOptions({ input: { orgSlug } }));
  const practitioners = useQuery(
    orpc.staff.listPractitioners.queryOptions({
      input: { orgSlug, query: query || undefined },
    }),
  );
  const members = useQuery(orpc.member.list.queryOptions({ input: { orgSlug } }));
  const catalog = useInfiniteQuery(feeItemsQuery(orgSlug));
  const catalogItems = catalog.data?.pages.flatMap((page) => page.items) ?? [];

  const departmentById = new Map(
    (departments.data ?? []).map((department) => [department.id, department]),
  );
  const memberByUserId = new Map(
    (members.data?.members ?? []).map((member) => [member.userId, member]),
  );
  const catalogById = new Map(catalogItems.map((item) => [item.id, item]));
  const catalogFooter = <LoadMore query={catalog} shown={catalogItems.length} />;

  return (
    <>
      <PageHeader
        title="Staff"
        description="Manage clinical departments, practitioners, login links, and consultation fees"
      />
      <SettingsTabs orgSlug={orgSlug} />

      <PageBody>
        <Panel
          label="Departments"
          action={
            <Button size="xs" onClick={() => setDepartmentDialog({ mode: "create" })}>
              New department
            </Button>
          }
        >
          <ListState
            query={departments}
            errorTitle="Could not load departments"
            isEmpty={departments.data?.length === 0}
            empty="No departments yet. A department groups practitioners and carries the fee they consult at."
          >
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
                {departments.data?.map((department) => (
                  <TableRow key={department.id}>
                    <TableCell className="font-medium">{department.name}</TableCell>
                    <TableCell>
                      {department.defaultConsultFeeItemId
                        ? (catalogById.get(department.defaultConsultFeeItemId)?.name ?? "—")
                        : "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(department.createdAt, timeZone)}
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
                ))}
              </TableBody>
            </Table>
          </ListState>
        </Panel>

        <div className="flex flex-col gap-2">
          <ListToolbar>
            <SearchInput
              label="Search practitioners"
              placeholder="Search name or registration no."
              onQueryChange={setQuery}
            />
          </ListToolbar>
          <Panel
            label="Practitioners"
            action={
              <Button
                size="xs"
                disabled={!departments.data?.length}
                onClick={() => setPractitionerDialog({ mode: "create" })}
              >
                New practitioner
              </Button>
            }
          >
            <ListState
              query={practitioners}
              errorTitle="Could not load practitioners"
              isEmpty={practitioners.data?.length === 0}
              empty={
                query
                  ? "No practitioners match this search."
                  : "No practitioners yet. Add the clinicians a patient can be booked with."
              }
            >
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
                  {practitioners.data?.map((practitioner) => {
                    const linkedMember = practitioner.memberUserId
                      ? memberByUserId.get(practitioner.memberUserId)
                      : undefined;
                    return (
                      <TableRow key={practitioner.id}>
                        <TableCell className="font-medium">{practitioner.name}</TableCell>
                        <TableCell>
                          {departmentById.get(practitioner.departmentId)?.name ?? "—"}
                        </TableCell>
                        <TableCell className="font-mono text-muted-foreground">
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
                  })}
                </TableBody>
              </Table>
            </ListState>
          </Panel>
        </div>
      </PageBody>

      {departmentDialog ? (
        <DepartmentDialog
          state={departmentDialog}
          orgSlug={orgSlug}
          catalogItems={catalogItems}
          catalogPending={catalog.isPending}
          catalogFooter={catalogFooter}
          onClose={() => setDepartmentDialog(null)}
        />
      ) : null}
      {practitionerDialog ? (
        <PractitionerDialog
          state={practitionerDialog}
          orgSlug={orgSlug}
          departments={departments.data ?? []}
          members={members.data?.members ?? []}
          catalogItems={catalogItems}
          membersPending={members.isPending}
          catalogPending={catalog.isPending}
          catalogFooter={catalogFooter}
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
  catalogFooter,
  onClose,
}: {
  state: Exclude<DepartmentDialogState, null>;
  orgSlug: string;
  catalogItems: CatalogOption[];
  catalogPending: boolean;
  catalogFooter: ReactNode;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const department = state.mode === "edit" ? state.department : null;
  const form = useZodForm(departmentSchema, {
    defaultValues: {
      name: department?.name ?? "",
      defaultConsultFeeItemId: department?.defaultConsultFeeItemId ?? "",
    },
  });

  const mutationFeedback = (message: string) => ({
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.staff.listDepartments.key({ input: { orgSlug } }),
      });
      toast.success(message);
      onClose();
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  });

  const createDepartment = useMutation(
    orpc.staff.createDepartment.mutationOptions(mutationFeedback("Department created")),
  );
  const updateDepartment = useMutation(
    orpc.staff.updateDepartment.mutationOptions(mutationFeedback("Department updated")),
  );
  const isSubmitting = createDepartment.isPending || updateDepartment.isPending;
  const submit = form.handleSubmit(({ name, defaultConsultFeeItemId }) => {
    const fields = { name, defaultConsultFeeItemId };
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
          <form noValidate onSubmit={submit} className="flex flex-col gap-4">
            <RegisteredFormField
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
            {/* Controlled, not registered: the catalog arrives from a query,
                and a stored id with no matching <option> yet would be lost. */}
            <FormField
              control={form.control}
              name="defaultConsultFeeItemId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Default consult fee (optional)</FormLabel>
                  <FormControl>
                    <NativeSelect {...field} disabled={isSubmitting || catalogPending}>
                      <option value="">None</option>
                      {catalogItems.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} ({item.code})
                        </option>
                      ))}
                    </NativeSelect>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {catalogFooter}
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
  catalogFooter,
  onClose,
}: {
  state: Exclude<PractitionerDialogState, null>;
  orgSlug: string;
  departments: Department[];
  members: MemberOption[];
  catalogItems: CatalogOption[];
  membersPending: boolean;
  catalogPending: boolean;
  catalogFooter: ReactNode;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const practitioner = state.mode === "edit" ? state.practitioner : null;
  const form = useZodForm(practitionerSchema, {
    defaultValues: {
      name: practitioner?.name ?? "",
      departmentId: practitioner?.departmentId ?? departments[0]?.id ?? "",
      registrationNumber: practitioner?.registrationNumber ?? "",
      memberUserId: practitioner?.memberUserId ?? "",
      consultFeeItemId: practitioner?.consultFeeItemId ?? "",
      followUpFeeItemId: practitioner?.followUpFeeItemId ?? "",
      followUpValidityDays:
        practitioner?.followUpValidityDays === null ||
        practitioner?.followUpValidityDays === undefined
          ? ""
          : String(practitioner.followUpValidityDays),
    },
  });

  const mutationFeedback = (message: string) => ({
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.staff.listPractitioners.key({ input: { orgSlug } }),
      });
      toast.success(message);
      onClose();
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  });

  const createPractitioner = useMutation(
    orpc.staff.createPractitioner.mutationOptions(mutationFeedback("Practitioner created")),
  );
  const updatePractitioner = useMutation(
    orpc.staff.updatePractitioner.mutationOptions(mutationFeedback("Practitioner updated")),
  );
  const isSubmitting = createPractitioner.isPending || updatePractitioner.isPending;
  const submit = form.handleSubmit((values) => {
    const fields = {
      name: values.name,
      departmentId: values.departmentId,
      registrationNumber: values.registrationNumber,
      memberUserId: values.memberUserId,
      consultFeeItemId: values.consultFeeItemId,
      followUpFeeItemId: values.followUpFeeItemId,
      followUpValidityDays: values.followUpValidityDays,
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
          <form noValidate onSubmit={submit} className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <RegisteredFormField
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
                      <NativeSelect {...field} disabled={isSubmitting}>
                        <option value="" disabled>
                          Choose a department
                        </option>
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
            </div>

            <RegisteredFormField
              name="registrationNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Registration no. (optional)</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={isSubmitting} />
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
                    <NativeSelect {...field} disabled={isSubmitting || membersPending}>
                      <option value="">None</option>
                      {members.map((member) => (
                        <option key={member.userId} value={member.userId}>
                          {member.name} — {member.email}
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
              name="consultFeeItemId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Consult fee item (optional)</FormLabel>
                  <FormControl>
                    <NativeSelect {...field} disabled={isSubmitting || catalogPending}>
                      <option value="">None</option>
                      {catalogItems.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} ({item.code})
                        </option>
                      ))}
                    </NativeSelect>
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
                      <NativeSelect {...field} disabled={isSubmitting || catalogPending}>
                        <option value="">None</option>
                        {catalogItems.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} ({item.code})
                          </option>
                        ))}
                      </NativeSelect>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <RegisteredFormField
                name="followUpValidityDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Follow-up window (days)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        min={1}
                        max={365}
                        step={1}
                        placeholder="Organization default"
                        disabled={isSubmitting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            {catalogFooter}

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
