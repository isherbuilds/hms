import { Badge } from "@hms/ui/components/badge";
import { DropdownMenuCheckboxItem } from "@hms/ui/components/dropdown-menu";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { CircleDotIcon } from "lucide-react";
import { useRef, useState } from "react";
import { z } from "zod";

import { BillingNav } from "@/components/billing-nav";
import { BillingWorklistSheet } from "@/components/billing-worklist-sheet";
import {
  FilterChips,
  FilterMenu,
  FilterSubmenu,
  focusSearch,
  type ActiveFilter,
} from "@/components/list-filter";
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
import { type WorklistRow, toWorklistRows, waitedLabel } from "@/lib/billing-worklist-row";
import { useMembership } from "@/lib/membership";
import { formatMoney, ZERO } from "@/lib/money";
import { OPERATIONAL_INFINITE_REFETCH, OPERATIONAL_REFETCH } from "@/lib/operational-query";
import { useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { openingCredit } from "@/lib/patient-credit";
import { requireOrgPermission } from "@/lib/route-permission";

// "all" is the absent view, so it is a filter to remove, never one to pick.
const VIEWS = ["to-bill", "unpaid", "overdue"] as const;

const VIEW_LABELS = {
  "to-bill": "To bill",
  unpaid: "Unpaid",
  overdue: "Over 7 days",
} as const;

type Facet = (typeof VIEWS)[number] | "all";

const worklistQuery = (orgSlug: string, query: string) =>
  orpc.billing.worklist.queryOptions({
    input: { orgSlug, query: query || undefined },
  });

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
    q: z.string().trim().min(1).max(100).optional().catch(undefined),
    view: z.enum(VIEWS).optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ q: search.q, view: search.view }),
  loader: async ({ context: { queryClient }, deps, params: { orgSlug } }) => {
    // The worklist below is fetched without a catch, so a denial would otherwise reach
    // the generic error page and offer a Try again that reruns the same denial.
    await requireOrgPermission(queryClient, orgSlug, { billing: ["read"] }, "/$orgSlug/dashboard");
    await Promise.all([
      queryClient.query({ ...worklistQuery(orgSlug, deps.q ?? ""), staleTime: "static" }),
      deps.view === "to-bill"
        ? null
        : queryClient
            .infiniteQuery(openInvoicesQuery(orgSlug, deps.q ?? "", deps.view === "overdue"))
            .catch(() => {}),
    ]);
  },
  component: BillingIndexRoute,
});

function BillingIndexRoute() {
  const { orgSlug } = Route.useParams();
  const { q, view } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { timeZone } = useOrgDateTime();

  const queryClient = useQueryClient();
  const field = useRef<HTMLDivElement>(null);
  const query = q ?? "";
  const facet: Facet = view ?? "all";
  // The sheet holds a key and the credit read when it opened, never a row: the row
  // itself always comes from the list, so a refetch cannot leave it behind.
  const [open, setOpen] = useState<{ key: string; credit: bigint } | null>(null);
  const currency = useMembership(orgSlug, (membership) => membership.currency);

  const worklist = useQuery({
    ...worklistQuery(orgSlug, query),
    ...OPERATIONAL_REFETCH,
    placeholderData: keepPreviousData,
  });

  const invoices = useInfiniteQuery({
    ...openInvoicesQuery(orgSlug, query, facet === "overdue"),
    ...OPERATIONAL_INFINITE_REFETCH,
    enabled: facet !== "to-bill",
    placeholderData: keepPreviousData,
  });

  const invoiceRows =
    facet === "to-bill" ? [] : (invoices.data?.pages.flatMap((page) => page.items) ?? []);

  const rows = toWorklistRows(
    facet === "all" || facet === "to-bill" ? (worklist.data?.unbilled ?? []) : [],
    invoiceRows,
    currency,
  );

  const openRow = rows.find((row) => row.key === open?.key);
  const sheet = open && openRow ? { row: openRow, credit: open.credit } : null;

  const latestClick = useRef<string | null>(null);

  const openSheet = async (row: WorklistRow) => {
    latestClick.current = row.key;

    const credit =
      row.invoiceId && row.patientId
        ? await openingCredit(queryClient, orgSlug, row.patientId)
        : ZERO;

    if (credit === null || latestClick.current !== row.key) return;
    setOpen({ key: row.key, credit });
  };

  const pending = worklist.isPending || (facet !== "to-bill" && invoices.isPending);
  const failure = worklist.error ?? (facet !== "to-bill" ? invoices.error : null);

  // ListState receives one read state because this list combines two queries.
  const listQuery = {
    isPending: pending,
    isLoadingError: worklist.isLoadingError || (facet !== "to-bill" && invoices.isLoadingError),
    error: failure,
    refetch: () =>
      Promise.all([worklist.refetch(), ...(facet === "to-bill" ? [] : [invoices.refetch()])]),
  };

  const summary = worklist.data?.summary;

  const setFilters = (patch: { q?: string; view?: (typeof VIEWS)[number] }) =>
    navigate({ replace: true, search: (previous) => ({ ...previous, ...patch }) });

  const clear = () => {
    focusSearch(field, { empty: true });
    void setFilters({ q: undefined, view: undefined });
  };

  const chips: ActiveFilter[] =
    view === undefined
      ? []
      : [
          {
            id: "view",
            name: "View",
            label: VIEW_LABELS[view],
            remove: () => setFilters({ view: undefined }),
          },
        ];

  return (
    <>
      <PageHeader title="Billing" />
      <BillingNav orgSlug={orgSlug} />
      <PageBody>
        {summary ? (
          <Panel
            label="Overview"
            minHeight="min-h-16"
            action={<span className="tabular-nums">{summary.receiptCount} receipts today</span>}
          >
            <dl className="grid grid-cols-2 sm:grid-cols-4 sm:divide-x sm:divide-border">
              <Stat
                label="Waiting to be billed"
                value={formatMoney(summary.toBillTotal, currency)}
                detail={`${summary.toBillCount} in the building`}
              />
              <Stat
                label="Collected today"
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
                detail={`${summary.staleCount} awaiting follow-up`}
                alarm={summary.staleTotal > ZERO}
              />
            </dl>
          </Panel>
        ) : null}

        <ListToolbar>
          <SearchInput
            label="Search open money"
            placeholder="Patient, MRN, or invoice number"
            value={q}
            fieldRef={field}
            onQueryChange={(next) => void setFilters({ q: next || undefined })}
            trailing={
              <FilterMenu anchor={field} active={chips.length > 0}>
                <FilterSubmenu icon={CircleDotIcon} label="View">
                  {VIEWS.map((candidate) => (
                    <DropdownMenuCheckboxItem
                      key={candidate}
                      checked={view === candidate}
                      onCheckedChange={(checked) =>
                        void setFilters({ view: checked ? candidate : undefined })
                      }
                    >
                      {VIEW_LABELS[candidate]}
                    </DropdownMenuCheckboxItem>
                  ))}
                </FilterSubmenu>
              </FilterMenu>
            }
          />
          <FilterChips filters={chips} field={field} onClear={clear} />
        </ListToolbar>

        <Panel
          grow
          label="Open money"
          action={
            pending || failure ? null : (
              <Badge className="tabular-nums" variant={rows.length === 0 ? "muted" : "secondary"}>
                {rows.length}
              </Badge>
            )
          }
          footer={
            facet === "to-bill" ? undefined : (
              <LoadMore query={invoices} shown={invoiceRows.length} />
            )
          }
        >
          <ListState
            query={listQuery}
            errorTitle="Could not load open money"
            isEmpty={rows.length === 0}
            empty={query ? "No matching open money" : "Nothing owed"}
          >
            <>
              <DataList
                columns={[
                  {
                    head: "Reference",
                    className: "max-w-0",
                    cell: (row) => (
                      <>
                        <span className="block truncate font-mono" title={row.reference}>
                          {row.reference}
                        </span>
                        <span className="block truncate text-muted-foreground" title={row.detail}>
                          {row.detail}
                        </span>
                      </>
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
                    head: "State",
                    cell: (row) => <StateBadge state={row.state} />,
                    mobile: "title",
                  },
                  {
                    head: "Total",
                    className: "text-right",
                    cell: (row) => (
                      <span className="tabular-nums text-muted-foreground">
                        {formatMoney(row.total, row.currency)}
                      </span>
                    ),
                  },
                  {
                    head: "Owed",
                    className: "text-right",
                    cell: (row) => (
                      <span
                        className={`font-medium tabular-nums ${
                          row.state === "stale"
                            ? "text-destructive"
                            : row.state === "late"
                              ? "text-overdue"
                              : ""
                        }`}
                      >
                        {formatMoney(row.owed, row.currency)}
                      </span>
                    ),
                  },
                  {
                    head: "Waiting",
                    className: "text-right",
                    cell: (row) => (
                      <span className="whitespace-nowrap tabular-nums text-muted-foreground">
                        {waitedLabel(row.at, timeZone)}
                      </span>
                    ),
                  },
                ]}
                rows={rows}
                rowKey={(row) => row.key}
                onActivate={(row) => void openSheet(row)}
                action={(row) =>
                  row.appointmentId ? (
                    <Link
                      to="/$orgSlug/opd/$appointmentId/billing"
                      params={{ orgSlug, appointmentId: row.appointmentId }}
                      className="relative whitespace-nowrap text-xs underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
                    >
                      Visit billing
                    </Link>
                  ) : null
                }
              />
              {(facet === "all" || facet === "to-bill") && worklist.data?.hasMore ? (
                <p className="text-xs text-muted-foreground">
                  Showing the {worklist.data.unbilled.length} oldest — search to narrow
                </p>
              ) : null}
            </>
          </ListState>
        </Panel>
      </PageBody>

      <BillingWorklistSheet orgSlug={orgSlug} open={sheet} onClose={() => setOpen(null)} />
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
    <div className="flex flex-col gap-1 border-t border-border p-3 first:border-t-0 sm:border-t-0 nth-2:border-t-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`text-2xl font-medium tabular-nums ${alarm ? "text-destructive" : ""}`}>
        {value}
      </dd>
      <dd className="tabular-nums text-muted-foreground">{detail}</dd>
    </div>
  );
}

function StateBadge({ state }: { state: WorklistRow["state"] }) {
  if (state === "to-bill") return <Badge variant="pending">To bill</Badge>;

  if (state === "stale") return <Badge variant="destructive">Over 30 days</Badge>;

  if (state === "late") return <Badge variant="overdue">Over 7 days</Badge>;

  return <Badge variant="muted">Unpaid</Badge>;
}
