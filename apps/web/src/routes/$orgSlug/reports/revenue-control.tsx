import { NativeSelect } from "@hms/ui/components/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { useMutation, useSuspenseInfiniteQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";

import { AdvanceReceiptLink } from "@/components/advance-form";
import { DateFilter } from "@/components/list-filter";
import { ErrorNote, ListToolbar, LoadMore, PageBody, PageHeader } from "@/components/page";
import { ReportActions } from "@/components/report-actions";
import { appHead } from "@/config/site";
import { useCan, useMembership } from "@/lib/membership";
import { formatMoney } from "@/lib/money";
import { orgMonthToDate, useOrgDateTime } from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { loadRouteQuery } from "@/lib/orpc-error";
import { saveXlsx } from "@/lib/report-export";
import { REPORT_PRINT_LANDSCAPE_CSS } from "@/lib/report-presentation";
import { requireOrgPermission } from "@/lib/route-permission";
import { methodLabel } from "@/lib/settlement";

type SignalPage = Awaited<ReturnType<typeof orpc.report.revenueSignals.call>>;

type SignalKind = SignalPage["kind"];

const SIGNALS: Record<SignalKind, { label: string; note: string }> = {
  no_charge: {
    label: "Checked-in visits with no charge",
    note: "Free care is valid; review the visit, not a guessed fee.",
  },
  voided_charge: {
    label: "Voided charges",
    note: "Dated by last update; who voided it was not recorded.",
  },
  discount: {
    label: "Invoice discounts",
    note: "Already inside billed values; never subtract them again.",
  },
  credit_note: {
    label: "Credit notes",
    note: "Returns and corrections, including older invoices.",
  },
  below_mrp: {
    label: "Sales below MRP",
    note: "Pharmacy lines sold under the batch MRP.",
  },
  stock_adjustment: {
    label: "Stock adjustments and write-offs",
    note: "Valued at MRP, not cost.",
  },
  refund: {
    label: "Refunds",
    note: "Cash returned; revenue was already reduced by its credit note.",
  },
};

// SAFETY: the keys of `SIGNALS` are exactly `SignalKind`.
const signalKinds = Object.keys(SIGNALS) as [SignalKind, ...SignalKind[]];

type SignalCursor = { eventAt: string; id: string };

const signalsQuery = (orgSlug: string, from: string, to: string, kind: SignalKind) =>
  orpc.report.revenueSignals.infiniteOptions({
    input: (cursor: SignalCursor | undefined) => ({ orgSlug, from, to, kind, cursor, limit: 25 }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

const revenueColumns = [
  ["issuedTaxableValue", "Issued"],
  ["creditedTaxableValue", "Credited"],
  ["netTaxableValue", "Net billed"],
  ["tax", "Net GST"],
] as const;

const linkClass =
  "text-brand underline-offset-4 [@media(hover:hover)_and_(pointer:fine)]:hover:underline";

export const Route = createFileRoute("/$orgSlug/reports/revenue-control")({
  head: () => appHead("Revenue control"),
  validateSearch: z.object({
    from: z.iso.date().optional().catch(undefined),
    to: z.iso.date().optional().catch(undefined),
    kind: z.enum(signalKinds).optional().catch(undefined),
    horizonDays: z
      .union([z.literal(30), z.literal(90)])
      .optional()
      .catch(undefined),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ context: { queryClient }, params: { orgSlug }, deps }) => {
    const { timeZone } = await requireOrgPermission(
      queryClient,
      orgSlug,
      { report: ["readFinancial"] },
      "/$orgSlug/dashboard",
    );

    const fallback = orgMonthToDate(timeZone);

    const filters = {
      from: deps.from ?? fallback.from,
      to: deps.to ?? fallback.to,
      kind: deps.kind ?? "no_charge",
      horizonDays: deps.horizonDays ?? 30,
    } as const;

    // Static while the page is open: a filter change re-runs this loader, and it should not
    // block on refetching the sections whose inputs did not change.
    await Promise.all([
      loadRouteQuery(
        queryClient.query({
          ...orpc.report.revenueBreakdown.queryOptions({
            input: { orgSlug, from: filters.from, to: filters.to },
          }),
          staleTime: "static",
        }),
      ),
      loadRouteQuery(
        queryClient.query({
          ...orpc.report.expiryExposure.queryOptions({
            input: { orgSlug, horizonDays: filters.horizonDays },
          }),
          staleTime: "static",
        }),
      ),
      loadRouteQuery(
        queryClient.infiniteQuery({
          ...signalsQuery(orgSlug, filters.from, filters.to, filters.kind),
          staleTime: "static",
        }),
      ),
    ]);

    return filters;
  },
  component: RevenueControlRoute,
});

function RevenueControlRoute() {
  const { orgSlug } = Route.useParams();
  const filters = Route.useLoaderData();
  const navigate = Route.useNavigate();
  const { today } = useOrgDateTime();
  const currency = useMembership(orgSlug, (membership) => membership.currency);
  const period = { orgSlug, from: filters.from, to: filters.to };
  const revenue = useSuspenseQuery(orpc.report.revenueBreakdown.queryOptions({ input: period }));

  const expiry = useSuspenseQuery(
    orpc.report.expiryExposure.queryOptions({
      input: { orgSlug, horizonDays: filters.horizonDays },
    }),
  );

  const download = useMutation({
    ...orpc.export.revenueControlXlsx.mutationOptions(),
    ...saveXlsx,
  });

  const patchSearch = (patch: Partial<typeof filters>) =>
    navigate({ replace: true, search: (previous) => ({ ...previous, ...patch }) });

  return (
    <>
      <PageHeader title="Revenue control" />
      <PageBody>
        <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
          <ListToolbar>
            <DateFilter
              today={today}
              from={filters.from}
              to={filters.to}
              maxDays={92}
              onChange={patchSearch}
            />
          </ListToolbar>
          <ReportActions
            disabled={revenue.isFetching || expiry.isFetching || download.isPending}
            onExport={() => download.mutate({ ...period, horizonDays: filters.horizonDays })}
          />
        </div>
        <section data-report-print className="flex flex-col gap-4">
          <header className="flex flex-col gap-1 border-b pb-2">
            <h1 className="text-sm font-medium">Revenue control · OPD and pharmacy</h1>
            <p className="text-muted-foreground">
              {filters.from} to {filters.to}. Billed revenue excludes GST; refunds affect cash, not
              revenue.
            </p>
          </header>
          <section className="flex flex-col gap-3" aria-label="Net billed revenue">
            <h2 className="text-sm font-medium">Net billed revenue</h2>
            <dl className="grid grid-cols-2 gap-3 border-y py-3 sm:grid-cols-5">
              {revenueColumns.map(([key, label]) => (
                <div key={key}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-medium tabular-nums">
                    {formatMoney(revenue.data.totals[key], currency)}
                  </dd>
                </div>
              ))}
              <div>
                <dt className="text-muted-foreground">Round-off</dt>
                <dd className="font-medium tabular-nums">
                  {formatMoney(revenue.data.totals.roundOff, currency)}
                </dd>
              </div>
            </dl>
            <RevenueTable title="By stream" rows={revenue.data.byStream} currency={currency} />
            <RevenueTable
              title="By practitioner (pharmacy follows its linked visit)"
              rows={revenue.data.byPractitioner}
              currency={currency}
            />
            <RevenueTable title="By category" rows={revenue.data.byCategory} currency={currency} />
            <section className="flex flex-col gap-2 border-y py-3">
              <h3 className="font-medium">Why the invoice register differs</h3>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">Register net line value</dt>
                  <dd className="tabular-nums">
                    {formatMoney(revenue.data.bridge.registerNetTaxableValue, currency)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Less credits to older invoices</dt>
                  <dd className="tabular-nums">
                    {formatMoney(revenue.data.bridge.creditsToOlderInvoices, currency)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Plus later credits on these invoices</dt>
                  <dd className="tabular-nums">
                    {formatMoney(revenue.data.bridge.laterCreditsAgainstPeriodInvoices, currency)}
                  </dd>
                </div>
              </dl>
            </section>
          </section>
          <section className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium">Expiry exposure now, at MRP</h2>
              <label className="flex items-center gap-2 print:hidden">
                Within
                <NativeSelect
                  aria-label="Expiry horizon"
                  value={filters.horizonDays}
                  onChange={(event) =>
                    patchSearch({ horizonDays: event.target.value === "90" ? 90 : 30 })
                  }
                >
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                </NativeSelect>
              </label>
            </div>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(["shelf", "quarantine", "expired", "upcoming"] as const).map((key) => (
                <div key={key}>
                  <dt className="text-muted-foreground capitalize">{key}</dt>
                  <dd className="font-medium tabular-nums">
                    {formatMoney(expiry.data.totals[key], currency)}
                  </dd>
                </div>
              ))}
            </dl>
            {expiry.data.noExpiryBatchCount > 0 ? (
              <p className="text-muted-foreground">
                {expiry.data.noExpiryBatchCount} stocked batches have no expiry date.
              </p>
            ) : null}
            <div className="print:hidden">
              <ExpiryRows orgSlug={orgSlug} rows={expiry.data.rows} currency={currency} />
            </div>
          </section>
        </section>
        <div className="print:hidden">
          <SignalReview
            orgSlug={orgSlug}
            from={filters.from}
            to={filters.to}
            kind={filters.kind}
            currency={currency}
            onKindChange={(kind) => patchSearch({ kind })}
          />
        </div>
      </PageBody>
      <style>{REPORT_PRINT_LANDSCAPE_CSS}</style>
    </>
  );
}

type RevenueBucket = Awaited<
  ReturnType<typeof orpc.report.revenueBreakdown.call>
>["byStream"][number];

function RevenueTable({
  title,
  rows,
  currency,
}: {
  title: string;
  rows: RevenueBucket[];
  currency: string;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium">{title}</h3>
      <Table className="min-w-xl print:min-w-0">
        <caption className="sr-only">{title}</caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Group</TableHead>
            {revenueColumns.map(([key, label]) => (
              <TableHead scope="col" key={key} className="text-right">
                {label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id ?? "unassigned"}>
              <TableCell>{row.label}</TableCell>
              {revenueColumns.map(([key]) => (
                <TableCell key={key} className="text-right whitespace-nowrap">
                  {formatMoney(row[key], currency)}
                </TableCell>
              ))}
            </TableRow>
          ))}
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5}>No billing in this period.</TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </section>
  );
}

function SignalReview({
  orgSlug,
  from,
  to,
  kind,
  currency,
  onKindChange,
}: {
  orgSlug: string;
  from: string;
  to: string;
  kind: SignalKind;
  currency: string;
  onKindChange: (kind: SignalKind) => void;
}) {
  const report = useSuspenseInfiniteQuery(signalsQuery(orgSlug, from, to, kind));
  const summary = report.data.pages[0]?.summary;
  const rows = report.data.pages.flatMap((page) => page.rows);
  const canReadBilling = useCan(orgSlug, { billing: ["read"] });
  const canReadOpd = useCan(orgSlug, { opd: ["read"] });
  const canReadPharmacy = useCan(orgSlug, { pharmacy: ["read"] });

  return (
    <section className="flex flex-col gap-3" aria-label="Review signals">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">Review</h2>
        <NativeSelect
          aria-label="Review signal kind"
          className="w-auto"
          value={kind}
          onChange={(event) => onKindChange(z.enum(signalKinds).parse(event.target.value))}
        >
          {signalKinds.map((value) => (
            <option key={value} value={value}>
              {SIGNALS[value].label}
            </option>
          ))}
        </NativeSelect>
        {summary ? (
          <span className="font-medium tabular-nums">
            {summary.count} records
            {summary.amount === null ? null : ` · ${formatMoney(summary.amount, currency)}`}
          </span>
        ) : null}
      </div>
      <p className="text-muted-foreground">
        {SIGNALS[kind].note} A signal asks for a look, not an accusation.
      </p>
      {report.isRefetchError ? (
        <ErrorNote title="Could not refresh; these rows may be stale" error={report.error} />
      ) : null}
      {summary && summary.groups.length > 0 ? (
        <Table>
          <caption className="sr-only">By who issued it and the reason given</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Issued by</TableHead>
              <TableHead scope="col">Reason</TableHead>
              <TableHead scope="col" className="text-right">
                Documents
              </TableHead>
              <TableHead scope="col" className="text-right">
                Amount
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.groups.map((group) => (
              <TableRow key={JSON.stringify([group.actorId, group.reason])}>
                <TableCell>{group.actorName ?? "Not recorded"}</TableCell>
                <TableCell className="whitespace-normal">
                  {group.reason ?? "Not recorded"}
                </TableCell>
                <TableCell className="text-right">{group.count}</TableCell>
                <TableCell className="text-right">{formatMoney(group.amount, currency)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      <div className="ring-1 ring-border">
        <Table className="min-w-3xl">
          <caption className="sr-only">{SIGNALS[kind].label}</caption>
          <TableHeader>
            <TableRow>
              {["Date", "Record", "Amount", "Reason", "Recorded by", "Details", "Open"].map(
                (label) => (
                  <TableHead scope="col" key={label}>
                    {label}
                  </TableHead>
                ),
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap">{row.eventDate}</TableCell>
                <TableCell>{row.label}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {row.amount === null ? "—" : formatMoney(row.amount, currency)}
                </TableCell>
                <TableCell className="max-w-64 whitespace-normal">
                  {row.reason ?? "Not recorded"}
                </TableCell>
                <TableCell>{row.actorName ?? row.creatorName ?? "Not recorded"}</TableCell>
                <TableCell className="whitespace-normal text-muted-foreground">
                  {[
                    row.method ? methodLabel(row.method) : row.classification?.replaceAll("_", " "),
                    row.quantity === null ? null : `Qty ${row.quantity}`,
                    row.bucket,
                    row.lineSubtotal === null || row.discountAmount === null
                      ? null
                      : `${formatMoney(row.lineSubtotal, currency)} less ${formatMoney(row.discountAmount, currency)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </TableCell>
                <TableCell>
                  {kind === "credit_note" && row.invoiceId && canReadBilling ? (
                    <Link
                      to="/$orgSlug/billing/invoices/$invoiceId/credit-note/$creditNoteId"
                      params={{ orgSlug, invoiceId: row.invoiceId, creditNoteId: row.id }}
                      className={linkClass}
                    >
                      Credit note
                    </Link>
                  ) : kind === "refund" && row.source?.type === "advance" && canReadBilling ? (
                    <AdvanceReceiptLink
                      orgSlug={orgSlug}
                      id={row.source.id}
                      refundId={row.id}
                      label="Refund voucher"
                    />
                  ) : kind === "refund" && row.invoiceId && canReadBilling ? (
                    <Link
                      to="/$orgSlug/billing/invoices/$invoiceId/refund/$refundId"
                      params={{ orgSlug, invoiceId: row.invoiceId, refundId: row.id }}
                      className={linkClass}
                    >
                      Refund voucher
                    </Link>
                  ) : row.invoiceId && canReadBilling ? (
                    <Link
                      to="/$orgSlug/billing/invoices/$invoiceId"
                      params={{ orgSlug, invoiceId: row.invoiceId }}
                      className={linkClass}
                    >
                      Invoice
                    </Link>
                  ) : row.source?.type === "opd" && canReadOpd ? (
                    <Link
                      to="/$orgSlug/opd/$appointmentId"
                      params={{ orgSlug, appointmentId: row.source.id }}
                      className={linkClass}
                    >
                      Visit
                    </Link>
                  ) : row.source?.type === "pharmacy" && canReadPharmacy ? (
                    <Link
                      to="/$orgSlug/pharmacy"
                      params={{ orgSlug }}
                      search={{ sale: row.source.id }}
                      className={linkClass}
                    >
                      Sale
                    </Link>
                  ) : row.source?.type === "stock" && canReadPharmacy ? (
                    <Link
                      to="/$orgSlug/pharmacy/movements"
                      params={{ orgSlug }}
                      search={{ batchId: row.source.id }}
                      className={linkClass}
                    >
                      Movements
                    </Link>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>Nothing to review in this period.</TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
      <LoadMore query={report} shown={rows.length} />
    </section>
  );
}

function ExpiryRows({
  orgSlug,
  rows,
  currency,
}: {
  orgSlug: string;
  rows: Awaited<ReturnType<typeof orpc.report.expiryExposure.call>>["rows"];
  currency: string;
}) {
  const canReadPharmacy = useCan(orgSlug, { pharmacy: ["read"] });

  return (
    <Table className="min-w-3xl">
      <caption className="sr-only">Expired and soon-expiring batches</caption>
      <TableHeader>
        <TableRow>
          {["Product", "Batch", "Expiry", "Status", "Bucket", "Quantity", "MRP exposure"].map(
            (label) => (
              <TableHead scope="col" key={label}>
                {label}
              </TableHead>
            ),
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={`${row.batchId}-${row.bucket}`}>
            <TableCell>
              {canReadPharmacy ? (
                <Link
                  to="/$orgSlug/pharmacy/movements"
                  params={{ orgSlug }}
                  search={{ batchId: row.batchId }}
                  className={linkClass}
                >
                  {row.productName}
                </Link>
              ) : (
                row.productName
              )}
            </TableCell>
            <TableCell className="font-mono">{row.batchNumber}</TableCell>
            <TableCell>{row.expiryDate}</TableCell>
            <TableCell className="capitalize">{row.status}</TableCell>
            <TableCell className="capitalize">{row.bucket}</TableCell>
            <TableCell>{row.quantity}</TableCell>
            <TableCell className="whitespace-nowrap">
              {formatMoney(row.exposure, currency)}
            </TableCell>
          </TableRow>
        ))}
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={7}>No expired or soon-expiring stock.</TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}
