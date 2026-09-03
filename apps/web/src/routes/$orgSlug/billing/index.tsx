import { Badge } from "@hms/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { BillingWorklistSheet } from "@/components/billing-worklist-sheet";
import {
  FilterGroup,
  ListState,
  ListToolbar,
  LoadMore,
  PageBody,
  PageHeader,
  Panel,
  SearchInput,
} from "@/components/page";
import { type WorklistRow, toWorklistRows, waitedLabel } from "@/lib/billing-worklist-row";
import { useMembership } from "@/lib/membership";
import { formatMoney } from "@/lib/money";
import { OPERATIONAL_INFINITE_REFETCH, OPERATIONAL_REFETCH } from "@/lib/operational-query";
import { formatBusinessDate, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { requireOrgPermission } from "@/lib/route-permission";

const FACETS = [
  { id: "all", label: "All" },
  { id: "to-bill", label: "To bill" },
  { id: "unpaid", label: "Unpaid" },
  { id: "overdue", label: "Over 7 days" },
] as const;

type Facet = (typeof FACETS)[number]["id"];

const facetSchema = z.enum(["all", "to-bill", "unpaid", "overdue"]);

const worklistQuery = (orgSlug: string, query: string) =>
  orpc.billing.worklist.queryOptions({ input: { orgSlug, query: query || undefined } });

const openInvoicesQuery = (orgSlug: string, query: string, overdueOnly: boolean) =>
  orpc.billing.openInvoices.infiniteOptions({
    input: (cursor: string | undefined) => ({
      orgSlug,
      query: query || undefined,
      overdueOnly,
      cursor,
      limit: 25,
    }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export const Route = createFileRoute("/$orgSlug/billing/")({
  head: () => ({ meta: [{ title: "Billing · HMS" }] }),
  validateSearch: z.object({
    view: facetSchema.optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ view: search.view }),
  loader: async ({ context: { queryClient }, deps, params: { orgSlug } }) => {
    // The worklist below is fetched without a catch, so a denial would otherwise reach
    // the generic error page and offer a Try again that reruns the same denial.
    await requireOrgPermission(queryClient, orgSlug, { billing: ["read"] }, "/$orgSlug/dashboard");
    await Promise.all([
      queryClient.query({ ...worklistQuery(orgSlug, ""), staleTime: "static" }),
      deps.view === "to-bill"
        ? null
        : queryClient
            .infiniteQuery(openInvoicesQuery(orgSlug, "", deps.view === "overdue"))
            .catch(() => {}),
      queryClient
        .query({
          ...orpc.billing.refundDue.queryOptions({ input: { orgSlug } }),
          staleTime: "static",
        })
        .catch(() => {}),
    ]);
  },
  component: BillingIndexRoute,
});

function BillingIndexRoute() {
  const { orgSlug } = Route.useParams();
  const { view } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { timeZone } = useOrgDateTime();

  const [query, setQuery] = useState("");
  const facet: Facet = view ?? "all";
  const [openRowKey, setOpenRowKey] = useState<string | null>(null);
  const currency = useMembership(orgSlug, (membership) => membership.currency);

  const worklist = useQuery({
    ...worklistQuery(orgSlug, query),
    ...OPERATIONAL_REFETCH,
  });
  const invoices = useInfiniteQuery({
    ...openInvoicesQuery(orgSlug, query, facet === "overdue"),
    ...OPERATIONAL_INFINITE_REFETCH,
    enabled: facet !== "to-bill",
  });
  const refunds = useQuery({
    ...orpc.billing.refundDue.queryOptions({
      input: { orgSlug, query: query || undefined },
    }),
    ...OPERATIONAL_REFETCH,
  });
  const refundData = refunds.data;

  const rows = toWorklistRows(
    facet === "all" || facet === "to-bill" ? (worklist.data?.unbilled ?? []) : [],
    facet === "to-bill" ? [] : (invoices.data?.pages.flatMap((page) => page.items) ?? []),
    currency,
  );
  // The sheet holds a key, not a row, so it always shows what the list shows.
  const openRow = rows.find((row) => row.key === openRowKey) ?? null;

  const pending = worklist.isPending || (facet !== "to-bill" && invoices.isPending);
  const failure = worklist.error ?? (facet !== "to-bill" ? invoices.error : null);
  // ListState receives one read state because this list combines two queries.
  const listQuery = {
    isPending: pending,
    isError: worklist.isError || (facet !== "to-bill" && invoices.isError),
    error: failure,
    refetch: () =>
      Promise.all([worklist.refetch(), ...(facet === "to-bill" ? [] : [invoices.refetch()])]),
  };
  const summary = worklist.data?.summary;

  return (
    <>
      <PageHeader title="Billing" description="Money owed to the hospital right now" />
      <PageBody>
        {summary ? (
          <Panel
            label="Today"
            minHeight="min-h-16"
            action={<span className="shrink-0 tabular-nums">{summary.receiptCount} receipts</span>}
            className="grid grid-cols-2 sm:grid-cols-4 sm:divide-x sm:divide-border"
          >
            <Stat
              label="Waiting to be billed"
              value={formatMoney(summary.toBillTotal, currency)}
              detail={`${summary.toBillCount} in the building`}
            />
            <Stat
              label="Collected"
              value={formatMoney(summary.collectedToday, currency)}
              detail="All payment methods"
            />
            <Stat
              label="Outstanding"
              value={formatMoney(summary.outstanding, currency)}
              detail={`${summary.openCount} open invoices`}
            />
            <Stat
              label="Over 30 days"
              value={formatMoney(summary.staleTotal, currency)}
              detail={`${summary.staleCount} nobody has chased`}
              alarm={Number(summary.staleTotal) > 0}
            />
          </Panel>
        ) : null}

        <ListToolbar>
          <SearchInput
            label="Search open money"
            placeholder="Search patient, MRN, or invoice number"
            onQueryChange={setQuery}
          />
          <FilterGroup
            label="Filter"
            value={facet}
            options={FACETS.map((option) => ({ value: option.id, label: option.label }))}
            onValueChange={(next) =>
              void navigate({
                search: (previous) => ({
                  ...previous,
                  view: next === "all" ? undefined : next,
                }),
                replace: true,
              })
            }
          />
        </ListToolbar>

        <Panel
          label="Open money"
          action={
            pending || failure ? null : (
              <Badge className="tabular-nums" variant={rows.length === 0 ? "muted" : "secondary"}>
                {rows.length}
              </Badge>
            )
          }
          footer={
            facet === "to-bill" ? undefined : <LoadMore query={invoices} shown={rows.length} />
          }
        >
          <ListState
            query={listQuery}
            errorTitle="Could not load open money"
            isEmpty={rows.length === 0}
            empty={query ? "Nothing open matches this search." : "Nothing is owed right now."}
          >
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Patient</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Owed</TableHead>
                    <TableHead className="text-right">Waiting</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={row.key}
                      tabIndex={0}
                      onClick={() => setOpenRowKey(row.key)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        setOpenRowKey(row.key);
                      }}
                      className="cursor-pointer"
                    >
                      <TableCell className="max-w-0">
                        <Link
                          to="/$orgSlug/opd/$appointmentId/billing"
                          params={{ orgSlug, appointmentId: row.appointmentId }}
                          title={row.patientName}
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                          className="block truncate text-left font-medium underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
                        >
                          {row.patientName}
                        </Link>
                        <p
                          className="truncate font-mono text-muted-foreground"
                          title={row.patientMrn}
                        >
                          {row.patientMrn}
                        </p>
                      </TableCell>
                      <TableCell className="max-w-0">
                        <div className="truncate font-mono" title={row.reference}>
                          {row.reference}
                        </div>
                        <div className="truncate text-muted-foreground" title={row.detail}>
                          {row.detail}
                        </div>
                      </TableCell>
                      <TableCell>
                        <StateBadge state={row.state} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatMoney(row.total, row.currency)}
                      </TableCell>
                      {/* Colour lands on the two things that decide what to do
                              next: what it is, and how much of it is late. */}
                      <TableCell
                        className={`text-right font-medium tabular-nums ${
                          row.state === "stale"
                            ? "text-destructive"
                            : row.state === "late"
                              ? "text-overdue"
                              : ""
                        }`}
                      >
                        {formatMoney(row.owed, row.currency)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums text-muted-foreground">
                        {waitedLabel(row.at, timeZone)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {(facet === "all" || facet === "to-bill") && worklist.data?.hasMore ? (
                <p className="text-xs text-muted-foreground">
                  Showing the {worklist.data.unbilled.length} oldest — search to narrow
                </p>
              ) : null}
            </>
          </ListState>
        </Panel>

        <Panel label="Refund due">
          <ListState
            query={refunds}
            errorTitle="Could not load refunds due"
            isEmpty={(refundData?.rows.length ?? 0) === 0}
            empty="No refunds due"
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Business date</TableHead>
                  <TableHead className="text-right">Refund due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {refundData?.rows.map((row) => (
                  <TableRow key={row.invoiceId}>
                    <TableCell className="font-mono whitespace-nowrap">
                      <Link
                        to="/$orgSlug/billing/invoices/$invoiceId"
                        params={{ orgSlug, invoiceId: row.invoiceId }}
                        className="underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
                      >
                        {row.invoiceNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-0">
                      <p className="truncate font-medium" title={row.patientName}>
                        {row.patientName}
                      </p>
                      <p
                        className="truncate font-mono text-muted-foreground"
                        title={row.patientMrn}
                      >
                        {row.patientMrn}
                      </p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatBusinessDate(row.businessDate)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatMoney(row.refundDue, refundData.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ListState>
        </Panel>
      </PageBody>

      <BillingWorklistSheet
        orgSlug={orgSlug}
        row={openRow}
        currency={currency}
        onClose={() => setOpenRowKey(null)}
      />
    </>
  );
}

function Stat({
  label,
  value,
  detail,
  alarm,
}: {
  label: string;
  value: string;
  detail: string;
  alarm?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 border-t border-border p-3 first:border-t-0 sm:border-t-0 [&:nth-child(2)]:border-t-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-sm font-medium tabular-nums ${alarm ? "text-destructive" : ""}`}>
        {value}
      </span>
      <span className="tabular-nums text-muted-foreground">{detail}</span>
    </div>
  );
}

function StateBadge({ state }: { state: WorklistRow["state"] }) {
  if (state === "to-bill") return <Badge variant="pending">To bill</Badge>;
  if (state === "stale") return <Badge variant="destructive">Over 30 days</Badge>;
  if (state === "late") return <Badge variant="overdue">Over 7 days</Badge>;
  return <Badge variant="muted">Unpaid</Badge>;
}
