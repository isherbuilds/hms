import { buttonVariants } from "@hms/ui/components/button";
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
import { PlusIcon } from "lucide-react";
import { z } from "zod";

import { DateFilter } from "@/components/list-filter";
import { ListState, ListToolbar, LoadMore, PageBody, PageHeader, Panel } from "@/components/page";
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
              <PlusIcon data-icon="inline-start" />
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

        <Panel label="Sales" grow footer={<LoadMore query={sales} shown={items.length} />}>
          <ListState
            query={sales}
            errorTitle="Could not load pharmacy sales"
            isEmpty={items.length === 0}
            empty="No sales in this range."
          >
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Buyer</TableHead>
                    <TableHead>Patient</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.saleId}>
                      <TableCell className="whitespace-nowrap">
                        {formatBusinessDate(item.businessDate)}
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          aria-haspopup="dialog"
                          className="font-mono underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
                          onClick={() => void patchSearch({ sale: item.saleId })}
                        >
                          {item.invoiceNumber}
                        </button>
                      </TableCell>
                      <TableCell className="capitalize">{item.buyerName}</TableCell>
                      <TableCell>
                        {item.patientId ? (
                          <Link
                            to="/$orgSlug/patients/$patientId"
                            params={{ orgSlug, patientId: item.patientId }}
                            search={{ tab: "billing" }}
                            className="underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
                          >
                            Patient record
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">Walk-in</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(item.grandTotal, currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="md:hidden">
              {items.map((item) => (
                <li key={item.saleId} className="border-b border-border/60 last:border-b-0">
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    className="flex min-h-10 w-full items-start gap-2 px-3 py-2 text-left"
                    onClick={() => void patchSearch({ sale: item.saleId })}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono">{item.invoiceNumber}</span>
                      <span className="mt-1 block truncate text-muted-foreground capitalize">
                        {item.buyerName}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-medium tabular-nums">
                        {formatMoney(item.grandTotal, currency)}
                      </span>
                      <span className="mt-1 block whitespace-nowrap text-muted-foreground">
                        {formatBusinessDate(item.businessDate)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
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
