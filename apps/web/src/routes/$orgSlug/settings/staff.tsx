import { Button, buttonVariants } from "@hms/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@hms/ui/components/dialog";
import { Form, FormControl } from "@hms/ui/components/form";
import { NativeSelect } from "@hms/ui/components/native-select";
import { SubmitButton } from "@hms/ui/components/submit-button";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { optionalNumberText, optionalText } from "@/lib/form-schema";

import { ControlledField, TextField } from "@/components/form-fields";
import {
  DataList,
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
import { requireOrgPermission } from "@/lib/route-permission";
import { practitionerDisplayName } from "@/lib/practitioner-name";

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
  validateSearch: z.object({
    view: z.enum(["practitioners", "departments"]).default("practitioners").catch("practitioners"),
  }),
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
  const { view } = Route.useSearch();
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
        action={
          <Button
            disabled={view === "practitioners" && !departments.data?.length}
            onClick={() =>
              view === "departments"
                ? setDepartmentDialog({ mode: "create" })
                : setPractitionerDialog({ mode: "create" })
            }
          >
            {view === "departments" ? "New department" : "New practitioner"}
          </Button>
        }
      />
      <SettingsTabs orgSlug={orgSlug} />

      <PageBody>
        <ListToolbar>
          {view === "practitioners" ? (
            <SearchInput
              label="Search practitioners"
              placeholder="Name or registration number"
              value={query}
              onQueryChange={setQuery}
            />
          ) : null}
          <nav aria-label="Staff views" className="flex items-center gap-1">
            {(["practitioners", "departments"] as const).map((item) => (
              <Link
                key={item}
                to="/$orgSlug/settings/staff"
                params={{ orgSlug }}
                search={{ view: item }}
                replace
                className={buttonVariants({ variant: view === item ? "secondary" : "ghost" })}
              >
                {item === "practitioners" ? "Practitioners" : "Departments"}
              </Link>
            ))}
          </nav>
        </ListToolbar>
        <Panel label={view === "practitioners" ? "Practitioners" : "Departments"} grow>
          {view === "departments" ? (
            <ListState
              query={departments}
              errorTitle="Could not load departments"
              isEmpty={departments.data?.length === 0}
              empty={
                <div className="flex max-w-sm flex-col items-center gap-2">
                  <p>No departments yet</p>
                  <p>Add a department before adding practitioners.</p>
                  <Button variant="outline" onClick={() => setDepartmentDialog({ mode: "create" })}>
                    New department
                  </Button>
                </div>
              }
            >
              <DataList
                columns={[
                  { head: "Name", cell: (department) => department.name },
                  {
                    head: "Default consult fee",
                    cell: (department) =>
                      department.defaultConsultFeeItemId
                        ? (catalogById.get(department.defaultConsultFeeItemId)?.name ?? "—")
                        : "—",
                  },
                  {
                    head: "Created",
                    cell: (department) => (
                      <span className="whitespace-nowrap text-muted-foreground tabular-nums">
                        {formatDate(department.createdAt, timeZone)}
                      </span>
                    ),
                  },
                ]}
                rows={departments.data ?? []}
                rowKey={(department) => department.id}
                action={(department) => (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setDepartmentDialog({ mode: "edit", department })}
                  >
                    Edit
                  </Button>
                )}
              />
            </ListState>
          ) : (
            <ListState
              query={practitioners}
              errorTitle="Could not load practitioners"
              isEmpty={practitioners.data?.length === 0}
              empty={
                <div className="flex max-w-sm flex-col items-center gap-2">
                  <p>{query ? "No matching practitioners" : "No practitioners yet"}</p>
                  {!query && departments.isSuccess && departments.data.length === 0 ? (
                    <>
                      <p>Add a department before adding practitioners.</p>
                      <Button
                        variant="outline"
                        onClick={() => setDepartmentDialog({ mode: "create" })}
                      >
                        New department
                      </Button>
                    </>
                  ) : null}
                </div>
              }
            >
              <DataList
                columns={[
                  {
                    head: "Name",
                    cell: (practitioner) => (
                      <span className="capitalize">
                        {practitionerDisplayName(practitioner.name)}
                      </span>
                    ),
                  },
                  {
                    head: "Department",
                    cell: (practitioner) =>
                      departmentById.get(practitioner.departmentId)?.name ?? "—",
                  },
                  {
                    head: "Registration no.",
                    cell: (practitioner) => (
                      <span className="font-mono text-muted-foreground">
                        {practitioner.registrationNumber || "—"}
                      </span>
                    ),
                    mobile: "title",
                  },
                  {
                    head: "Linked account",
                    cell: (practitioner) => {
                      const linkedMember = practitioner.memberUserId
                        ? memberByUserId.get(practitioner.memberUserId)
                        : undefined;

                      return linkedMember ? (
                        <span className="block min-w-0">
                          <span className="block truncate">{linkedMember.name}</span>
                          <span className="block truncate text-muted-foreground">
                            {linkedMember.email}
                          </span>
                        </span>
                      ) : (
                        "—"
                      );
                    },
                  },
                  {
                    head: "Consult fee item",
                    cell: (practitioner) =>
                      practitioner.consultFeeItemId
                        ? (catalogById.get(practitioner.consultFeeItemId)?.name ?? "—")
                        : "—",
                  },
                  {
                    head: "Follow-up fee item",
                    cell: (practitioner) =>
                      practitioner.followUpFeeItemId
                        ? (catalogById.get(practitioner.followUpFeeItemId)?.name ?? "—")
                        : "—",
                  },
                ]}
                rows={practitioners.data ?? []}
                rowKey={(practitioner) => practitioner.id}
                action={(practitioner) => (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setPractitionerDialog({ mode: "edit", practitioner })}
                  >
                    Edit
                  </Button>
                )}
              />
            </ListState>
          )}
        </Panel>
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
  const department = state.mode === "edit" ? state.department : null;

  const form = useZodForm(departmentSchema, {
    defaultValues: {
      name: department?.name ?? "",
      defaultConsultFeeItemId: department?.defaultConsultFeeItemId ?? "",
    },
  });

  const mutationFeedback = (message: string) => ({
    onSuccess: () => {
      toast.success(message);
      onClose();
    },
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
          {!department ? (
            <DialogDescription>
              Departments group practitioners and set a default consult fee
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <Form {...form}>
          <form noValidate onSubmit={submit} className="flex flex-col gap-4">
            <TextField name="name" label="Name" autoFocus disabled={isSubmitting} />
            {/* Controlled, not registered: the catalog arrives from a query,
                and a stored id with no matching <option> yet would be lost. */}
            <ControlledField
              name="defaultConsultFeeItemId"
              label="Default consult fee (optional)"
              render={(field) => (
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
    onSuccess: () => {
      toast.success(message);
      onClose();
    },
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
              <TextField name="name" label="Name" autoFocus disabled={isSubmitting} />
              <ControlledField
                name="departmentId"
                label="Department"
                render={(field) => (
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
                )}
              />
            </div>

            <TextField
              name="registrationNumber"
              label="Registration no. (optional)"
              disabled={isSubmitting}
            />

            <ControlledField
              name="memberUserId"
              label="Linked member (optional)"
              render={(field) => (
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
              )}
            />

            <ControlledField
              name="consultFeeItemId"
              label="Consult fee item (optional)"
              render={(field) => (
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
              )}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <ControlledField
                name="followUpFeeItemId"
                label="Follow-up fee (optional)"
                render={(field) => (
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
                )}
              />
              <TextField
                name="followUpValidityDays"
                label="Follow-up window (days)"
                type="number"
                min={1}
                max={365}
                step={1}
                placeholder="Organization default"
                disabled={isSubmitting}
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
