import { Button } from "@hms/ui/components/button";
import { Input } from "@hms/ui/components/input";
import { Skeleton } from "@hms/ui/components/skeleton";
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
import { useState } from "react";

import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { orpc } from "@/lib/orpc";
import { downloadXlsx } from "@/lib/report-export";
import {
  REPORT_PRINT_LANDSCAPE_CSS,
  formatReportMoney as formatMoney,
  reportDefaultRange as defaultRange,
} from "@/lib/report-presentation";

export const Route = createFileRoute("/org/$orgSlug/reports/trial-balance")({
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    const { timeZone } = await queryClient.ensureQueryData(
      orpc.settings.get.queryOptions({ input: { orgSlug } }),
    );
    const range = defaultRange(timeZone);
    void queryClient.prefetchQuery(
      orpc.report.trialBalance.queryOptions({ input: { orgSlug, ...range } }),
    );
    return range;
  },
  component: TrialBalanceRoute,
});

function TrialBalanceRoute() {
  const { orgSlug } = Route.useParams();
  const defaults = Route.useLoaderData();
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const queryOptions = orpc.report.trialBalance.queryOptions({ input: { orgSlug, from, to } });
  const report = useQuery({ ...queryOptions, enabled: Boolean(from && to) });

  const exportReport = () => {
    if (!report.data) return;
    const { rows, totals } = report.data;
    void downloadXlsx(`trial-balance-${from}-to-${to}.xlsx`, [
      {
        name: "Trial balance",
        columns: [
          { header: "Code", key: "code", width: 14 },
          { header: "Account", key: "name", width: 32 },
          { header: "Type", key: "type", width: 14 },
          { header: "Opening debit", key: "openingDebit", width: 16 },
          { header: "Opening credit", key: "openingCredit", width: 16 },
          { header: "Debit", key: "debit", width: 16 },
          { header: "Credit", key: "credit", width: 16 },
          { header: "Closing debit", key: "closingDebit", width: 16 },
          { header: "Closing credit", key: "closingCredit", width: 16 },
        ],
        rows: [
          ...rows.map((row) => ({
            code: row.code,
            name: row.name,
            type: row.type,
            openingDebit: Number(row.openingDebit),
            openingCredit: Number(row.openingCredit),
            debit: Number(row.debit),
            credit: Number(row.credit),
            closingDebit: Number(row.closingDebit),
            closingCredit: Number(row.closingCredit),
          })),
          {
            code: "",
            name: "Total",
            type: "",
            openingDebit: Number(totals.openingDebit),
            openingCredit: Number(totals.openingCredit),
            debit: Number(totals.debit),
            credit: Number(totals.credit),
            closingDebit: Number(totals.closingDebit),
            closingCredit: Number(totals.closingCredit),
          },
        ],
      },
    ]);
  };

  return (
    <>
      <PageHeader title="Trial balance" description="Account movement for a selected period" />
      <PageBody>
        <div className="flex flex-wrap items-end gap-2 print:hidden">
          <label className="grid gap-1">
            <span className="text-muted-foreground">From</span>
            <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label className="grid gap-1">
            <span className="text-muted-foreground">To</span>
            <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
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
        </div>

        {report.isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : report.isError ? (
          <ErrorNote title="Could not load the trial balance" detail={report.error.message} />
        ) : (
          <section data-report-print className="space-y-3">
            <header className="border-b pb-2">
              <h1 className="text-sm font-semibold">Trial balance</h1>
              <p className="text-muted-foreground">
                {report.data.from} to {report.data.to}
              </p>
            </header>
            <div className="overflow-x-auto ring-1 ring-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Opening debit</TableHead>
                    <TableHead className="text-right">Opening credit</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead className="text-right">Closing debit</TableHead>
                    <TableHead className="text-right">Closing credit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.data.rows.map((row) => (
                    <TableRow key={row.accountId}>
                      <TableCell className="font-medium tabular-nums">{row.code}</TableCell>
                      <TableCell>{row.name}</TableCell>
                      <TableCell className="capitalize text-muted-foreground">{row.type}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(row.openingDebit)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(row.openingCredit)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(row.debit)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(row.credit)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatMoney(row.closingDebit)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatMoney(row.closingCredit)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 font-semibold">
                    <TableCell colSpan={3}>Total</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(report.data.totals.openingDebit)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(report.data.totals.openingCredit)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(report.data.totals.debit)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(report.data.totals.credit)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(report.data.totals.closingDebit)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(report.data.totals.closingCredit)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </section>
        )}
      </PageBody>
      <style>{REPORT_PRINT_LANDSCAPE_CSS}</style>
    </>
  );
}
