import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { useMutation, useSuspenseInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { appHead } from "@/config/site";
import { DateFilter } from "@/components/list-filter";
import { ErrorNote, ListToolbar, LoadMore, PageBody, PageHeader } from "@/components/page";
import { ReportActions } from "@/components/report-actions";
import { useMembership } from "@/lib/membership";
import { orpc } from "@/lib/orpc";
import { loadRouteQuery } from "@/lib/orpc-error";
import { saveXlsx } from "@/lib/report-export";
import { formatMoney } from "@/lib/money";
import { REPORT_PRINT_LANDSCAPE_CSS } from "@/lib/report-presentation";
import { orgMonthToDate as defaultRange, useOrgDateTime } from "@/lib/org-datetime";
import { requireOrgPermission } from "@/lib/route-permission";

type GstCursor = { date: string; number: string; id: string };

const gstQuery = (orgSlug: string, range: { from: string; to: string }) =>
  orpc.report.gst.infiniteOptions({
    input: (cursor: GstCursor | undefined) => ({ orgSlug, ...range, cursor }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export const Route = createFileRoute("/$orgSlug/reports/gst")({
  head: () => appHead("GST register"),
  validateSearch: z.object({
    from: z.iso.date().optional().catch(undefined),
    to: z.iso.date().optional().catch(undefined),
  }),
  loaderDeps: ({ search: { from, to } }) => ({ from, to }),
  loader: async ({ context: { queryClient }, params: { orgSlug }, deps }) => {
    const { timeZone } = await requireOrgPermission(
      queryClient,
      orgSlug,
      { report: ["readFinancial"] },
      "/$orgSlug/dashboard",
    );

    const fallback = defaultRange(timeZone);
    const range = { from: deps.from ?? fallback.from, to: deps.to ?? fallback.to };
    await loadRouteQuery(queryClient.infiniteQuery(gstQuery(orgSlug, range)));

    return range;
  },
  component: GstReportRoute,
});

function GstReportRoute() {
  const { orgSlug } = Route.useParams();
  const navigate = Route.useNavigate();
  const { from, to } = Route.useLoaderData();
  const { today } = useOrgDateTime();

  // Reports always read a period, so clearing the preset falls back to the route default.
  const setRange = (range: { from?: string; to?: string }) =>
    navigate({ search: range, replace: true });

  const currency = useMembership(orgSlug, (membership) => membership.currency);
  const report = useSuspenseInfiniteQuery(gstQuery(orgSlug, { from, to }));
  const summary = report.data.pages[0]?.summary;
  const documents = report.data.pages.flatMap((page) => page.documents);

  const download = useMutation({ ...orpc.export.gstOutwardXlsx.mutationOptions(), ...saveXlsx });

  return (
    <>
      <PageHeader
        title="GST register"
        action={
          <ReportActions
            disabled={report.isFetching || download.isPending}
            onExport={() => download.mutate({ orgSlug, from, to })}
          />
        }
      />
      <PageBody>
        <div className="print:hidden">
          <ListToolbar>
            <DateFilter today={today} from={from} to={to} maxDays={366} onChange={setRange} />
          </ListToolbar>
        </div>

        {report.isRefetchError ? (
          <ErrorNote title="Could not refresh the GST outward register" error={report.error} />
        ) : null}
        <section data-report-print className="flex flex-col gap-4">
          <header className="border-b pb-2">
            <h1 className="text-sm font-medium">GST outward register</h1>
            <p className="text-muted-foreground">
              {from} to {to} · CGST/SGST split assumes intra-state supply. Excel has every document;
              print has the loaded rows.
            </p>
          </header>

          <section className="flex flex-col gap-2">
            <h2 className="min-h-6 text-muted-foreground">Documents</h2>
            <div className="ring-1 ring-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Number</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Patient</TableHead>
                    <TableHead>MRN</TableHead>
                    <TableHead className="text-right">Taxable</TableHead>
                    <TableHead className="text-right">CGST</TableHead>
                    <TableHead className="text-right">SGST</TableHead>
                    <TableHead className="text-right">Tax</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.map((row) => (
                    <TableRow key={`${row.docType}-${row.id}`}>
                      <TableCell className="capitalize">{row.docType.replace("_", " ")}</TableCell>
                      <TableCell className="font-mono font-medium">{row.number}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{row.date}</TableCell>
                      <TableCell className="capitalize">{row.patientName}</TableCell>
                      <TableCell className="font-mono">{row.patientMrn}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(row.taxableValue, currency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(row.cgst, currency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(row.sgst, currency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(row.taxAmount, currency)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatMoney(row.gross, currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {summary ? (
                    <TableRow className="border-t-2 font-semibold">
                      <TableCell colSpan={5}>Period total</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(summary.totals.taxableValue, currency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(summary.totals.cgst, currency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(summary.totals.sgst, currency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(summary.totals.taxAmount, currency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(summary.totals.gross, currency)}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
            <div className="print:hidden">
              <LoadMore query={report} shown={documents.length} />
            </div>
          </section>

          {summary ? (
            <div className="grid gap-3 lg:grid-cols-2">
              <section className="flex flex-col gap-2">
                <h2 className="min-h-6 text-muted-foreground">Rate summary</h2>
                <div className="ring-1 ring-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Rate</TableHead>
                        <TableHead className="text-right">Taxable</TableHead>
                        <TableHead className="text-right">CGST</TableHead>
                        <TableHead className="text-right">SGST</TableHead>
                        <TableHead className="text-right">Tax</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {summary.rateSummary.map((row) => (
                        <TableRow key={row.taxRatePercent}>
                          <TableCell className="font-medium tabular-nums">
                            {row.taxRatePercent}%
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(row.taxableValue, currency)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(row.cgst, currency)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(row.sgst, currency)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(row.taxAmount, currency)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="border-t-2 font-semibold">
                        <TableCell>Total</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(summary.totals.taxableValue, currency)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(summary.totals.cgst, currency)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(summary.totals.sgst, currency)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(summary.totals.taxAmount, currency)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </section>

              <section className="flex flex-col gap-2">
                <h2 className="min-h-6 text-muted-foreground">HSN/SAC summary</h2>
                <div className="ring-1 ring-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>HSN/SAC</TableHead>
                        <TableHead>Rate</TableHead>
                        <TableHead className="text-right">Taxable</TableHead>
                        <TableHead className="text-right">Tax</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {summary.hsnSummary.map((row) => (
                        <TableRow key={`${row.taxCode}-${row.taxRatePercent}`}>
                          <TableCell className="font-mono font-medium">
                            {row.taxCode || "—"}
                          </TableCell>
                          <TableCell className="tabular-nums">{row.taxRatePercent}%</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(row.taxableValue, currency)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(row.taxAmount, currency)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="border-t-2 font-semibold">
                        <TableCell colSpan={2}>Total</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(summary.totals.taxableValue, currency)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(summary.totals.taxAmount, currency)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </section>
            </div>
          ) : null}
        </section>
      </PageBody>
      <style>{REPORT_PRINT_LANDSCAPE_CSS}</style>
    </>
  );
}
