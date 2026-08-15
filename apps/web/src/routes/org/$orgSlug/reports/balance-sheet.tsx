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
  REPORT_PRINT_PORTRAIT_CSS,
  formatReportMoney as formatMoney,
  reportToday as today,
} from "@/lib/report-presentation";

export const Route = createFileRoute("/org/$orgSlug/reports/balance-sheet")({
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    const { timeZone } = await queryClient.ensureQueryData(
      orpc.settings.get.queryOptions({ input: { orgSlug } }),
    );
    const asOf = today(timeZone);
    void queryClient.prefetchQuery(
      orpc.report.balanceSheet.queryOptions({ input: { orgSlug, asOf } }),
    );
    return { asOf };
  },
  component: BalanceSheetRoute,
});

function BalanceSheetRoute() {
  const { orgSlug } = Route.useParams();
  const defaults = Route.useLoaderData();
  const [asOf, setAsOf] = useState(defaults.asOf);
  const queryOptions = orpc.report.balanceSheet.queryOptions({ input: { orgSlug, asOf } });
  const report = useQuery({ ...queryOptions, enabled: Boolean(asOf) });
  const mismatched = report.data
    ? Math.round(Number(report.data.totals.assets) * 100) !==
      Math.round(Number(report.data.totals.liabilitiesAndEquity) * 100)
    : false;

  const exportReport = () => {
    if (!report.data) return;
    const { assets, liabilities, equity, totals } = report.data;
    void downloadXlsx(`billing-ledger-balance-sheet-${asOf}.xlsx`, [
      {
        name: "Assets",
        columns: [
          { header: "Code", key: "code", width: 14 },
          { header: "Account", key: "name", width: 34 },
          { header: "Balance", key: "balance", width: 18 },
        ],
        rows: [
          ...assets.map((row) => ({
            code: row.code,
            name: row.name,
            balance: Number(row.balance),
          })),
          { code: "", name: "Total assets", balance: Number(totals.assets) },
        ],
      },
      {
        name: "Liabilities and equity",
        columns: [
          { header: "Section", key: "section", width: 16 },
          { header: "Code", key: "code", width: 14 },
          { header: "Account", key: "name", width: 34 },
          { header: "Balance", key: "balance", width: 18 },
        ],
        rows: [
          ...liabilities.map((row) => ({
            section: "Liability",
            code: row.code,
            name: row.name,
            balance: Number(row.balance),
          })),
          ...equity.map((row) => ({
            section: "Equity",
            code: row.code,
            name: row.name,
            balance: Number(row.balance),
          })),
          {
            section: "",
            code: "",
            name: "Total liabilities and equity",
            balance: Number(totals.liabilitiesAndEquity),
          },
        ],
      },
    ]);
  };

  return (
    <>
      <PageHeader
        title="Billing ledger balance sheet"
        description="Financial position from transactions recorded in this HMS"
      />
      <PageBody>
        <div className="flex flex-wrap items-end gap-2 print:hidden">
          <label className="grid gap-1">
            <span className="text-muted-foreground">As of</span>
            <Input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} />
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
          <ErrorNote
            title="Could not load the billing ledger balance sheet"
            detail={report.error.message}
          />
        ) : (
          <section data-report-print className="space-y-3">
            <header className="border-b pb-2">
              <h1 className="text-sm font-semibold">Billing ledger balance sheet</h1>
              <p className="text-muted-foreground">
                As of {report.data.asOf} · HMS-posted billing activity only; opening balances and
                final accounts remain in the accountant's books.
              </p>
            </header>

            {mismatched ? (
              <div
                role="alert"
                className="border-2 border-destructive bg-destructive/10 p-3 font-semibold text-destructive"
              >
                Billing ledger mismatch: assets {formatMoney(report.data.totals.assets)} do not
                equal liabilities and equity {formatMoney(report.data.totals.liabilitiesAndEquity)}.
              </div>
            ) : null}

            <div className="grid gap-3 lg:grid-cols-2">
              <section className="space-y-1.5">
                <h2 className="font-semibold uppercase tracking-wide">Assets</h2>
                <div className="overflow-x-auto ring-1 ring-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Account</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.data.assets.map((row) => (
                        <TableRow key={row.code}>
                          <TableCell className="font-medium tabular-nums">{row.code}</TableCell>
                          <TableCell>{row.name}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(row.balance)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="border-t-2 font-semibold">
                        <TableCell colSpan={2}>Total assets</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(report.data.totals.assets)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </section>

              <section className="space-y-1.5">
                <h2 className="font-semibold uppercase tracking-wide">Liabilities and equity</h2>
                <div className="overflow-x-auto ring-1 ring-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Account</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.data.liabilities.map((row) => (
                        <TableRow key={`liability-${row.code}`}>
                          <TableCell className="font-medium tabular-nums">{row.code}</TableCell>
                          <TableCell>{row.name}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(row.balance)}
                          </TableCell>
                        </TableRow>
                      ))}
                      {report.data.equity.map((row) => (
                        <TableRow key={`equity-${row.code}`}>
                          <TableCell className="font-medium tabular-nums">{row.code}</TableCell>
                          <TableCell>{row.name}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(row.balance)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="border-t-2 font-semibold">
                        <TableCell colSpan={2}>Total liabilities and equity</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(report.data.totals.liabilitiesAndEquity)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </section>
            </div>
          </section>
        )}
      </PageBody>
      <style>{REPORT_PRINT_PORTRAIT_CSS}</style>
    </>
  );
}
