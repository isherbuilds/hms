import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { BillingNav } from "@/components/billing-nav";
import {
  DataList,
  ListState,
  ListToolbar,
  PageBody,
  PageHeader,
  Panel,
  SearchInput,
} from "@/components/page";
import { useMembership } from "@/lib/membership";
import { formatMoney } from "@/lib/money";
import { OPERATIONAL_REFETCH } from "@/lib/operational-query";
import { formatBusinessDate } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { requireOrgPermission } from "@/lib/route-permission";

export const Route = createFileRoute("/$orgSlug/billing/refunds")({
  head: () => ({ meta: [{ title: "Refunds due · HMS" }] }),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, { billing: ["read"] }, "/$orgSlug/dashboard");
    await queryClient
      .query(orpc.billing.refundDue.queryOptions({ input: { orgSlug } }))
      .catch(() => {});
  },
  component: RefundsRoute,
});

function RefundsRoute() {
  const { orgSlug } = Route.useParams();
  const [query, setQuery] = useState("");
  const currency = useMembership(orgSlug, (membership) => membership.currency);

  const refunds = useQuery({
    ...orpc.billing.refundDue.queryOptions({ input: { orgSlug, query: query || undefined } }),
    ...OPERATIONAL_REFETCH,
    placeholderData: keepPreviousData,
  });

  const refundData = refunds.data;

  return (
    <>
      <PageHeader title="Refunds due" />
      <BillingNav orgSlug={orgSlug} />
      <PageBody>
        <ListToolbar>
          <SearchInput
            label="Search refunds due"
            placeholder="Patient, MRN, or invoice number"
            onQueryChange={setQuery}
          />
        </ListToolbar>
        <Panel grow label="Refund due">
          <ListState
            query={refunds}
            errorTitle="Could not load refunds due"
            isEmpty={(refundData?.rows.length ?? 0) === 0}
            empty="Nothing to refund"
          >
            <>
              <DataList
                columns={[
                  {
                    head: "Invoice",
                    cell: (row) => (
                      <span className="whitespace-nowrap font-mono">{row.invoiceNumber}</span>
                    ),
                  },
                  {
                    head: "Patient",
                    className: "max-w-0",
                    mobile: "title",
                    cell: (row) => (
                      <>
                        <span
                          className="block truncate font-medium capitalize"
                          title={row.patientName}
                        >
                          {row.patientName}
                        </span>
                        {row.patientMrn ? (
                          <span
                            className="block truncate font-mono text-muted-foreground"
                            title={row.patientMrn}
                          >
                            {row.patientMrn}
                          </span>
                        ) : null}
                      </>
                    ),
                  },
                  {
                    head: "Business date",
                    cell: (row) => (
                      <span className="whitespace-nowrap">
                        {formatBusinessDate(row.businessDate)}
                      </span>
                    ),
                  },
                  {
                    head: "Refund due",
                    className: "text-right",
                    cell: (row) => (
                      <span className="font-medium tabular-nums">
                        {formatMoney(row.refundDue, currency)}
                      </span>
                    ),
                  },
                ]}
                rows={refundData?.rows ?? []}
                rowKey={(row) => row.invoiceId}
                link={(row) => ({
                  to: "/$orgSlug/billing/invoices/$invoiceId",
                  params: { orgSlug, invoiceId: row.invoiceId },
                })}
              />
              {refundData?.hasMore ? (
                <p className="px-3 py-2 text-muted-foreground">
                  Showing the oldest {refundData.rows.length}. Settle these to see the rest.
                </p>
              ) : null}
            </>
          </ListState>
        </Panel>
      </PageBody>
    </>
  );
}
