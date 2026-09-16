import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { AdvanceReceiptLink } from "@/components/advance-form";
import {
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
      <PageHeader title="Advances held" description="Unused patient credit, oldest receipt first" />
      <PageBody>
        <ListToolbar>
          <SearchInput
            label="Search advances held"
            placeholder="Search patient or MRN"
            onQueryChange={setQuery}
          />
        </ListToolbar>
        <Panel label="Patient credit" footer={<LoadMore query={advances} shown={rows.length} />}>
          <ListState
            query={advances}
            errorTitle="Could not load advances held"
            isEmpty={rows.length === 0}
            empty="No patient credit is being held."
          >
            <>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Patient</TableHead>
                      <TableHead>Receipt</TableHead>
                      <TableHead>Purpose</TableHead>
                      <TableHead>Received</TableHead>
                      <TableHead className="text-right">Credit held</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <Link
                            to="/$orgSlug/patients/$patientId"
                            params={{ orgSlug, patientId: row.patientId }}
                            search={{ tab: "billing" }}
                            className="font-medium capitalize underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
                          >
                            {row.patientName}
                          </Link>
                          <p className="font-mono text-muted-foreground">{row.patientMrn}</p>
                        </TableCell>
                        <TableCell>
                          <AdvanceReceiptLink
                            orgSlug={orgSlug}
                            id={row.id}
                            label={row.receiptNumber}
                          />
                        </TableCell>
                        <TableCell>
                          {row.planStatus ? `${row.purpose} · ${row.planStatus}` : row.purpose}
                        </TableCell>
                        <TableCell>{formatBusinessDate(row.businessDate)}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatMoney(row.remaining, currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <ul role="list" className="md:hidden">
                {rows.map((row) => (
                  <li key={row.id} className="border-b px-3 py-2 last:border-b-0">
                    <div className="flex min-w-0 items-baseline justify-between gap-2">
                      <Link
                        to="/$orgSlug/patients/$patientId"
                        params={{ orgSlug, patientId: row.patientId }}
                        search={{ tab: "billing" }}
                        className="min-w-0 truncate font-medium capitalize"
                      >
                        {row.patientName}
                      </Link>
                      <span className="shrink-0 font-medium tabular-nums">
                        {formatMoney(row.remaining, currency)}
                      </span>
                    </div>
                    <div className="flex min-w-0 items-baseline justify-between gap-2 text-muted-foreground">
                      <span className="truncate font-mono">{row.patientMrn}</span>
                      <AdvanceReceiptLink orgSlug={orgSlug} id={row.id} label={row.receiptNumber} />
                    </div>
                    <p className="truncate text-muted-foreground">
                      {row.planStatus ? `${row.purpose} · ${row.planStatus}` : row.purpose}
                      {` · ${formatBusinessDate(row.businessDate)}`}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          </ListState>
        </Panel>
      </PageBody>
    </>
  );
}
