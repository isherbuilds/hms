import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { BillingNav } from "@/components/billing-nav";
import { AdvanceReceiptLink } from "@/components/advance-form";
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
import { useMembership } from "@/lib/membership";
import { formatMoney } from "@/lib/money";
import { formatBusinessDate } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { requireOrgPermission } from "@/lib/route-permission";

type AdvancesCursor = { createdAt: Date; id: string };

const advancesQuery = (orgSlug: string, query: string) =>
  orpc.billing.advancesHeld.infiniteOptions({
    input: (cursor: AdvancesCursor | undefined) => ({
      orgSlug,
      query: query || undefined,
      cursor,
      limit: 25,
    }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export const Route = createFileRoute("/$orgSlug/billing/advances")({
  head: () => ({ meta: [{ title: "Advances held · HMS" }] }),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, { billing: ["read"] }, "/$orgSlug/dashboard");
    await queryClient.infiniteQuery(advancesQuery(orgSlug, "")).catch(() => {});
  },
  component: AdvancesHeldRoute,
});

function AdvancesHeldRoute() {
  const { orgSlug } = Route.useParams();
  const [query, setQuery] = useState("");
  const currency = useMembership(orgSlug, (membership) => membership.currency);

  const advances = useInfiniteQuery({
    ...advancesQuery(orgSlug, query),
    placeholderData: keepPreviousData,
  });

  const rows = advances.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <PageHeader title="Advances held" />
      <BillingNav orgSlug={orgSlug} />
      <PageBody>
        <ListToolbar>
          <SearchInput
            label="Search advances held"
            placeholder="Patient or MRN"
            onQueryChange={setQuery}
          />
        </ListToolbar>
        <Panel grow footer={<LoadMore query={advances} shown={rows.length} />}>
          <ListState
            query={advances}
            errorTitle="Could not load advances held"
            isEmpty={rows.length === 0}
            empty="No advances held"
          >
            <DataList
              columns={[
                {
                  head: "Patient",
                  cell: (row) => (
                    <>
                      <span className="capitalize">{row.patientName}</span>
                      <span className="block font-mono text-muted-foreground">
                        {row.patientMrn}
                      </span>
                    </>
                  ),
                },
                {
                  head: "Receipt",
                  mobile: "title",
                  cell: (row) => <span className="font-mono">{row.receiptNumber}</span>,
                },
                {
                  head: "Purpose",
                  cell: (row) =>
                    row.planStatus ? `${row.purpose} · ${row.planStatus}` : row.purpose,
                },
                {
                  head: "Received",
                  cell: (row) => (
                    <span className="text-muted-foreground">
                      {formatBusinessDate(row.businessDate)}
                    </span>
                  ),
                },
                {
                  head: "Credit held",
                  className: "text-right",
                  cell: (row) => (
                    <span className="font-medium tabular-nums">
                      {formatMoney(row.remaining, currency)}
                    </span>
                  ),
                },
              ]}
              rows={rows}
              rowKey={(row) => row.id}
              link={(row) => ({
                to: "/$orgSlug/patients/$patientId/billing",
                params: { orgSlug, patientId: row.patientId },
              })}
              action={(row) => (
                <AdvanceReceiptLink orgSlug={orgSlug} id={row.id} label={row.receiptNumber} />
              )}
            />
          </ListState>
        </Panel>
      </PageBody>
    </>
  );
}
