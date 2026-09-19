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
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DownloadIcon, PrinterIcon } from "lucide-react";
import { z } from "zod";

import { ErrorNote, PageBody, PageHeader } from "@/components/page";
import { useMembership } from "@/lib/membership";
import { orpc } from "@/lib/orpc";
import { loadRouteQuery } from "@/lib/orpc-error";
import { downloadXlsx } from "@/lib/report-export";
import { formatMoney } from "@/lib/money";
import { REPORT_PRINT_PORTRAIT_CSS } from "@/lib/report-presentation";
import { orgToday as today } from "@/lib/org-datetime";
import { requireOrgPermission } from "@/lib/route-permission";

export const Route = createFileRoute("/$orgSlug/reports/balance-sheet")({
  head: () => ({ meta: [{ title: "Balance sheet · HMS" }] }),
  // `.catch` keeps a hand-edited or truncated URL on the page: an unparseable date
  // falls back instead of showing an error screen. Same in the sibling reports.
  validateSearch: z.object({ asOf: z.iso.date().optional().catch(undefined) }),
  loaderDeps: ({ search: { asOf } }) => ({ asOf }),
  // The loader resolves the range and the component reads that same object back, so
  // the prefetched key and the rendered key cannot drift apart.
  loader: async ({ context: { queryClient }, params: { orgSlug }, deps }) => {
    const { timeZone } = await requireOrgPermission(
      queryClient,
      orgSlug,
      { report: ["readFinancial"] },
      "/$orgSlug/dashboard",
    );

    const asOf = deps.asOf ?? today(timeZone);
    await loadRouteQuery(
      queryClient.query(orpc.report.balanceSheet.queryOptions({ input: { orgSlug, asOf } })),
    );

    return { asOf };
  },
  component: BalanceSheetRoute,
});

function BalanceSheetRoute() {
  const { orgSlug } = Route.useParams();
  const navigate = Route.useNavigate();
  const { asOf } = Route.useLoaderData();
  const currency = useMembership(orgSlug, (membership) => membership.currency);
  const report = useQuery(orpc.report.balanceSheet.queryOptions({ input: { orgSlug, asOf } }));

  // `asOf` lives in the URL, so the report on screen is one you can send to someone
  // else. A cleared date input reports "", which is not a date to run on.
  const setAsOf = (next: string) => {
    if (!next) return;
    void navigate({ search: (current) => ({ ...current, asOf: next }), replace: true });
  };

  // Both are canonical two-decimal strings from the server, so compare them as such.
  const mismatched =
    report.data !== undefined &&
    report.data.totals.assets !== report.data.totals.liabilitiesAndEquity;

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
      <PageHeader title="Balance sheet" />
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

        {report.isPending ? null : report.isError ? (
          <ErrorNote title="Could not load the billing ledger balance sheet" error={report.error} />
        ) : (
          <section data-report-print className="space-y-3">
            <header className="border-b pb-2">
              <h1 className="text-sm font-medium">Billing ledger balance sheet</h1>
              <p className="text-muted-foreground">
                As of {report.data.asOf} · HMS-posted billing activity only; opening balances and
                final accounts remain in the accountant's books.
              </p>
            </header>

            {mismatched ? (
              <div
                role="alert"
                className="border-2 border-destructive bg-destructive/10 p-3 font-medium text-destructive"
              >
                Billing ledger mismatch: assets {formatMoney(report.data.totals.assets, currency)}{" "}
                do not equal liabilities and equity{" "}
                {formatMoney(report.data.totals.liabilitiesAndEquity, currency)}.
              </div>
            ) : null}

            <div className="grid gap-3 lg:grid-cols-2">
              <section className="space-y-2">
                <h2 className="font-medium uppercase tracking-wide">Assets</h2>
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
                          <TableCell className="font-mono font-medium">{row.code}</TableCell>
                          <TableCell>{row.name}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(row.balance, currency)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="border-t-2 font-semibold">
                        <TableCell colSpan={2}>Total assets</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(report.data.totals.assets, currency)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </section>

              <section className="space-y-2">
                <h2 className="font-medium uppercase tracking-wide">Liabilities and equity</h2>
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
                          <TableCell className="font-mono font-medium">{row.code}</TableCell>
                          <TableCell>{row.name}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(row.balance, currency)}
                          </TableCell>
                        </TableRow>
                      ))}
                      {report.data.equity.map((row) => (
                        <TableRow key={`equity-${row.code}`}>
                          <TableCell className="font-mono font-medium">{row.code}</TableCell>
                          <TableCell>{row.name}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(row.balance, currency)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="border-t-2 font-semibold">
                        <TableCell colSpan={2}>Total liabilities and equity</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(report.data.totals.liabilitiesAndEquity, currency)}
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
