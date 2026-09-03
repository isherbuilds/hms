import { fromPaise, toSignedPaise } from "@hms/api/lib/invoice-math";
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
import { orgMonthToDate as defaultRange } from "@/lib/org-datetime";
import { requireOrgPermission } from "@/lib/route-permission";

const MAX_DAYS = 92;
const METHODS = ["cash", "upi", "card"] as const;
type Method = (typeof METHODS)[number];

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
      { report: ["read"] },
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
          { header: "Method", key: "method", width: 12 },
          { header: "Payments", key: "payments", width: 16 },
          { header: "Refunds", key: "refunds", width: 16 },
          { header: "Net", key: "net", width: 16 },
        ],
        rows: rows.map((row) => ({
          businessDate: row.businessDate,
          method: row.method,
          payments: Number(row.payments),
          refunds: Number(row.refunds),
          net: Number(row.net),
        })),
      },
      {
        name: "By method",
        columns: [
          { header: "Method", key: "method", width: 12 },
          { header: "Payments", key: "payments", width: 16 },
          { header: "Refunds", key: "refunds", width: 16 },
          { header: "Net", key: "net", width: 16 },
        ],
        rows: [
          ...byMethod.map((row) => ({
            method: row.method,
            payments: Number(row.payments),
            refunds: Number(row.refunds),
            net: Number(row.net),
          })),
          {
            method: "Total",
            payments: Number(totals.payments),
            refunds: Number(totals.refunds),
            net: Number(totals.net),
          },
        ],
      },
    ]);
  };

  const methodTotals: Record<Method, string> = { cash: "0.00", upi: "0.00", card: "0.00" };
  for (const row of report.data?.byMethod ?? []) methodTotals[row.method] = row.net;

  const daily = new Map<
    string,
    {
      byMethod: Record<Method, string>;
      payments: number;
      refunds: number;
      net: number;
    }
  >();
  for (const row of report.data?.rows ?? []) {
    let day = daily.get(row.businessDate);
    if (!day) {
      day = {
        byMethod: { cash: "0.00", upi: "0.00", card: "0.00" },
        payments: 0,
        refunds: 0,
        net: 0,
      };
      daily.set(row.businessDate, day);
    }
    day.byMethod[row.method] = row.net;
    day.payments += toSignedPaise(row.payments);
    day.refunds += toSignedPaise(row.refunds);
    day.net += toSignedPaise(row.net);
  }

  return (
    <>
      <PageHeader
        title="Daily collections"
        description="Payments minus refunds by method and business date"
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

            <div className="overflow-hidden ring-1 ring-border">
              <Table className="table-fixed text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[4.25rem] px-1">Date</TableHead>
                    <TableHead className="px-1 text-right text-[0.625rem] leading-tight tracking-normal whitespace-normal [overflow-wrap:anywhere]">
                      Cash
                    </TableHead>
                    <TableHead className="px-1 text-right text-[0.625rem] leading-tight tracking-normal whitespace-normal [overflow-wrap:anywhere]">
                      UPI
                    </TableHead>
                    <TableHead className="px-1 text-right text-[0.625rem] leading-tight tracking-normal whitespace-normal [overflow-wrap:anywhere]">
                      Card
                    </TableHead>
                    <TableHead className="px-1 text-right text-[0.625rem] leading-tight tracking-normal whitespace-normal [overflow-wrap:anywhere]">
                      Payments
                    </TableHead>
                    <TableHead className="px-1 text-right text-[0.625rem] leading-tight tracking-normal whitespace-normal [overflow-wrap:anywhere]">
                      Refunds
                    </TableHead>
                    <TableHead className="px-1 text-right text-[0.625rem] leading-tight tracking-normal whitespace-normal [overflow-wrap:anywhere]">
                      Net
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...daily].map(([businessDate, day]) => (
                    <TableRow key={businessDate}>
                      <TableCell className="px-1 text-[0.6875rem] whitespace-nowrap">
                        {businessDate}
                      </TableCell>
                      {METHODS.map((method) => (
                        <TableCell
                          key={method}
                          className="px-1 text-right leading-tight [overflow-wrap:anywhere]"
                        >
                          {formatMoney(day.byMethod[method], currency)}
                        </TableCell>
                      ))}
                      <TableCell className="px-1 text-right leading-tight [overflow-wrap:anywhere]">
                        {formatMoney(fromPaise(day.payments), currency)}
                      </TableCell>
                      <TableCell className="px-1 text-right leading-tight [overflow-wrap:anywhere]">
                        {formatMoney(fromPaise(day.refunds), currency)}
                      </TableCell>
                      <TableCell className="px-1 text-right leading-tight font-medium [overflow-wrap:anywhere]">
                        {formatMoney(fromPaise(day.net), currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 font-semibold">
                    <TableCell className="px-1">Total</TableCell>
                    {METHODS.map((method) => (
                      <TableCell
                        key={method}
                        className="px-1 text-right leading-tight [overflow-wrap:anywhere]"
                      >
                        {formatMoney(methodTotals[method], currency)}
                      </TableCell>
                    ))}
                    <TableCell className="px-1 text-right leading-tight [overflow-wrap:anywhere]">
                      {formatMoney(report.data.totals.payments, currency)}
                    </TableCell>
                    <TableCell className="px-1 text-right leading-tight [overflow-wrap:anywhere]">
                      {formatMoney(report.data.totals.refunds, currency)}
                    </TableCell>
                    <TableCell className="px-1 text-right leading-tight [overflow-wrap:anywhere]">
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
                      <TableHead className="text-right">Refunds</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.data.byMethod.map((row) => (
                      <TableRow key={row.method}>
                        <TableCell className="uppercase">{row.method}</TableCell>
                        <TableCell className="text-right">
                          {formatMoney(row.payments, currency)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMoney(row.refunds, currency)}
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
