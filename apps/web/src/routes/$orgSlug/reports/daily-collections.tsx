import { Button } from "@hms/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hms/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DownloadIcon, PrinterIcon } from "lucide-react";
import { z } from "zod";

import { ReportPeriodControls } from "@/components/report-period-controls";
import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { useMembership } from "@/lib/membership";
import { formatMoney } from "@/lib/money";
import { orpc } from "@/lib/orpc";
import { loadRouteQuery } from "@/lib/orpc-error";
import { downloadXlsx } from "@/lib/report-export";
import { REPORT_PRINT_LANDSCAPE_CSS } from "@/lib/report-presentation";
import { methodLabel } from "@/lib/settlement";
import { orgMonthToDate as defaultRange } from "@/lib/org-datetime";
import { requireOrgPermission } from "@/lib/route-permission";

const MAX_DAYS = 92;

export const Route = createFileRoute("/$orgSlug/reports/daily-collections")({
  head: () => ({ meta: [{ title: "Daily collections · HMS" }] }),
  validateSearch: z.object({
    from: z.iso.date().optional().catch(undefined),
    to: z.iso.date().optional().catch(undefined),
  }),
  loaderDeps: ({ search: { from, to } }) => ({ from, to }),
  loader: async ({ context: { queryClient }, params: { orgSlug }, deps }) => {
    const { timeZone } = await requireOrgPermission(
      queryClient,
      orgSlug,
      { report: ["readDailyCollections"] },
      "/$orgSlug/dashboard",
    );

    const fallback = defaultRange(timeZone);
    const range = { from: deps.from ?? fallback.from, to: deps.to ?? fallback.to };
    await loadRouteQuery(
      queryClient.query(
        orpc.report.dailyCollections.queryOptions({ input: { orgSlug, ...range } }),
      ),
    );

    return range;
  },
  component: DailyCollectionsRoute,
});

function DailyCollectionsRoute() {
  const { orgSlug } = Route.useParams();
  const navigate = Route.useNavigate();
  const { from, to } = Route.useLoaderData();
  const currency = useMembership(orgSlug, (membership) => membership.currency);

  const report = useQuery(
    orpc.report.dailyCollections.queryOptions({ input: { orgSlug, from, to } }),
  );

  const exportReport = () => {
    if (!report.data) return;
    const { rows, byMethod, totals } = report.data;
    void downloadXlsx(`daily-collections-${from}-to-${to}.xlsx`, [
      {
        name: "Daily collections",
        columns: [
          { header: "Business date", key: "businessDate", width: 16 },
          ...byMethod.map(({ method }) => ({
            header: methodLabel(method),
            key: method,
            width: 16,
          })),
          { header: "Payments", key: "payments", width: 16 },
          { header: "Advances", key: "advances", width: 16 },
          { header: "Refunds", key: "refunds", width: 16 },
          { header: "Advance refunds", key: "advanceRefunds", width: 18 },
          { header: "Net", key: "net", width: 16 },
        ],
        rows: rows.map((row) => ({
          businessDate: row.businessDate,
          ...Object.fromEntries(
            byMethod.map(({ method }) => [method, Number(row.byMethod[method])]),
          ),
          payments: Number(row.payments),
          advances: Number(row.advances),
          refunds: Number(row.refunds),
          advanceRefunds: Number(row.advanceRefunds),
          net: Number(row.net),
        })),
      },
      {
        name: "By method",
        columns: [
          { header: "Method", key: "method", width: 12 },
          { header: "Payments", key: "payments", width: 16 },
          { header: "Advances", key: "advances", width: 16 },
          { header: "Refunds", key: "refunds", width: 16 },
          { header: "Advance refunds", key: "advanceRefunds", width: 18 },
          { header: "Net", key: "net", width: 16 },
        ],
        rows: [
          ...byMethod.map((row) => ({
            method: methodLabel(row.method),
            payments: Number(row.payments),
            advances: Number(row.advances),
            refunds: Number(row.refunds),
            advanceRefunds: Number(row.advanceRefunds),
            net: Number(row.net),
          })),
          {
            method: "Total",
            payments: Number(totals.payments),
            advances: Number(totals.advances),
            refunds: Number(totals.refunds),
            advanceRefunds: Number(totals.advanceRefunds),
            net: Number(totals.net),
          },
        ],
      },
    ]);
  };

  return (
    <>
      <PageHeader
        title="Daily collections"
        description="Payments and advances, less refunds, by method and business date"
      />
      <PageBody>
        <ReportPeriodControls
          key={`${orgSlug}:${from}:${to}`}
          from={from}
          to={to}
          maxDays={MAX_DAYS}
          onApply={(range) => void navigate({ search: range, replace: true })}
        >
          <Button size="sm" variant="outline" disabled={!report.data} onClick={exportReport}>
            <DownloadIcon data-icon="inline-start" />
            Export Excel
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!report.data}
            onClick={() => window.print()}
          >
            <PrinterIcon data-icon="inline-start" />
            Print / PDF
          </Button>
        </ReportPeriodControls>

        {report.isPending ? null : report.isError ? (
          <ErrorNote title="Could not load daily collections" error={report.error} />
        ) : (
          <section data-report-print className="space-y-4">
            <header className="border-b pb-2">
              <h1 className="text-sm font-medium">Daily collections</h1>
              <p className="text-muted-foreground">
                {report.data.from} to {report.data.to}
              </p>
            </header>

            <div className="ring-1 ring-border">
              <Table className="min-w-3xl">
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    {report.data.byMethod.map(({ method }) => (
                      <TableHead key={method} className="text-right">
                        {methodLabel(method)}
                      </TableHead>
                    ))}
                    <TableHead className="text-right">Payments</TableHead>
                    <TableHead className="text-right">Advances</TableHead>
                    <TableHead className="text-right">Refunds</TableHead>
                    <TableHead className="text-right">Advance refunds</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.data.rows.map((day) => (
                    <TableRow key={day.businessDate}>
                      <TableCell className="whitespace-nowrap">{day.businessDate}</TableCell>
                      {report.data.byMethod.map(({ method }) => (
                        <TableCell key={method} className="text-right whitespace-nowrap">
                          {formatMoney(day.byMethod[method], currency)}
                        </TableCell>
                      ))}
                      <TableCell className="text-right whitespace-nowrap">
                        {formatMoney(day.payments, currency)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {formatMoney(day.advances, currency)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {formatMoney(day.refunds, currency)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {formatMoney(day.advanceRefunds, currency)}
                      </TableCell>
                      <TableCell className="text-right font-medium whitespace-nowrap">
                        {formatMoney(day.net, currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 font-semibold">
                    <TableCell>Total</TableCell>
                    {report.data.byMethod.map(({ method, net }) => (
                      <TableCell key={method} className="text-right whitespace-nowrap">
                        {formatMoney(net, currency)}
                      </TableCell>
                    ))}
                    <TableCell className="text-right whitespace-nowrap">
                      {formatMoney(report.data.totals.payments, currency)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {formatMoney(report.data.totals.advances, currency)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {formatMoney(report.data.totals.refunds, currency)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {formatMoney(report.data.totals.advanceRefunds, currency)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {formatMoney(report.data.totals.net, currency)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            <section className="max-w-xl space-y-2">
              <h2 className="font-medium uppercase tracking-wide">By method</h2>
              <div className="ring-1 ring-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right">Payments</TableHead>
                      <TableHead className="text-right">Advances</TableHead>
                      <TableHead className="text-right">Refunds</TableHead>
                      <TableHead className="text-right">Advance refunds</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.data.byMethod.map((row) => (
                      <TableRow key={row.method}>
                        <TableCell>{methodLabel(row.method)}</TableCell>
                        <TableCell className="text-right">
                          {formatMoney(row.payments, currency)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMoney(row.advances, currency)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMoney(row.refunds, currency)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMoney(row.advanceRefunds, currency)}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatMoney(row.net, currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          </section>
        )}
      </PageBody>
      <style>{REPORT_PRINT_LANDSCAPE_CSS}</style>
    </>
  );
}
