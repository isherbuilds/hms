import { buttonVariants } from "@hms/ui/components/button";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { DateFilter } from "@/components/list-filter";
import {
  DataList,
  ListState,
  ListToolbar,
  LoadMore,
  PageBody,
  PageHeader,
  Panel,
} from "@/components/page";
import { PharmacySaleSheet } from "@/components/pharmacy-sale-sheet";
import { useCan, useMembership } from "@/lib/membership";
import { formatMoney } from "@/lib/money";
import { formatBusinessDate, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { requireOrgPermission } from "@/lib/route-permission";

import { PharmacyTabs } from "./route";

const salesQuery = (orgSlug: string, range: { from?: string; to?: string }) =>
  orpc.pharmacy.listSales.infiniteOptions({
    input: (cursor: { createdAt: string; id: string } | undefined) => ({
      orgSlug,
      from: range.from,
      to: range.to,
      cursor,
      limit: 50,
    }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });

export const Route = createFileRoute("/$orgSlug/pharmacy/")({
  head: () => ({ meta: [{ title: "Pharmacy sales · HMS" }] }),
  validateSearch: z.object({
    from: z.iso.date().optional().catch(undefined),
    to: z.iso.date().optional().catch(undefined),
    // The open sale lives in the URL, so the desk can hand over the one it just recorded.
    sale: z.string().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ from: search.from, to: search.to }),
  loader: async ({ context: { queryClient }, deps, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, { pharmacy: ["read"] }, "/$orgSlug/dashboard");
    await queryClient.infiniteQuery(salesQuery(orgSlug, deps)).catch(() => {});
  },
  component: PharmacySalesRoute,
});

function PharmacySalesRoute() {
  const { orgSlug } = Route.useParams();
  const { from, to, sale } = Route.useSearch();
  const navigate = Route.useNavigate();
  const currency = useMembership(orgSlug, (membership) => membership.currency);
  const canSell = useCan(orgSlug, { pharmacy: ["sell"] });
  const { today } = useOrgDateTime();

  const patchSearch = (patch: { from?: string; to?: string; sale?: string }) =>
    navigate({ replace: true, search: (previous) => ({ ...previous, ...patch }) });

  const openSale = (saleId: string) =>
    navigate({ search: (previous) => ({ ...previous, sale: saleId }) });

  // Today is the server's own default, so it leaves the URL rather than pinning it.
  const setRange = (range: { from?: string; to?: string }) =>
    patchSearch(
      range.from === today && range.to === today ? { from: undefined, to: undefined } : range,
    );

  const sales = useInfiniteQuery(salesQuery(orgSlug, { from, to }));
  const items = sales.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <PageHeader
        title="Pharmacy"
        action={
          canSell ? (
            <Link className={buttonVariants()} to="/$orgSlug/pharmacy/new" params={{ orgSlug }}>
              <span className="sm:hidden">New</span>
              <span className="hidden sm:inline">New sale</span>
            </Link>
          ) : undefined
        }
      />
      <PharmacyTabs orgSlug={orgSlug} />

      <PageBody>
        <ListToolbar>
          <DateFilter
            today={today}
            from={from ?? today}
            to={to ?? today}
            onChange={(range) => void setRange(range)}
          />
        </ListToolbar>

        <Panel grow footer={<LoadMore query={sales} shown={items.length} />}>
          <ListState
            query={sales}
            errorTitle="Could not load pharmacy sales"
            isEmpty={items.length === 0}
            empty="No sales in this range"
          >
            <DataList
              columns={[
                {
                  head: "Invoice",
                  cell: (item) => <span className="font-mono">{item.invoiceNumber}</span>,
                },
                {
                  head: "Date",
                  cell: (item) => (
                    <span className="whitespace-nowrap">
                      {formatBusinessDate(item.businessDate)}
                    </span>
                  ),
                },
                {
                  head: "Buyer",
                  cell: (item) => (
                    <span className="capitalize">
                      {item.buyerName}
                      {item.patientId ? null : (
                        <span className="text-muted-foreground normal-case"> (walk-in)</span>
                      )}
                    </span>
                  ),
                },
                {
                  head: "Total",
                  cell: (item) => (
                    <span className="tabular-nums">{formatMoney(item.grandTotal, currency)}</span>
                  ),
                  className: "text-right",
                },
              ]}
              rows={items}
              rowKey={(item) => item.saleId}
              onActivate={(item) => void openSale(item.saleId)}
              action={(item) =>
                item.patientId ? (
                  <Link
                    to="/$orgSlug/patients/$patientId/billing"
                    params={{ orgSlug, patientId: item.patientId }}
                    className="underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
                  >
                    Patient billing
                  </Link>
                ) : null
              }
            />
          </ListState>
        </Panel>
      </PageBody>

      <PharmacySaleSheet
        orgSlug={orgSlug}
        saleId={sale ?? null}
        onClose={() => void patchSearch({ sale: undefined })}
      />
    </>
  );
}
