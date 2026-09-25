import { Button, buttonVariants } from "@hms/ui/components/button";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { type Department, DepartmentDialog } from "@/components/department-dialog";
import { type Practitioner, PractitionerDialog } from "@/components/practitioner-dialog";
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

// `{}` opens the create dialog; a row opens the edit dialog.
type DepartmentDialogState = { department?: Department } | null;

type PractitionerDialogState = { practitioner?: Practitioner } | null;

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
              view === "departments" ? setDepartmentDialog({}) : setPractitionerDialog({})
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
                  <Button variant="outline" onClick={() => setDepartmentDialog({})}>
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
                    onClick={() => setDepartmentDialog({ department })}
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
                      <Button variant="outline" onClick={() => setDepartmentDialog({})}>
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
                    onClick={() => setPractitionerDialog({ practitioner })}
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
          department={departmentDialog.department}
          orgSlug={orgSlug}
          catalogItems={catalogItems}
          catalogPending={catalog.isPending}
          catalogFooter={catalogFooter}
          onClose={() => setDepartmentDialog(null)}
        />
      ) : null}
      {practitionerDialog ? (
        <PractitionerDialog
          practitioner={practitionerDialog.practitioner}
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
