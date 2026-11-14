import { practitionerDisplayName } from "@hms/api/lib/labels";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { appHead } from "@/config/site";
import { DataList, ListState, LoadMore, PageBody, PageHeader, Panel } from "@/components/page";
import { orpc } from "@/lib/orpc";
import { requireOrgPermission } from "@/lib/route-permission";

import { PharmacyTabs } from "./route";

// Who is in a bed now; each row opens that Admission with the issue form already open.
const currentAdmissionsQuery = (orgSlug: string) =>
  orpc.ipd.list.infiniteOptions({
    input: (cursor: { admittedAt: Date; id: string } | undefined) => ({
      orgSlug,
      state: "current" as const,
      cursor,
    }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });

export const Route = createFileRoute("/$orgSlug/pharmacy/inpatient")({
  head: () => appHead("Inpatient issue"),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    await requireOrgPermission(
      queryClient,
      orgSlug,
      { pharmacy: ["read", "issueAdmission"], ipd: ["read"] },
      "/$orgSlug/pharmacy",
    );
    await queryClient.infiniteQuery(currentAdmissionsQuery(orgSlug)).catch(() => {});
  },
  component: InpatientIssueRoute,
});

function InpatientIssueRoute() {
  const { orgSlug } = Route.useParams();
  const admissions = useInfiniteQuery(currentAdmissionsQuery(orgSlug));
  const items = admissions.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <PageHeader title="Pharmacy" />
      <PharmacyTabs orgSlug={orgSlug} />

      <PageBody>
        <Panel grow footer={<LoadMore query={admissions} shown={items.length} />}>
          <ListState
            query={admissions}
            errorTitle="Could not load admitted patients"
            isEmpty={items.length === 0}
            empty="No one is admitted"
          >
            <DataList
              columns={[
                {
                  head: "Patient",
                  cell: (item) => (
                    <span className="block min-w-0">
                      <span className="block truncate capitalize">{item.patientName}</span>
                      <span className="block truncate font-mono text-muted-foreground">
                        {item.mrn}
                      </span>
                    </span>
                  ),
                },
                {
                  head: "Bed",
                  cell: (item) =>
                    item.bedLabel ? (
                      <span className="whitespace-nowrap">
                        {item.wardName} <span className="font-mono">{item.bedLabel}</span>
                      </span>
                    ) : (
                      "—"
                    ),
                },
                {
                  head: "Doctor",
                  cell: (item) => (
                    <span className="capitalize">
                      {practitionerDisplayName(item.practitionerName)}
                    </span>
                  ),
                },
              ]}
              rows={items}
              rowKey={(item) => item.id}
              link={(item) => ({
                to: "/$orgSlug/ipd/$admissionId",
                params: { orgSlug, admissionId: item.id },
                search: { issue: 1 },
              })}
            />
          </ListState>
        </Panel>
      </PageBody>
    </>
  );
}
