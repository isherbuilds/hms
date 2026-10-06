import { NativeSelect } from "@hms/ui/components/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { useMutation, useSuspenseInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";

import { DateFilter } from "@/components/list-filter";
import {
  ErrorNote,
  ListToolbar,
  LoadMore,
  PageBody,
  PageHeader,
  SearchInput,
} from "@/components/page";
import { ReportActions } from "@/components/report-actions";
import { appHead } from "@/config/site";
import { useCan, useMembership } from "@/lib/membership";
import { formatMoney, ZERO } from "@/lib/money";
import { orgToday, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { loadRouteQuery } from "@/lib/orpc-error";
import { saveXlsx } from "@/lib/report-export";
import { REPORT_PRINT_LANDSCAPE_CSS } from "@/lib/report-presentation";
import { requireOrgPermission } from "@/lib/route-permission";

type RegisterFilters = { from: string; to: string; stream?: "opd" | "pharmacy"; query?: string };

type RegisterCursor = { businessDate: string; createdAt: string; id: string };

const registerQuery = (orgSlug: string, filters: RegisterFilters) =>
  orpc.report.invoiceRegister.infiniteOptions({
    input: (cursor: RegisterCursor | undefined) => ({ orgSlug, ...filters, cursor }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

const moneyColumns = [
  ["subtotal", "Subtotal"],
  ["discountAmount", "Discount"],
  ["taxableValue", "Issued line value"],
  ["taxTotal", "GST"],
  ["roundOff", "Round-off"],
  ["grandTotal", "Invoice total"],
  ["creditTotal", "Credit notes"],
  ["netBilled", "Net billed"],
  ["paymentsTotal", "Paid"],
  ["allocationsTotal", "Allocated credit"],
  ["refundsTotal", "Refunds"],
  ["outstanding", "Outstanding"],
] as const;

export const Route = createFileRoute("/$orgSlug/reports/invoice-register")({
  head: () => appHead("Invoice register"),
  validateSearch: z.object({
    from: z.iso.date().optional().catch(undefined),
    to: z.iso.date().optional().catch(undefined),
    stream: z.enum(["opd", "pharmacy"]).optional().catch(undefined),
    query: z.string().trim().min(1).max(100).optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ context: { queryClient }, params: { orgSlug }, deps }) => {
    const { timeZone } = await requireOrgPermission(
      queryClient,
      orgSlug,
      { report: ["readFinancial"] },
      "/$orgSlug/dashboard",
    );

    const settings = await queryClient.query(
      orpc.settings.get.queryOptions({ input: { orgSlug } }),
    );

    const today = orgToday(timeZone);
    const month = settings.fiscalYearStartMonth;
    const year = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < month ? 1 : 0);

    const filters = {
      ...deps,
      from: deps.from ?? `${year}-${String(month).padStart(2, "0")}-01`,
      to: deps.to ?? today,
    };

    await loadRouteQuery(queryClient.infiniteQuery(registerQuery(orgSlug, filters)));

    return filters;
  },
  component: InvoiceRegisterRoute,
});

function InvoiceRegisterRoute() {
  const { orgSlug } = Route.useParams();
  const filters = Route.useLoaderData();
  const navigate = Route.useNavigate();
  const { today } = useOrgDateTime();
  const currency = useMembership(orgSlug, (membership) => membership.currency);
  const canReadBilling = useCan(orgSlug, { billing: ["read"] });
  const canReadOpd = useCan(orgSlug, { opd: ["read"] });
  const canReadPharmacy = useCan(orgSlug, { pharmacy: ["read"] });
  const report = useSuspenseInfiniteQuery(registerQuery(orgSlug, filters));
  const summary = report.data.pages[0]?.summary;
  const rows = report.data.pages.flatMap((page) => page.rows);

  const download = useMutation({
    ...orpc.export.invoiceRegisterXlsx.mutationOptions(),
    ...saveXlsx,
  });

  const patchSearch = (patch: Partial<RegisterFilters>) =>
    navigate({ replace: true, search: (previous) => ({ ...previous, ...patch }) });

  return (
    <>
      <PageHeader title="Invoice register" />
      <PageBody>
        <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
          <ListToolbar>
            <DateFilter
              today={today}
              from={filters.from}
              to={filters.to}
              maxDays={366}
              onChange={(range) => patchSearch(range)}
            />
            <SearchInput
              label="Search invoice register"
              placeholder="Full invoice number, patient name or MRN"
              value={filters.query}
              onQueryChange={(query) => patchSearch({ query: query || undefined })}
            />
            <label className="flex items-center gap-2">
              Stream
              <NativeSelect
                aria-label="Invoice stream"
                value={filters.stream ?? "all"}
                onChange={(event) =>
                  patchSearch({
                    stream:
                      event.target.value === "all"
                        ? undefined
                        : event.target.value === "opd"
                          ? "opd"
                          : "pharmacy",
                  })
                }
              >
                <option value="all">All streams</option>
                <option value="opd">OPD</option>
                <option value="pharmacy">Pharmacy</option>
              </NativeSelect>
            </label>
          </ListToolbar>
          <ReportActions
            disabled={report.isFetching || download.isPending}
            onExport={() => download.mutate({ orgSlug, ...filters })}
          />
        </div>
        {report.isRefetchError ? (
          <ErrorNote
            title="Could not refresh; loaded invoice balances may be stale"
            error={report.error}
          />
        ) : null}
        <section data-report-print className="flex flex-col gap-4">
          <header className="flex flex-col gap-1 border-b pb-2">
            <h1 className="text-sm font-medium">Invoice register</h1>
            <p className="text-muted-foreground">
              Invoices issued {filters.from} to {filters.to}, with balances as of now. Paid excludes
              advance credit; a negative outstanding is a refund due.
            </p>
          </header>
          {summary ? (
            <>
              <section className="flex flex-col gap-2" aria-label="All filtered invoice totals">
                <h2 className="font-medium">All {summary.totals.count} matching invoices</h2>
                <dl className="grid grid-cols-2 gap-3 border-y py-3 sm:grid-cols-3 lg:grid-cols-6">
                  {moneyColumns.map(([key, label]) => (
                    <div key={key}>
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="font-medium tabular-nums">
                        {formatMoney(summary.totals[key], currency)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
              <section className="flex flex-col gap-2">
                <h2 className="font-medium">Number series</h2>
                <Table>
                  <caption className="sr-only">First and last number of each series</caption>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">Stream</TableHead>
                      <TableHead scope="col">Fiscal year</TableHead>
                      <TableHead scope="col">Count</TableHead>
                      <TableHead scope="col">First number</TableHead>
                      <TableHead scope="col">Last number</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.series.map((series) => (
                      <TableRow key={`${series.stream}-${series.fiscalYear}`}>
                        <TableCell className="capitalize">{series.stream}</TableCell>
                        <TableCell>{series.fiscalYear}</TableCell>
                        <TableCell>{series.count}</TableCell>
                        <TableCell className="font-mono">{series.firstNumber}</TableCell>
                        <TableCell className="font-mono">{series.lastNumber}</TableCell>
                      </TableRow>
                    ))}
                    {summary.series.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5}>No invoices in this selection.</TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </section>
            </>
          ) : null}
          <section className="flex flex-col gap-2">
            <h2 className="font-medium">Invoices · {rows.length} loaded</h2>
            <p className="text-muted-foreground">
              Newest first. Excel has every match; print has the loaded rows.
            </p>
            <div className="ring-1 ring-border">
              <Table className="min-w-6xl print:min-w-0">
                <caption className="sr-only">
                  Invoice documents with current linked balances
                </caption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Date</TableHead>
                    <TableHead scope="col">Full invoice number</TableHead>
                    <TableHead scope="col">Stream / fiscal year</TableHead>
                    <TableHead scope="col">Patient / counter sale</TableHead>
                    {moneyColumns.map(([key, label]) => (
                      <TableHead scope="col" key={key} className="text-right">
                        {label}
                      </TableHead>
                    ))}
                    <TableHead scope="col" className="print:hidden">
                      Source
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap">{row.businessDate}</TableCell>
                      <TableCell className="font-mono">
                        {canReadBilling ? (
                          <Link
                            to="/$orgSlug/billing/invoices/$invoiceId"
                            params={{ orgSlug, invoiceId: row.id }}
                            className="text-brand underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
                          >
                            {row.invoiceNumber}
                          </Link>
                        ) : (
                          row.invoiceNumber
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="capitalize">{row.stream}</span>
                        <p className="text-muted-foreground">{row.fiscalYear}</p>
                      </TableCell>
                      <TableCell>
                        {row.patientName ?? "Counter sale"}
                        {row.patientMrn ? (
                          <p className="font-mono text-muted-foreground">{row.patientMrn}</p>
                        ) : null}
                      </TableCell>
                      {moneyColumns.map(([key]) => (
                        <TableCell key={key} className="text-right whitespace-nowrap">
                          {formatMoney(row[key], currency)}
                          {key === "outstanding" && row.outstanding < ZERO ? (
                            <p className="text-muted-foreground">Refund due</p>
                          ) : null}
                        </TableCell>
                      ))}
                      <TableCell className="print:hidden">
                        {row.source?.type === "opd" && canReadOpd ? (
                          <Link
                            to="/$orgSlug/opd/$appointmentId"
                            params={{ orgSlug, appointmentId: row.source.id }}
                            className="text-brand underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
                          >
                            Visit
                          </Link>
                        ) : row.source?.type === "pharmacy" && canReadPharmacy ? (
                          <Link
                            to="/$orgSlug/pharmacy"
                            params={{ orgSlug }}
                            search={{ sale: row.source.id }}
                            className="text-brand underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
                          >
                            Sale
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">Unavailable</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={17}>No invoices match these dates and filters.</TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
            <div className="print:hidden">
              <LoadMore query={report} shown={rows.length} />
            </div>
          </section>
        </section>
      </PageBody>
      <style>{REPORT_PRINT_LANDSCAPE_CSS}</style>
    </>
  );
}
