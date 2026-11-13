import { buttonVariants } from "@hms/ui/components/button";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { appHead } from "@/config/site";
import { AdmissionStatusBadge } from "@/components/ipd-dialogs";
import {
  DataList,
  ListState,
  ListToolbar,
  LoadMore,
  PageBody,
  PageHeader,
  Panel,
} from "@/components/page";
import { formatDateTime, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { requireOrgPermission } from "@/lib/route-permission";
import { practitionerDisplayName } from "@hms/api/lib/labels";

import { IpdTabs } from "./route";

const STATES = ["current", "past", "all"] as const;

type AdmissionState = (typeof STATES)[number];

const STATE_LABELS: Record<AdmissionState, string> = {
  current: "In hospital",
  past: "Ended",
  all: "All",
};

const admissionsQuery = (orgSlug: string, state: AdmissionState) =>
  orpc.ipd.list.infiniteOptions({
    input: (cursor: { admittedAt: Date; id: string } | undefined) => ({ orgSlug, state, cursor }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });

export const Route = createFileRoute("/$orgSlug/ipd/admissions")({
  head: () => appHead("Admissions"),
  validateSearch: z.object({
    state: z.enum(STATES).default("current").catch("current"),
  }),
  loaderDeps: ({ search }) => ({ state: search.state }),
  loader: async ({ context: { queryClient }, deps, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, { ipd: ["read"] }, "/$orgSlug/dashboard");
    await queryClient.infiniteQuery(admissionsQuery(orgSlug, deps.state)).catch(() => {});
  },
  component: AdmissionsRoute,
});

function AdmissionsRoute() {
  const { orgSlug } = Route.useParams();
  const { state } = Route.useSearch();
  const { timeZone } = useOrgDateTime();
  const admissions = useInfiniteQuery(admissionsQuery(orgSlug, state));
  const items = admissions.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <PageHeader title="IPD" />
      <IpdTabs orgSlug={orgSlug} />

      <PageBody>
        <ListToolbar>
          <nav aria-label="Admission states" className="flex items-center gap-1">
            {STATES.map((item) => (
              <Link
                key={item}
                to="/$orgSlug/ipd/admissions"
                params={{ orgSlug }}
                search={{ state: item }}
                replace
                className={buttonVariants({ variant: state === item ? "secondary" : "ghost" })}
              >
                {STATE_LABELS[item]}
              </Link>
            ))}
          </nav>
        </ListToolbar>

        <Panel grow footer={<LoadMore query={admissions} shown={items.length} />}>
          <ListState
            query={admissions}
            errorTitle="Could not load admissions"
            isEmpty={items.length === 0}
            empty={state === "current" ? "No one is admitted" : "No admissions"}
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
                  mobile: "hidden",
                },
                {
                  head: "Admitted",
                  cell: (item) => (
                    <span className="whitespace-nowrap tabular-nums">
                      {formatDateTime(item.admittedAt, timeZone)}
                    </span>
                  ),
                },
                {
                  head: "Status",
                  cell: (item) => <AdmissionStatusBadge status={item.status} />,
                  className: "text-right",
                },
              ]}
              rows={items}
              rowKey={(item) => item.id}
              link={(item) => ({
                to: "/$orgSlug/ipd/$admissionId",
                params: { orgSlug, admissionId: item.id },
              })}
            />
          </ListState>
        </Panel>
      </PageBody>
    </>
  );
}
