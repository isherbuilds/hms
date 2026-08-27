import { Badge } from "@hms/ui/components/badge";
import { Button } from "@hms/ui/components/button";
import { Input } from "@hms/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { ToggleGroup, ToggleGroupItem } from "@hms/ui/components/toggle-group";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { SearchIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

import { BillingWorklistSheet } from "@/components/billing-worklist-sheet";
import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { type WorklistRow, toWorklistRows, waitedLabel } from "@/lib/billing-worklist-row";
import { formatMoney } from "@/lib/money";
import { OPERATIONAL_INFINITE_REFETCH, OPERATIONAL_REFETCH } from "@/lib/operational-query";
import { useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";

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
    q: z
      .string()
      .trim()
      .optional()
      .catch(undefined)
      .transform((value) => value || undefined),
    view: facetSchema.optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ q: search.q, view: search.view }),
  loader: async ({ context: { queryClient }, deps, params: { orgSlug } }) => {
    const query = deps.q ?? "";
    await Promise.all([
      queryClient.ensureQueryData(worklistQuery(orgSlug, query)),
      deps.view === "to-bill"
        ? null
        : queryClient.prefetchInfiniteQuery(
            openInvoicesQuery(orgSlug, query, deps.view === "overdue"),
          ),
    ]);
  },
  component: BillingIndexRoute,
});

/**
 * Every rupee the hospital is owed, in one list: charges nobody has invoiced,
 * then invoices nobody has paid. They were two boards before, which made the
 * cashier pick a board before they could look up a patient, and hid the second
 * half's growth entirely — the list was capped at 50 with nothing to say so.
 *
 * The list pages on a cursor and searches in SQL, so it stays the same size at
 * fifty open invoices and at five thousand.
 */
function BillingIndexRoute() {
  const { orgSlug } = Route.useParams();
  const { q, view } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { timeZone } = useOrgDateTime();

  const [query, setQuery] = useState(() => q ?? "");
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  const lastUrlQuery = useRef(q);
  const facet: Facet = view ?? "all";
  const [openRow, setOpenRow] = useState<WorklistRow | null>(null);
  const membership = useQuery(orpc.member.me.queryOptions({ input: { orgSlug } }));
  const currency = membership.data?.currency;

  // An external URL change (Back, a shared link) adopts the new value; our own
  // debounced writes are recorded so they do not clobber what has been typed since.
  useEffect(() => {
    if (q !== lastUrlQuery.current) {
      lastUrlQuery.current = q;
      setQuery(q ?? "");
    }
  }, [q]);

  useEffect(() => {
    if (debouncedQuery !== query.trim()) return;
    const nextQuery = debouncedQuery || undefined;
    if (nextQuery === q) return;
    lastUrlQuery.current = nextQuery;
    void navigate({ search: (previous) => ({ ...previous, q: nextQuery }), replace: true });
  }, [debouncedQuery, query, navigate, q]);

  const worklist = useQuery({
    ...worklistQuery(orgSlug, debouncedQuery),
    ...OPERATIONAL_REFETCH,
  });
  const invoices = useInfiniteQuery({
    ...openInvoicesQuery(orgSlug, debouncedQuery, facet === "overdue"),
    ...OPERATIONAL_INFINITE_REFETCH,
    enabled: facet !== "to-bill",
  });

  const rows = useMemo(
    () =>
      currency
        ? toWorklistRows(
            facet === "all" || facet === "to-bill" ? (worklist.data?.unbilled ?? []) : [],
            facet === "to-bill" ? [] : (invoices.data?.pages.flatMap((page) => page.items) ?? []),
            currency,
          )
        : [],
    [worklist.data, invoices.data, facet, currency],
  );

  const failure = membership.isError
    ? membership.error.message
    : membership.isSuccess && !currency
      ? "Organization currency is not configured."
      : worklist.isError
        ? worklist.error.message
        : invoices.isError
          ? invoices.error.message
          : null;
  const summary = worklist.data?.summary;
  const pending =
    membership.isPending || worklist.isPending || (facet !== "to-bill" && invoices.isPending);

  return (
    <>
      <PageHeader title="Billing" description="Money owed to the hospital right now" />
      <PageBody>
        {summary && currency ? (
          <section className="flex flex-col rounded-xl bg-muted p-1">
            <div className="flex h-9 items-center justify-between gap-2 px-3 text-muted-foreground">
              <h2 className="min-w-0 truncate">Today</h2>
              <span className="shrink-0 tabular-nums">{summary.receiptCount} receipts</span>
            </div>
            <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-border bg-card sm:grid-cols-4 sm:divide-x sm:divide-border">
              <Stat
                label="Waiting to be billed"
                value={formatMoney(summary.toBillTotal, currency)}
                detail={`${summary.toBillCount} in the building`}
              />
              <Stat
                label="Collected"
                value={formatMoney(summary.collectedToday, currency)}
                detail="Cash, UPI and card"
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
            </div>
          </section>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1 sm:max-w-md">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search patient, MRN, or invoice number"
              aria-label="Search open money"
              className="pl-8"
            />
          </div>
          <div className="flex items-center rounded-lg bg-muted p-0.5">
            <ToggleGroup
              aria-label="Filter"
              value={[facet]}
              size="sm"
              spacing={1}
              onValueChange={(value) => {
                const next = value[0] as Facet | undefined;
                if (!next) return;
                void navigate({
                  search: (previous) => ({ ...previous, view: next === "all" ? undefined : next }),
                  replace: true,
                });
              }}
            >
              {FACETS.map((option) => (
                <ToggleGroupItem key={option.id} value={option.id}>
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>

        <section className="flex flex-col rounded-xl bg-muted p-1">
          <div className="flex h-9 items-center justify-between gap-2 px-3 text-muted-foreground">
            <h2 className="min-w-0 truncate">Open money</h2>
            {pending || failure ? null : (
              <Badge variant={rows.length === 0 ? "muted" : "secondary"}>{rows.length}</Badge>
            )}
          </div>
          {/* The card holds every state the list can be in, so the page keeps
              one shape through a poll, a failure and an empty search. */}
          <div className="min-h-32 overflow-hidden rounded-lg border border-border bg-card">
            {pending ? null : failure ? (
              <ErrorNote title="Could not load what is owed" detail={failure} inset />
            ) : rows.length === 0 ? (
              <div className="flex min-h-32 items-center justify-center px-4 text-center text-muted-foreground">
                {debouncedQuery
                  ? "Nothing open matches this search."
                  : "Nothing is owed right now."}
              </div>
            ) : (
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
                        onClick={() => setOpenRow(row)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter") return;
                          event.preventDefault();
                          setOpenRow(row);
                        }}
                        className="cursor-pointer"
                      >
                        <TableCell>
                          <Link
                            to="/$orgSlug/opd/$appointmentId/billing"
                            params={{ orgSlug, appointmentId: row.appointmentId }}
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => event.stopPropagation()}
                            className="text-left font-medium underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
                          >
                            {row.patientName}
                          </Link>
                          <p className="font-mono text-muted-foreground">{row.patientMrn}</p>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span className="font-mono">{row.reference}</span>
                          <p className="text-muted-foreground">{row.detail}</p>
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
                {facet !== "to-bill" && invoices.hasNextPage ? (
                  <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-muted-foreground">
                    <span className="tabular-nums">{rows.length} shown</span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={invoices.isFetchingNextPage}
                      onClick={() => void invoices.fetchNextPage()}
                    >
                      Load 25 more
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </section>
      </PageBody>

      {currency ? (
        <BillingWorklistSheet
          orgSlug={orgSlug}
          row={openRow}
          currency={currency}
          onClose={() => setOpenRow(null)}
        />
      ) : null}
    </>
  );
}

function Stat({
  label,
  value,
  detail,
  alarm = false,
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
      <span className="text-muted-foreground">{detail}</span>
    </div>
  );
}

function StateBadge({ state }: { state: WorklistRow["state"] }) {
  if (state === "to-bill") return <Badge variant="pending">To bill</Badge>;
  if (state === "stale") return <Badge variant="destructive">Over 30 days</Badge>;
  if (state === "late") return <Badge variant="overdue">Over 7 days</Badge>;
  return <Badge variant="muted">Unpaid</Badge>;
}
